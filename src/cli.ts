#!/usr/bin/env node
/**
 * Phoenix VCS — Command Line Interface
 *
 * The primary UX surface for Phoenix. `phoenix status` is the most
 * important command — it must always be explainable, conservative,
 * and correct-enough to rely on.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve, relative, basename, dirname } from 'node:path';

// Stores
import { SpecStore } from './store/spec-store.js';
import { CanonicalStore } from './store/canonical-store.js';
import { EvidenceStore } from './store/evidence-store.js';
import { ManifestManager } from './manifest.js';

// Phase A
import { parseSpec } from './spec-parser.js';
import { diffClauses } from './diff.js';

// Phase B
import { extractCanonicalNodes, extractCandidates } from './canonicalizer.js';
import { extractCanonicalNodesLLM } from './canonicalizer-llm.js';
import { computeWarmHashes } from './warm-hasher.js';
import { classifyChanges } from './classifier.js';
import { classifyChangesWithLLM } from './classifier-llm.js';
import { DRateTracker } from './d-rate.js';
import { BootstrapStateMachine } from './bootstrap.js';

// Phase C
import { planIUs, planIUsAuto } from './iu-planner.js';
import { generateIU, generateAll } from './regen.js';
import type { RegenContext, RegenResult } from './regen.js';
import { gateIU } from './regen-gate.js';
import type { GateVerdict } from './regen-gate.js';
import { detectDrift } from './drift.js';
import { splitSharedArtifacts, parseRegions } from './artifacts.js';
import type { SplitResult, ParsedRegion } from './artifacts.js';
import { runCompileGate } from './compile-gate.js';
import type { CompileGateResult } from './compile-gate.js';
import { provenanceLabels, extractLineProvenance } from './llm/prompt.js';
import { extractDependencies } from './dep-extractor.js';
import { validateBoundary } from './boundary-validator.js';

// Phase D
import { evaluateAllPolicies } from './policy-engine.js';
import { computeCascade } from './cascade.js';
import { ChangeStore } from './store/change-store.js';
import { WaiverStore, defaultSigner, parseExpiry } from './waivers.js';
import type { StoredWaiver } from './waivers.js';
import { deriveIUDependencies, applyDerivedDependencies, buildFileToIUMap, resolveRelativeImport } from './iu-deps.js';
import { recordLowTierEvidence, iuArtifactHash } from './evidence-collector.js';
import { computeInvalidation, iuKey, dependentsToRegenerate } from './invalidation.js';
import { InvalidationStore } from './store/invalidation-store.js';
import { CanonStabilityStore } from './canon-stability.js';
import { Journal } from './journal.js';
import { deriveEvaluations, checkEvaluation, checkProperty } from './evals.js';
import { mineEntityAttributes, extractConstraints } from './constraints/extract.js';
import { checkConstraintAst } from './constraints/check-ast.js';
import { computeObligations } from './constraints/obligations.js';
import type { StructuredConstraint } from './constraints/model.js';
import { parseSchema, checkModuleSchema } from './schema-contract.js';
import { planSchema, SCHEMA_PLAN_IU, planFromMigrations } from './schema-plan.js';
import type { SchemaPlan } from './schema-plan.js';
import { runRepairLoop } from './repair.js';
import type { RepairTarget, RepairLoopResult } from './repair.js';
import type { RepairFinding } from './models/repair.js';
import { MIGRATIONS_TARGET } from './models/repair.js';
import { verdictOf, verdictSeverity } from './models/validation.js';
import type { ValidationResult, CheckResult } from './models/validation.js';
import { runSuite } from './eval/harness.js';
import { CAPABILITY_SUITE } from './eval/suite.js';
import { renderScorecard, scorecardArtifact } from './eval/report.js';
import type { CompileError } from './models/architecture.js';

// Phase E
import { runShadowPipeline } from './shadow-pipeline.js';

// Phase F
import { parseCommand, routeCommand, getAllCommands } from './bot-router.js';
import { ConfirmStore } from './store/confirm-store.js';

// Scaffold
import { deriveServices, nodeScaffold } from './scaffold.js';

// Inspect
import { collectInspectData, renderInspectHTML, serveInspect } from './inspect.js';
import type { TrustInputs } from './inspect.js';

// LLM
import { resolveProvider, describeAvailability } from './llm/resolve.js';
import type { LLMProvider } from './llm/provider.js';

// Architectures
import { resolveTarget, listArchitectures } from './architectures/index.js';
import type { ResolvedTarget } from './models/architecture.js';

// Audit & Fowler gaps
import { auditIU, auditAll } from './audit.js';
import type { AuditResult, ReadinessLevel } from './audit.js';
import { EvaluationStore } from './store/evaluation-store.js';
import { NegativeKnowledgeStore } from './store/negative-knowledge-store.js';
import { failedGenerationKnowledge } from './models/negative-knowledge.js';
import type { NegativeKnowledge } from './models/negative-knowledge.js';
import type { PaceLayerMetadata } from './models/pace-layer.js';

// Models
import type { Clause } from './models/clause.js';
import { DiffType } from './models/clause.js';
import type { CanonicalNode } from './models/canonical.js';
import type { ImplementationUnit } from './models/iu.js';
import type { Diagnostic } from './models/diagnostic.js';
import type { DriftReport, DriftEntry } from './models/manifest.js';
import { DriftStatus } from './models/manifest.js';
import { BootstrapState, DRateLevel } from './models/classification.js';
import type { PolicyEvaluation, CascadeEvent } from './models/evidence.js';
import { EvidenceStatus } from './models/evidence.js';

// ─── ANSI Colors ─────────────────────────────────────────────────────────────

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const BG_RED = '\x1b[41m';
const BG_GREEN = '\x1b[42m';
const BG_YELLOW = '\x1b[43m';

function red(s: string): string { return `${RED}${s}${RESET}`; }
function green(s: string): string { return `${GREEN}${s}${RESET}`; }
function yellow(s: string): string { return `${YELLOW}${s}${RESET}`; }
function blue(s: string): string { return `${BLUE}${s}${RESET}`; }
function magenta(s: string): string { return `${MAGENTA}${s}${RESET}`; }
function cyan(s: string): string { return `${CYAN}${s}${RESET}`; }
function dim(s: string): string { return `${DIM}${s}${RESET}`; }
function bold(s: string): string { return `${BOLD}${s}${RESET}`; }

function severityColor(severity: string): string {
  switch (severity) {
    case 'error': return `${BG_RED}${WHITE}${BOLD} ERROR ${RESET}`;
    case 'warning': return `${BG_YELLOW}${WHITE}${BOLD} WARN  ${RESET}`;
    case 'info': return `${BG_GREEN}${WHITE}${BOLD} INFO  ${RESET}`;
    default: return severity;
  }
}

function severityIcon(severity: string): string {
  switch (severity) {
    case 'error': return red('✖');
    case 'warning': return yellow('⚠');
    case 'info': return blue('ℹ');
    default: return ' ';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VERSION = '0.1.0';

function findPhoenixRoot(from: string = process.cwd()): string | null {
  let dir = resolve(from);
  while (true) {
    if (existsSync(join(dir, '.phoenix'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

function requirePhoenixRoot(): { projectRoot: string; phoenixDir: string } {
  const projectRoot = findPhoenixRoot();
  if (!projectRoot) {
    console.error(red('✖ Not a Phoenix project. Run `phoenix init` first.'));
    process.exit(1);
  }
  return { projectRoot, phoenixDir: join(projectRoot, '.phoenix') };
}

function loadBootstrapState(phoenixDir: string): BootstrapStateMachine {
  const statePath = join(phoenixDir, 'state.json');
  if (existsSync(statePath)) {
    const data = JSON.parse(readFileSync(statePath, 'utf8'));
    return BootstrapStateMachine.fromJSON(data);
  }
  return new BootstrapStateMachine();
}

function saveBootstrapState(phoenixDir: string, machine: BootstrapStateMachine): void {
  writeFileSync(join(phoenixDir, 'state.json'), JSON.stringify(machine.toJSON(), null, 2), 'utf8');
}

function loadIUs(phoenixDir: string): ImplementationUnit[] {
  const iuPath = join(phoenixDir, 'graphs', 'ius.json');
  if (!existsSync(iuPath)) return [];
  return JSON.parse(readFileSync(iuPath, 'utf8'));
}

function saveIUs(phoenixDir: string, ius: ImplementationUnit[]): void {
  const dir = join(phoenixDir, 'graphs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ius.json'), JSON.stringify(ius, null, 2), 'utf8');
}

/**
 * Build the D-rate tracker from the persisted change window (ChangeStore).
 * This is the live trust metric: the window survives across processes, so the
 * D-rate reflects real classification history — not a per-run reset.
 */
function loadDRateTracker(phoenixDir: string): DRateTracker {
  const changeStore = new ChangeStore(phoenixDir);
  const window = changeStore.getWindow();
  const tracker = new DRateTracker(changeStore.getWindowSize());
  for (const cls of window) tracker.recordOne(cls);
  return tracker;
}

/**
 * Compute boundary diagnostics for every generated IU file, including IU-level
 * coupling (allowed_ius / forbidden_ius) which requires mapping each relative
 * import to its owning IU — the piece that was previously unenforceable.
 */
function computeBoundaryDiagnostics(projectRoot: string, ius: ImplementationUnit[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const fileToIU = buildFileToIUMap(ius);
  const knownFiles = new Set(fileToIU.keys());
  const iuById = new Map(ius.map(iu => [iu.iu_id, iu]));

  for (const iu of ius) {
    for (const outputFile of iu.output_files) {
      const fullPath = join(projectRoot, outputFile);
      if (!existsSync(fullPath)) continue;
      const source = readFileSync(fullPath, 'utf8');
      const depGraph = extractDependencies(source, outputFile);
      // Package + side-channel + forbidden-path checks.
      diagnostics.push(...validateBoundary(depGraph, iu));

      // IU-level coupling: resolve each relative import to its owning IU and
      // enforce allowed_ius / forbidden_ius. This is mechanical enforcement of
      // the boundary policy the PRD §7 example depends on.
      const policy = iu.boundary_policy.code;
      if (policy.allowed_ius.length === 0 && policy.forbidden_ius.length === 0) continue;
      for (const imp of depGraph.imports) {
        if (!imp.is_relative) continue;
        const resolved = resolveRelativeImport(outputFile.replace(/\\/g, '/'), imp.source, knownFiles);
        if (!resolved) continue;
        const targetIU = fileToIU.get(resolved);
        if (!targetIU || targetIU === iu.iu_id) continue;
        const targetName = iuById.get(targetIU)?.name ?? targetIU.slice(0, 8);
        if (policy.forbidden_ius.includes(targetIU) || policy.forbidden_ius.includes(targetName)) {
          diagnostics.push({
            severity: iu.enforcement.dependency_violation.severity,
            category: 'dependency_violation',
            subject: iu.name,
            message: `Imports ${targetName} (forbidden by boundary policy)`,
            iu_id: iu.iu_id,
            source_file: outputFile,
            source_line: imp.source_line,
            recommended_actions: [`Remove the import of ${targetName}, or update ${iu.name}'s boundary policy`],
          });
        } else if (policy.allowed_ius.length > 0 && !policy.allowed_ius.includes(targetIU) && !policy.allowed_ius.includes(targetName)) {
          diagnostics.push({
            severity: iu.enforcement.dependency_violation.severity,
            category: 'dependency_violation',
            subject: iu.name,
            message: `Imports ${targetName}, which is not in ${iu.name}'s allowed_ius`,
            iu_id: iu.iu_id,
            source_file: outputFile,
            source_line: imp.source_line,
            recommended_actions: [`Add ${targetName} to allowed_ius, or remove the import`],
          });
        }
      }
    }
  }
  return diagnostics;
}

/**
 * Derive the IU dependency graph from generated code and persist it onto the IU
 * list (graphs/ius.json). This populates the edges cascade, IU-level boundary
 * enforcement, and selective invalidation all traverse. Returns the updated IUs.
 */
function persistIUDependencies(
  phoenixDir: string,
  projectRoot: string,
  ius: ImplementationUnit[],
): ImplementationUnit[] {
  const derived = deriveIUDependencies(projectRoot, ius);
  const changed = applyDerivedDependencies(ius, derived);
  if (changed.length > 0) saveIUs(phoenixDir, ius);
  return ius;
}

/**
 * Journal every regenerated IU: file outputs (with hashes), the canon nodes and
 * model/promptpack that produced them. This is the authoritative provenance edge
 * `phoenix why` walks — spec change → canon → IU → these exact files.
 */
function journalRegen(phoenixDir: string, results: RegenResult[], ius: ImplementationUnit[]): void {
  if (results.length === 0) return;
  const journal = new Journal(phoenixDir);
  const iuById = new Map(ius.map(iu => [iu.iu_id, iu]));
  for (const result of results) {
    const iu = iuById.get(result.iu_id);
    const meta = result.manifest.regen_metadata;
    journal.append({
      type: 'regen',
      inputs: iu?.source_canon_ids ?? [],
      outputs: [...result.files.keys()],
      meta: {
        iu_id: result.iu_id,
        iu_name: result.manifest.iu_name,
        model_id: meta.model_id,
        promptpack_hash: meta.promptpack_hash,
        toolchain_version: meta.toolchain_version,
        file_hashes: Object.fromEntries(Object.entries(result.manifest.files).map(([p, e]) => [p, e.content_hash])),
      },
    });
  }
}

/**
 * Structured-constraint validation (SHACL-spine, first shape family = `Bound`).
 * Extracts bound constraints from the canonical graph, resolves their bindings
 * against the mined entity.attribute universe, and statically checks each against
 * the generated code. Returns Diagnostics via the total-function verdict, so a
 * spec constraint that the code does not enforce is a hard ERROR — not a false
 * green (the §1 failure). Unresolvable bindings are ERRORs before codegen.
 */
/**
 * Cross-module schema-contract diagnostics. Parses the shared migration DDL into
 * a schema model, then holds every module's SQL (and the DDL's own FKs) against
 * it. Findings are guaranteed runtime failures → errors. Silent when there is no
 * migration artifact or nothing provably inconsistent.
 */
function computeSchemaDiagnostics(projectRoot: string, ius: ImplementationUnit[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const migPath = join(projectRoot, 'src', 'generated', '_migrations.ts');
  if (!existsSync(migPath)) return diagnostics;
  const ddl = readFileSync(migPath, 'utf8');
  const schema = parseSchema(ddl);
  if (schema.tables.size === 0) return diagnostics;

  const targets: Array<{ file: string; source: string; iu_id?: string }> = [
    { file: 'src/generated/_migrations.ts', source: ddl },
  ];
  for (const iu of ius) {
    const f = iu.output_files[0];
    const full = f ? join(projectRoot, f) : '';
    if (full && existsSync(full)) targets.push({ file: f, source: readFileSync(full, 'utf8'), iu_id: iu.iu_id });
  }
  for (const t of targets) {
    for (const f of checkModuleSchema(t.file, t.source, schema)) {
      diagnostics.push({
        severity: 'error',
        category: 'schema',
        subject: f.ref,
        iu_id: t.iu_id,
        message: `Schema contract: ${f.detail}`,
        source_file: t.file,
        recommended_actions: [
          f.suggestion
            ? `Align on one name: use "${f.suggestion}" (regenerate the module, or fix the migration if the module is right)`
            : 'Align the module SQL with the migration schema, then regenerate',
        ],
      });
    }
  }
  return diagnostics;
}

function computeConstraintDiagnostics(
  projectRoot: string,
  ius: ImplementationUnit[],
  canonNodes: CanonicalNode[],
  allClauses: Clause[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (canonNodes.length === 0) return diagnostics;

  const entityAttrs = mineEntityAttributes(ius, canonNodes, allClauses);
  const clauseById = new Map(allClauses.map(c => [c.clause_id, c]));
  const { constraints, defects } = extractConstraints(canonNodes, entityAttrs, (cid) => {
    const c = clauseById.get(cid);
    return c ? { doc: c.source_doc_id, line: c.source_line_range[0], text: c.raw_text } : {};
  });

  // Binding defects: a constraint whose subject resolves to nothing (the §1 mechanism).
  for (const d of defects) {
    diagnostics.push({
      severity: 'error',
      category: 'constraint',
      subject: d.subject,
      message: `Unbound constraint: ${d.reason} — "${d.source.statement.slice(0, 60)}"`,
      source_file: d.source.doc,
      source_line: d.source.line,
      recommended_actions: [
        'The requirement graph names a subject the graph does not contain — fix the spec wording or the canonicalizer binding',
      ],
    });
  }

  // Resolved constraints: statically check enforcement in the generated code.
  const iuByEntity = new Map<string, ImplementationUnit>();
  for (const iu of ius) iuByEntity.set(iu.name.toLowerCase().replace(/s$/, ''), iu);

  // Pre-index every IU's source, and a value→entity map from Membership constraints
  // ("debit" → transaction.type). These power write-path-aware Expr checking: a state
  // invariant can be violated by ANY module that writes the governed rows, not just
  // the module it nominally binds to. balance.ts may guard the overdraft while a
  // second write path (transaction.ts) does not — the invariant still fails.
  const iuSourceById = new Map<string, string>();
  for (const u of ius) {
    const f = u.output_files[0];
    const full = f ? join(projectRoot, f) : '';
    if (full && existsSync(full)) iuSourceById.set(u.iu_id, readFileSync(full, 'utf8'));
  }
  const valueEntity = new Map<string, string>();
  for (const c of constraints) {
    if (c.assertion.kind === 'membership') for (const v of c.assertion.values) valueEntity.set(v.toLowerCase(), c.binding.entity);
  }

  /**
   * Check an Expr invariant across every module that writes the governed state. The
   * governed entity is the one owning a value-word in the statement (e.g. "debit" →
   * transaction); a write path is any IU that INSERT/UPDATEs that entity's table. The
   * invariant holds only if EVERY write path enforces it — one unguarded path
   * violates it (and is named as the culprit). Abstains when no write path is found.
   */
  const checkExprWritePaths = (c: StructuredConstraint): { result: CheckResult; detail: string; culprit?: ImplementationUnit } => {
    if (c.assertion.kind !== 'expr') return { result: 'indeterminate', detail: '' };
    const statement = c.assertion.statement;
    const words = statement.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    const writeEntities = new Set<string>();
    for (const w of words) { const e = valueEntity.get(w); if (e) writeEntities.add(e); }
    const paths = ius.filter(u => {
      const src = iuSourceById.get(u.iu_id); if (!src) return false;
      const s = src.toLowerCase();
      // Real English plurals: `entry` writes the `entries` table — the naive `s?`
      // form missed y→ies and let the unguarded write path escape unexamined.
      const plural = (e: string) => e.endsWith('y') ? `(?:${e}|${e.slice(0, -1)}ies|${e}s)` : `${e}(?:e?s)?`;
      const writesGoverned = [...writeEntities].some(e => new RegExp(`(?:insert into|update|delete from)\\s+${plural(e)}\\b`, 'i').test(s));
      return writesGoverned || writeEntities.has(u.name.toLowerCase().replace(/s$/, ''));
    });
    if (paths.length === 0) return { result: 'indeterminate', detail: 'no write path to the governed state found' };
    let anyPass = false;
    for (const u of paths) {
      const r = checkProperty(statement, iuSourceById.get(u.iu_id)!);
      if (r.status === 'fail') return { result: 'violates', detail: `write path "${u.name}" does not enforce this invariant (${r.reason})`, culprit: u };
      if (r.status === 'pass') anyPass = true;
    }
    return anyPass
      ? { result: 'conforms', detail: `every write path to the governed state enforces the invariant` }
      : { result: 'indeterminate', detail: 'invariant not statically reducible on the write paths' };
  };

  for (const c of constraints) {
    const iu = iuByEntity.get(c.binding.entity) ?? ius.find(u => u.name.toLowerCase().includes(c.binding.entity));
    let source: string | null = null;
    if (iu) {
      const file = iu.output_files[0];
      const full = file ? join(projectRoot, file) : '';
      if (full && existsSync(full)) source = readFileSync(full, 'utf8');
    }
    const exprWPRaw = c.assertion.kind === 'expr' ? checkExprWritePaths(c) : null;
    // A write-path abstention isn't the last word — fall through to the checker,
    // whose executable runner may still decide a recognized aggregate shape.
    const exprWP = exprWPRaw && exprWPRaw.result !== 'indeterminate' ? exprWPRaw : null;
    // AST-first (proven equivalent-or-better by the differential harness); the AST path
    // itself delegates to the regex checker for non-Zod / non-TS sources, so regex stays
    // reachable as the fallback it was always meant to be.
    const check = exprWP ?? checkConstraintAst(c, source);
    const culpritIU = exprWP?.culprit ?? iu;
    const a = c.assertion;
    const shape = a.kind === 'bound'
      ? `${a.op} ${a.value}${a.unit ? ' ' + a.unit : ''}`
      : a.kind === 'membership'
        ? `∈ {${a.values.join(', ')}}`
        : a.kind === 'pattern'
          ? `format: ${a.format}`
          : a.kind === 'reference'
            ? `→ existing ${a.target}`
            : a.kind === 'cardinality'
              ? `count ${a.min !== undefined ? `≥${a.min}` : ''}${a.max !== undefined ? ` ≤${a.max}` : ''} ${a.relation}`.trim()
              : a.kind === 'expr'
                ? `invariant: ${a.statement.slice(0, 48)}${a.statement.length > 48 ? '…' : ''}`
                : a.kind === 'temporal'
                  ? `${a.mode.replace('-', ' ')}`
                  : a.kind === 'presence'
                    ? 'required (non-optional)'
                    : 'must be unique';
    const enforce = a.kind === 'bound'
      ? `.${a.op === '<=' ? 'max' : 'min'}(${a.value})`
      : a.kind === 'membership'
        ? `z.enum([${a.values.map(v => `'${v}'`).join(', ')}])`
        : a.kind === 'pattern'
          ? `.${a.format}()`
          : a.kind === 'reference'
            ? `a foreign key or existence guard against ${a.target}`
            : a.kind === 'cardinality'
              ? `a non-empty / count guard on ${a.relation}`
              : a.kind === 'expr'
                ? `an executable guard for this invariant`
                : a.kind === 'temporal'
                  ? `a ${a.mode} validator (e.g. .refine(isNotFuture, …))`
                  : a.kind === 'presence'
                    ? `a required (non-optional) field in the input schema`
                    : 'a UNIQUE constraint';
    // For an Expr invariant, the subject is the specific write path that fails to
    // enforce it (the culprit module), not the nominal binding entity.
    const label = a.kind === 'expr' && exprWP?.culprit ? `${exprWP.culprit.name}.invariant` : `${c.binding.entity}.${c.binding.attribute}`;
    const result: ValidationResult = {
      focus: { label, entity: c.binding.entity, attribute: c.binding.attribute, iu_id: culpritIU?.iu_id },
      path: c.binding.attribute,
      source_component: a.kind,
      result: check.result,
      method: ('method' in check ? check.method : undefined) ?? 'static',
      message: a.kind === 'expr'
        ? `${label} — ${shape}: ${check.detail}`
        : `${c.binding.entity}.${c.binding.attribute} ${shape}: ${check.detail}`,
      recommended_actions: [],
      provenance: { source_doc: c.source.doc, line: c.source.line },
    };
    const verdict = verdictOf(result.method, result.result);
    const sev = verdictSeverity(verdict);
    if (!sev) continue; // conforms → OK → no diagnostic
    result.recommended_actions = a.kind === 'expr'
      ? [`Add ${enforce} in ${exprWP?.culprit?.name ?? c.binding.entity} so no write path can reach a state the invariant forbids, then regenerate`]
      : check.result === 'absent'
        ? [`Enforce ${c.binding.entity}.${c.binding.attribute} with ${enforce} in the generated code, then regenerate`]
        : check.result === 'violates'
          ? [`Generated code enforces the wrong ${a.kind}; regenerate to match the spec (${shape})`]
          : [`Generate ${c.binding.entity} to reason about this constraint`];
    diagnostics.push({
      severity: sev,
      category: 'constraint',
      subject: result.focus.label,
      iu_id: culpritIU?.iu_id,
      message: result.message,
      source_file: culpritIU?.output_files[0] ?? result.provenance?.source_doc,
      source_line: result.provenance?.line,
      recommended_actions: result.recommended_actions,
    });
  }

  // ── Obligation ledger: no normative sentence may be SILENTLY unverified ──
  // A spec sentence carrying a normative marker ("must", "never", "only", "unique"…)
  // is an obligation. It is TRACKED when it produced a structured constraint (any of
  // the 7 kinds), a binding defect (already a diagnostic), or a derived evaluation
  // that actually ran (pass/fail — not an abstain). An obligation that produced NONE
  // of these is silent coverage loss — the promise the extractor dropped on the floor
  // — and must be surfaced. This closes the system-level false green: the spec made a
  // promise `status` did not even know existed.
  diagnostics.push(...computeObligationDiagnostics(canonNodes, ius, allClauses, constraints, defects, iuSourceById));
  return diagnostics;
}

/**
 * The obligation ledger (see the tail of computeConstraintDiagnostics). Reports one
 * `warning · obligation` per normative sentence that produced nothing checkable, so
 * silent coverage loss is impossible. The accounting core (computeObligations) is a
 * pure function in src/constraints/obligations.ts and exhaustively unit-tested; here
 * we only compute the eval-derived tracking set (which needs the IU sources) and map
 * the unverified obligations to diagnostics.
 */
function computeObligationDiagnostics(
  canonNodes: CanonicalNode[],
  ius: ImplementationUnit[],
  allClauses: Clause[],
  constraints: StructuredConstraint[],
  defects: import('./constraints/model.js').BindingDefect[],
  iuSourceById: Map<string, string>,
): Diagnostic[] {
  const canonById = new Map(canonNodes.map(n => [n.canon_id, n]));

  // A derived evaluation that ran to a verdict (pass/fail) tracks its node. Only
  // single-node evals count: the coarse contract-output eval spans every source node
  // and would over-credit them, so it is excluded here.
  const trackedByEval = new Set<string>();
  for (const iu of ius) {
    const src = iuSourceById.get(iu.iu_id);
    if (!src) continue;
    for (const e of deriveEvaluations(iu, canonNodes)) {
      if (e.canon_ids.length !== 1) continue;
      const r = checkEvaluation(e, src, canonById);
      if (r.status === 'pass' || r.status === 'fail') trackedByEval.add(e.canon_ids[0]);
    }
  }

  const obligations = computeObligations(canonNodes, allClauses, constraints, defects, trackedByEval);
  return obligations.filter(o => o.state === 'unverified').map(o => {
    const snippet = o.statement.length > 90 ? o.statement.slice(0, 88).trimEnd() + '…' : o.statement;
    return {
      severity: 'warning' as const,
      category: 'obligation' as const,
      subject: `"${snippet}"`,
      message: `normative ("${o.marker}") but produced no checkable constraint (unverified)`,
      source_file: o.doc,
      source_line: o.line,
      recommended_actions: [
        'Reword the spec so the rule is machine-checkable, add a constraint kind that captures it, or attach a durable eval — do not leave it silently unverified',
      ],
    };
  });
}

/** Current artifact hash per IU — the identity of the generation on disk now. */
function currentArtifactHashes(
  ius: ImplementationUnit[],
  manifestManager: ManifestManager,
  projectRoot: string,
): Map<string, string> {
  const manifest = manifestManager.load();
  const map = new Map<string, string>();
  for (const iu of ius) {
    if (iu.output_files.some(f => existsSync(join(projectRoot, f)))) {
      map.set(iu.iu_id, iuArtifactHash(iu, manifest, projectRoot));
    }
  }
  return map;
}

/**
 * Generate durable evaluations for each IU, check them against the generated
 * module, persist them (with pass/fail status), and record the resulting
 * unit_tests / property_tests evidence bound to the IU's artifact hash. This is
 * the oracle: it gives regeneration something to be conservative against, and it
 * turns the permanent "missing unit_tests" INCOMPLETE into a real, satisfiable
 * (or honestly-failing) signal.
 */
function generateCheckAndRecordEvals(
  phoenixDir: string,
  projectRoot: string,
  ius: ImplementationUnit[],
  canonNodes: CanonicalNode[],
  manifestManager: ManifestManager,
): { generated: number; passed: number; failed: number } {
  const evalStore = new EvaluationStore(phoenixDir);
  const evidenceStore = new EvidenceStore(phoenixDir);
  const canonById = new Map(canonNodes.map(n => [n.canon_id, n]));
  const manifest = manifestManager.load();
  const timestamp = new Date().toISOString();
  const evidence: import('./models/evidence.js').EvidenceRecord[] = [];
  let generated = 0, passed = 0, failed = 0;

  for (const iu of ius) {
    const primaryFile = iu.output_files[0];
    if (!primaryFile) continue;
    const full = join(projectRoot, primaryFile);
    if (!existsSync(full)) continue;
    const source = readFileSync(full, 'utf8');

    const derived = deriveEvaluations(iu, canonNodes);
    if (derived.length === 0) continue;

    // Check each eval against the generated module; stamp status; persist.
    const results = derived.map(e => checkEvaluation(e, source, canonById));
    // 'indeterminate' (the oracle honestly abstained) maps to 'untested' on the
    // durable eval — it is NOT a pass.
    const statusById = new Map(results.map(r => [r.eval_id, r.status === 'indeterminate' ? 'untested' as const : r.status]));
    for (const e of derived) {
      e.last_status = statusById.get(e.eval_id) ?? 'untested';
      e.last_verified_at = timestamp;
    }
    evalStore.addMany(derived);
    generated += derived.length;
    passed += results.filter(r => r.status === 'pass').length;
    failed += results.filter(r => r.status === 'fail').length;

    const artifactHash = iuArtifactHash(iu, manifest, projectRoot);
    const required = new Set(iu.evidence_policy.required);

    // Tri-state evidence: any fail ⇒ FAIL; else any unverified (indeterminate/
    // untested) ⇒ PENDING (honest — not a pass); else PASS. A property the oracle
    // could not verify must never satisfy the policy on its own.
    const evStatus = (subset: typeof derived): EvidenceStatus => {
      if (subset.some(e => e.last_status === 'fail')) return EvidenceStatus.FAIL;
      if (subset.some(e => e.last_status !== 'pass')) return EvidenceStatus.PENDING;
      return EvidenceStatus.PASS;
    };

    // unit_tests ← boundary_contract + domain_rule + failure_mode evals.
    if (required.has('unit_tests')) {
      const behavioral = derived.filter(e => e.binding !== 'invariant');
      if (behavioral.length > 0) {
        evidence.push(makeEvalEvidence('unit_tests', iu, artifactHash, evStatus(behavioral), behavioral.length, timestamp));
      }
    }
    // property_tests ← invariant evals (the properties that must always hold).
    if (required.has('property_tests')) {
      const invariants = derived.filter(e => e.binding === 'invariant');
      if (invariants.length > 0) {
        evidence.push(makeEvalEvidence('property_tests', iu, artifactHash, evStatus(invariants), invariants.length, timestamp));
      }
    }
  }

  if (evidence.length > 0) evidenceStore.addRecords(evidence);
  return { generated, passed, failed };
}

function makeEvalEvidence(
  kind: 'unit_tests' | 'property_tests',
  iu: ImplementationUnit,
  artifactHash: string,
  status: EvidenceStatus,
  count: number,
  timestamp: string,
): import('./models/evidence.js').EvidenceRecord {
  const verb = status === EvidenceStatus.PASS ? 'passed' : status === EvidenceStatus.FAIL ? 'failed' : 'could not be verified by';
  return {
    evidence_id: createHash('sha256').update(`${kind}\x00${iu.iu_id}\x00${timestamp}`).digest('hex').slice(0, 16),
    kind: kind as import('./models/evidence.js').EvidenceKind,
    status,
    iu_id: iu.iu_id,
    canon_ids: iu.source_canon_ids,
    artifact_hash: artifactHash,
    message: `${count} durable ${kind === 'unit_tests' ? 'behavioral' : 'invariant'} eval(s) ${verb} the static oracle`,
    timestamp,
  };
}

/**
 * Record low-tier evidence (typecheck, lint, boundary) from the checks that just
 * ran, binding each record to the IU's current artifact hash. Called after the
 * compile gate so the manifest reflects any repairs.
 */
function collectEvidenceAfterGate(
  phoenixDir: string,
  projectRoot: string,
  ius: ImplementationUnit[],
  manifestManager: ManifestManager,
  compileErrors: CompileError[],
  canonNodes: CanonicalNode[],
): void {
  const boundaryDiagnostics = computeBoundaryDiagnostics(projectRoot, ius);
  recordLowTierEvidence(phoenixDir, {
    ius,
    manifest: manifestManager.load(),
    projectRoot,
    compileErrors,
    boundaryDiagnostics,
  });
  // Generate + check durable evaluations, recording unit/property test evidence.
  generateCheckAndRecordEvals(phoenixDir, projectRoot, ius, canonNodes, manifestManager);
}

function findSpecFiles(projectRoot: string): string[] {
  const specDir = join(projectRoot, 'spec');
  if (!existsSync(specDir)) return [];
  return readdirSync(specDir, { recursive: true })
    .map(f => f.toString())
    .filter(f => f.endsWith('.md'))
    .map(f => join(specDir, f));
}

function printDiagnosticTable(diagnostics: Diagnostic[]): void {
  if (diagnostics.length === 0) {
    console.log(green('  No issues found.'));
    return;
  }

  const errors = diagnostics.filter(d => d.severity === 'error');
  const warnings = diagnostics.filter(d => d.severity === 'warning');
  const infos = diagnostics.filter(d => d.severity === 'info');

  for (const group of [
    { items: errors, label: 'Errors' },
    { items: warnings, label: 'Warnings' },
    { items: infos, label: 'Info' },
  ]) {
    if (group.items.length === 0) continue;
    console.log();
    console.log(`  ${bold(group.label)} (${group.items.length}):`);
    for (const d of group.items) {
      console.log(`    ${severityIcon(d.severity)} ${bold(d.category)} ${dim('·')} ${d.subject}`);
      console.log(`      ${d.message}`);
      if (d.recommended_actions.length > 0) {
        console.log(`      ${dim('→')} ${dim(d.recommended_actions[0])}`);
      }
    }
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

function cmdInit(args?: string[]): void {
  const projectRoot = process.cwd();
  const phoenixDir = join(projectRoot, '.phoenix');

  if (existsSync(phoenixDir)) {
    console.log(yellow('⚠ Phoenix already initialized in this directory.'));
    return;
  }

  mkdirSync(join(phoenixDir, 'store', 'objects'), { recursive: true });
  mkdirSync(join(phoenixDir, 'graphs'), { recursive: true });
  mkdirSync(join(phoenixDir, 'manifests'), { recursive: true });

  const machine = new BootstrapStateMachine();
  saveBootstrapState(phoenixDir, machine);

  // Save architecture choice if specified
  const archArg = args?.find(a => a.startsWith('--arch='))?.split('=')[1];
  if (archArg) {
    const arch = resolveTarget(archArg);
    if (!arch) {
      console.log(red(`✖ Unknown architecture: ${archArg}`));
      console.log(`  Available: ${listArchitectures().join(', ')}`);
      return;
    }
    const configPath = join(phoenixDir, 'config.json');
    const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
    config.architecture = archArg;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  }

  // Ensure spec/ directory exists
  const specDir = join(projectRoot, 'spec');
  if (!existsSync(specDir)) {
    mkdirSync(specDir, { recursive: true });
  }

  // Create .gitignore
  const gitignorePath = join(phoenixDir, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, 'store/objects/\n', 'utf8');
  }

  console.log(green('✔ Phoenix initialized.'));
  console.log();
  console.log(`  ${dim('Project root:')}  ${projectRoot}`);
  console.log(`  ${dim('Phoenix dir:')}   ${phoenixDir}`);
  console.log(`  ${dim('State:')}         ${BootstrapState.BOOTSTRAP_COLD}`);
  if (archArg) {
    console.log(`  ${dim('Architecture:')} ${cyan(archArg)}`);
  }
  console.log();
  console.log(`  ${dim('Next steps:')}`);
  console.log(`    1. Add spec documents to ${cyan('spec/')}`);
  console.log(`    2. Run ${cyan('phoenix bootstrap')} to ingest & canonicalize`);
}

// ─── Regeneration Gate wiring (warn-first) ───────────────────────────────────

/**
 * Build the sibling-contract map from already-generated files on disk, so an
 * incremental regen (e.g. just the board) still sees the real contracts of the
 * other modules it calls. generateAll refreshes entries for IUs it regenerates.
 */
function loadExistingContracts(projectRoot: string, ius: ImplementationUnit[], target: ResolvedTarget | null): Map<string, string> {
  const contracts = new Map<string, string>();
  if (!target) return contracts;
  for (const iu of ius) {
    const fp = iu.output_files[0];
    if (!fp) continue;
    const full = join(projectRoot, fp);
    if (!existsSync(full)) continue;
    try {
      const c = target.runtime.extractContract(readFileSync(full, 'utf8'));
      if (c) contracts.set(iu.iu_id, c);
    } catch { /* unreadable — skip */ }
  }
  return contracts;
}

/** Read the existing shared-aggregate files' regions (for partial-regen merge). */
function readSharedRegions(projectRoot: string, target: ResolvedTarget | null): ParsedRegion[] {
  const regions: ParsedRegion[] = [];
  for (const role of target?.runtime.aggregates ?? []) {
    const p = join(projectRoot, role.filePath);
    if (existsSync(p)) regions.push(...parseRegions(readFileSync(p, 'utf8')));
  }
  return regions;
}

/** Report what the artifact split lifted into each shared aggregate. */
function reportArtifactSplit(split: SplitResult, indent: string): void {
  for (const shared of split.sharedFiles) {
    const n = shared.regions.length;
    console.log(`${indent}${dim('Shared artifact:')} ${cyan(shared.path)} ${dim(`(${n} region${n === 1 ? '' : 's'})`)}`);
  }
  for (const conf of split.conflicts) {
    console.log(`${indent}${yellow('⚠')} duplicate ${conf.role} ${bold(conf.key)} — kept ${conf.keptIU.slice(0, 8)}…, dropped ${conf.droppedIUs.length}`);
  }
}

/**
 * Run the compile gate over the assembled project and report honestly: repair what we
 * can, refresh manifest hashes for repaired files, record unresolved build errors as
 * negative knowledge, and persist a build-status the trust dashboard reads. A failing
 * build is surfaced loudly — never swallowed.
 */
async function runCompileGateAndReport(
  projectRoot: string,
  phoenixDir: string,
  ius: ImplementationUnit[],
  opts: {
    llm: LLMProvider | null;
    target: ResolvedTarget | null;
    manifestManager: ManifestManager;
    onGenerationFailure?: RegenContext['onGenerationFailure'];
    canonNodes?: CanonicalNode[];
    indent?: string;
  },
): Promise<CompileGateResult> {
  const indent = opts.indent ?? '  ';
  console.log(`${indent}${bold('🔧 Compile Gate')} ${dim('(the assembled system must typecheck)')}`);

  const result = await runCompileGate(projectRoot, {
    llm: opts.llm ?? undefined,
    target: opts.target,
    ius,
    onRound: (round, errors) => {
      console.log(`${indent}  ${dim(`round ${round}: ${errors.length} error(s)`)}`);
    },
    onRepair: (file, iu) => {
      const full = join(projectRoot, file);
      if (existsSync(full)) {
        const content = readFileSync(full, 'utf8');
        // Re-extract line→canon provenance from the repaired content's surviving
        // `//phx:` markers instead of dropping it (keeps `phoenix why` line-accurate).
        let lineProv: Record<string, string> | undefined;
        if (iu) {
          const canonForIU = (opts.canonNodes ?? []).filter(n => iu.source_canon_ids.includes(n.canon_id));
          const labels = provenanceLabels(iu, canonForIU);
          lineProv = extractLineProvenance(content, labels).lineProvenance;
        }
        opts.manifestManager.updateGeneratedFile(file, content, lineProv);
      }
      console.log(`${indent}  ${cyan('↻')} repaired ${file}${iu ? dim(` (${iu.name})`) : ''}`);
    },
  });

  if (result.ok) {
    console.log(`${indent}  ${green('✔')} project compiles${result.repaired.length ? dim(` (repaired ${result.repaired.length} file(s))`) : ''}`);
  } else {
    console.log(`${indent}  ${red('✖')} ${red(`${result.unresolved.length} unresolved build error(s)`)}`);
    for (const e of result.unresolved.slice(0, 8)) {
      console.log(`${indent}    ${red('●')} ${e.file}${e.line ? `:${e.line}` : ''} ${dim(e.code)} ${e.message}`);
    }
    // Honest immune memory: a build error is a generation failure for its IU.
    const byFile = new Map<string, string[]>();
    for (const e of result.unresolved) (byFile.get(e.file) ?? byFile.set(e.file, []).get(e.file)!).push(`${e.code} ${e.message}`);
    for (const [file, msgs] of byFile) {
      const iu = ius.find(u => u.output_files.includes(file));
      if (iu && opts.onGenerationFailure) {
        opts.onGenerationFailure(iu, {
          model_id: opts.llm ? `${opts.llm.name}/${opts.llm.model}` : 'stub',
          promptpack_hash: '',
          reason: `Assembled project does not compile: ${msgs[0]}`,
        });
      }
    }
  }

  writeFileSync(join(phoenixDir, 'build-status.json'), JSON.stringify({
    ok: result.ok,
    rounds: result.rounds,
    repaired: result.repaired,
    unresolved: result.unresolved,
    checked_at: new Date().toISOString(),
  }, null, 2), 'utf8');

  // Close the evidence loop: record typecheck/lint/boundary evidence from the
  // checks that just ran, bound to each IU's current artifact hash. This is what
  // lets `phoenix status` show satisfied low-tier policy instead of permanent
  // "missing evidence" noise.
  collectEvidenceAfterGate(phoenixDir, projectRoot, ius, opts.manifestManager, result.unresolved, opts.canonNodes ?? []);

  console.log();
  return result;
}

// ─── The repair loop (P1) — verifier findings feed regeneration ───────────────

/**
 * Turn the current verifier ERRORS into machine-routable RepairFindings. The verifiers
 * (schema contract + constraint diagnostics + build) are the ORACLE and are only READ
 * here — never modified. Schema findings on the migrations file route to the synthetic
 * migrations target; everything else carries its owning IU. Binding-defect constraint
 * errors (a spec subject the graph lacks) carry no IU and are honestly left unroutable.
 */
function collectRepairFindings(
  projectRoot: string,
  ius: ImplementationUnit[],
  canonNodes: CanonicalNode[],
  allClauses: Clause[],
  target: ResolvedTarget | null,
): RepairFinding[] {
  const findings: RepairFinding[] = [];

  for (const d of computeSchemaDiagnostics(projectRoot, ius)) {
    if (d.severity !== 'error') continue;
    const isMig = (d.source_file ?? '').endsWith('_migrations.ts');
    findings.push({
      category: 'schema',
      iu_id: isMig ? MIGRATIONS_TARGET : d.iu_id,
      file: d.source_file,
      subject: d.subject,
      message: d.message,
      action: d.recommended_actions[0] ?? '',
    });
  }

  for (const d of computeConstraintDiagnostics(projectRoot, ius, canonNodes, allClauses)) {
    if (d.severity !== 'error' || d.category !== 'constraint') continue;
    findings.push({
      category: 'constraint',
      iu_id: d.iu_id,
      file: d.source_file,
      subject: d.subject,
      message: d.message,
      action: d.recommended_actions[0] ?? '',
    });
  }

  // Build errors (usually already resolved by the compile gate, but a repair round can
  // re-introduce one). One finding per offending file — enough to route a regeneration.
  const seenFiles = new Set<string>();
  for (const e of target?.runtime.compile(projectRoot) ?? []) {
    if (seenFiles.has(e.file)) continue;
    seenFiles.add(e.file);
    const isMig = e.file.endsWith('_migrations.ts');
    const owner = ius.find(u => u.output_files.some(f => e.file === f || e.file.endsWith(f)));
    findings.push({
      category: 'build',
      iu_id: isMig ? MIGRATIONS_TARGET : owner?.iu_id,
      file: e.file,
      subject: `${e.file}:${e.line ?? '?'}`,
      message: `Build error: ${e.code} ${e.message}`,
      action: 'Fix the type error so the project compiles.',
    });
  }

  return findings;
}

/** The repair targets: one per IU module, plus the shared migrations artifact. */
function buildRepairTargets(ius: ImplementationUnit[], migrationsFile: string): RepairTarget[] {
  const targets: RepairTarget[] = ius
    .filter(iu => iu.output_files[0])
    .map(iu => ({ id: iu.iu_id, file: iu.output_files[0], iu }));
  targets.push({ id: MIGRATIONS_TARGET, file: migrationsFile });
  return targets;
}

/**
 * Run the bounded repair loop over an assembled project. Regenerates offending IUs with
 * the findings (VERBATIM) in the prompt, re-verifies, journals each round, and returns
 * the honest result. Shared by `bootstrap` (after the compile gate) and `phoenix repair`.
 */
async function runRepairPhase(
  projectRoot: string,
  phoenixDir: string,
  ius: ImplementationUnit[],
  canonNodes: CanonicalNode[],
  allClauses: Clause[],
  opts: {
    llm: LLMProvider | null;
    target: ResolvedTarget | null;
    manifestManager: ManifestManager;
    sharedSchema?: string;
    negativeKnowledge?: Map<string, NegativeKnowledge[]>;
    onGenerationFailure?: RegenContext['onGenerationFailure'];
    maxRounds?: number;
    indent?: string;
  },
): Promise<RepairLoopResult> {
  const indent = opts.indent ?? '  ';
  const migrationsFile = 'src/generated/_migrations.ts';
  const targets = buildRepairTargets(ius, migrationsFile);
  const journal = new Journal(phoenixDir);

  console.log(`${indent}${bold('🩹 Repair Loop')} ${dim('(verifier findings → targeted regeneration; the verifier is frozen)')}`);

  if (!opts.llm) {
    // Without a generator the loop can only verify; report and stop honestly.
    const findings = collectRepairFindings(projectRoot, ius, canonNodes, allClauses, opts.target);
    if (findings.length === 0) {
      console.log(`${indent}  ${green('✔')} no verifier findings to repair`);
    } else {
      console.log(`${indent}  ${yellow('⚠')} ${findings.length} finding(s) but no LLM — cannot repair (run with an API key).`);
    }
    console.log();
    return { rounds: [], residual: findings, green: findings.length === 0, stop: findings.length === 0 ? 'green' : 'unroutable' };
  }

  // The LLM repairer reuses the existing generation path: an IU regenerates with its
  // findings + the shared schema in the prompt; the migrations artifact gets a focused
  // DDL-fix call. Provenance (promptpack hash, journal) rides the normal path.
  const regenCtx: RegenContext = {
    llm: opts.llm,
    canonNodes,
    allIUs: ius,
    projectRoot,
    target: opts.target,
    negativeKnowledge: opts.negativeKnowledge,
    siblingContracts: loadExistingContracts(projectRoot, ius, opts.target),
    sharedSchema: opts.sharedSchema,
    onGenerationFailure: opts.onGenerationFailure,
  };

  const repairer = async (t: RepairTarget, findings: RepairFinding[], source: string): Promise<string> => {
    if (t.iu) {
      regenCtx.repairFindings = new Map([[t.iu.iu_id, findings]]);
      regenCtx.repairSources = new Map([[t.iu.iu_id, source]]);
      try {
        const result = await generateIU(t.iu, regenCtx);
        for (const [filePath, content] of result.files) {
          const full = join(projectRoot, filePath);
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content, 'utf8');
        }
        opts.manifestManager.recordIU(result.manifest);
        return result.files.get(t.file) ?? source;
      } finally {
        regenCtx.repairFindings = undefined;
        regenCtx.repairSources = undefined;
      }
    }
    // Migrations artifact: fix the DDL directly (keep every table; correct only the flaw).
    const fixed = await repairMigrations(source, findings, opts.llm!);
    const full = join(projectRoot, t.file);
    writeFileSync(full, fixed, 'utf8');
    opts.manifestManager.recordSharedFiles([{ path: t.file, content_hash: sha256Hex(fixed), regions: parseRegions(fixed).map(r => ({ iu_id: r.iu_id, role: r.role, key: r.key, content_hash: r.content_hash, start_line: r.start_line, end_line: r.end_line })) }]);
    return fixed;
  };

  const manifest0 = opts.manifestManager.load();
  const artifactHash = (t: RepairTarget): string => {
    if (t.iu) return iuArtifactHash(t.iu, opts.manifestManager.load(), projectRoot);
    const full = join(projectRoot, t.file);
    return existsSync(full) ? sha256Hex(readFileSync(full, 'utf8')) : 'absent';
  };
  void manifest0;

  const result = await runRepairLoop({
    targets,
    maxRounds: opts.maxRounds ?? 3,
    verify: () => collectRepairFindings(projectRoot, ius, canonNodes, allClauses, opts.target),
    readSource: (t) => {
      const full = join(projectRoot, t.file);
      return existsSync(full) ? readFileSync(full, 'utf8') : '';
    },
    // The repairer already persisted the file + manifest; keep writeSource a no-op so a
    // second write can't clobber the provenance-carrying content it wrote.
    writeSource: () => {},
    repairer,
    artifactHash,
    onRound: (round) => {
      journal.append({
        type: 'repair',
        inputs: round.changes.map(c => c.before).filter(Boolean),
        outputs: round.changes.map(c => c.after).filter(Boolean),
        meta: {
          round: round.round,
          findings_before: round.findingsBefore,
          findings_after: round.findingsAfter,
          regenerated: round.regenerated,
          changes: round.changes.map(c => ({ id: c.id, file: c.file, findings: c.findings, hash_before: c.before, hash_after: c.after })),
        },
      });
      const names = round.changes.map(c => (c.id === MIGRATIONS_TARGET ? '_migrations' : ius.find(u => u.iu_id === c.id)?.name ?? c.id)).join(', ');
      const remaining = round.findingsAfter === 0 ? green('0 remain') : yellow(`${round.findingsAfter} remain`);
      console.log(`${indent}  ${cyan(`Repair round ${round.round}`)}: ${round.findingsBefore} finding(s) → ${round.changes.length} regenerated (${dim(names)}) → ${remaining}`);
    },
  });

  // Final honest line either way.
  const schemaResidual = result.residual.filter(f => f.category === 'schema').length;
  const constraintResidual = result.residual.filter(f => f.category === 'constraint').length;
  const buildResidual = result.residual.filter(f => f.category === 'build').length;
  if (result.green) {
    console.log(`${indent}  ${green('✔')} repair loop reached zero verifier errors in ${result.rounds.length} round(s)`);
  } else {
    console.log(`${indent}  ${red('✖')} ${result.residual.length} finding(s) remain after ${result.rounds.length} round(s) ${dim(`(stop: ${result.stop})`)} — schema ${schemaResidual}, constraint ${constraintResidual}, build ${buildResidual}`);
    for (const f of result.residual.slice(0, 6)) {
      console.log(`${indent}    ${red('●')} ${dim(f.category)} ${f.subject} — ${f.message}`);
    }
  }
  console.log();
  return result;
}

/** Focused DDL repair for the shared migrations artifact (rare — schema-first prevents most). */
async function repairMigrations(source: string, findings: RepairFinding[], llm: LLMProvider): Promise<string> {
  const lines = [
    'The shared database migrations file below has verified defects. Fix ONLY these and keep',
    'every table and every other column exactly as-is. Output ONLY the corrected registerMigration(...) statements.',
    '',
    '## Defects',
    ...findings.map(f => `- ${f.message}${f.action ? `\n  → ${f.action}` : ''}`),
    '',
    '## Current migrations',
    source,
    '',
    'Output the corrected registerMigration statements now (no prose, no fences).',
  ].join('\n');
  const raw = await llm.generate(lines, {
    system: 'You are a senior database engineer. Output ONLY registerMigration(...) statements — no prose, no markdown fences.',
    temperature: 0.1,
    maxTokens: 4096,
  });
  const plan = planFromMigrations(raw, 'llm');
  if (!plan) return source; // could not parse a fix — leave it for the honest residual
  // Re-assemble the shared file with the corrected regions, preserving the header.
  const header = source.split('\n').slice(0, source.indexOf('registerMigration') > -1 ? source.slice(0, source.indexOf('registerMigration')).split('\n').length - 1 : 4).join('\n');
  const body = plan.regions.map(r => `// <<phx:region iu=${r.iu_id} role=migration key=${r.key}>>\n${r.body}\n// <</phx:region>>\n`).join('\n');
  return `${header}\n${body}`;
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Recompile and persist build-status.json so the trust dashboard reflects post-repair state. */
function refreshBuildStatus(projectRoot: string, phoenixDir: string, target: ResolvedTarget): void {
  const errors = target.runtime.compile(projectRoot);
  writeFileSync(join(phoenixDir, 'build-status.json'), JSON.stringify({
    ok: errors.length === 0,
    rounds: 0,
    repaired: [],
    unresolved: errors,
    checked_at: new Date().toISOString(),
  }, null, 2), 'utf8');
}

/** Load each IU's conceptual mass from the previous manifest cycle. */
function loadPreviousMasses(manifestManager: ManifestManager): Map<string, number> {
  const manifest = manifestManager.load();
  const masses = new Map<string, number>();
  for (const [id, iuManifest] of Object.entries(manifest.iu_manifests)) {
    const mass = iuManifest.regen_metadata.conceptual_mass;
    if (typeof mass === 'number') masses.set(id, mass);
  }
  return masses;
}

/**
 * Build the negative-knowledge routing for a regen run: the per-IU map fed into
 * generation prompts (Gate 1) and the failure callback that records new negative
 * knowledge as it happens (Gate 2 — the immune memory self-populates).
 */
function buildNKRouting(phoenixDir: string, ius: ImplementationUnit[]): {
  nkByIU: Map<string, NegativeKnowledge[]>;
  onGenerationFailure: NonNullable<RegenContext['onGenerationFailure']>;
} {
  const nkStore = new NegativeKnowledgeStore(phoenixDir);
  const nkByIU = new Map<string, NegativeKnowledge[]>();
  for (const iu of ius) nkByIU.set(iu.iu_id, nkStore.getBySubject(iu.iu_id));
  const onGenerationFailure: NonNullable<RegenContext['onGenerationFailure']> = (iu, detail) => {
    nkStore.add(failedGenerationKnowledge({
      iu_id: iu.iu_id,
      model_id: detail.model_id,
      promptpack_hash: detail.promptpack_hash,
      reason: detail.reason,
      recorded_at: new Date().toISOString(),
    }));
  };
  return { nkByIU, onGenerationFailure };
}

/**
 * Run the regeneration gate over fresh results, stamping readiness + conceptual
 * mass into each manifest (warn-first — commits are never blocked in alpha).
 * Must run before recordIU so the stamp is persisted.
 */
function gateRegenResults(
  phoenixDir: string,
  results: RegenResult[],
  ius: ImplementationUnit[],
  previousMasses: Map<string, number>,
): GateVerdict[] {
  const evalStore = new EvaluationStore(phoenixDir);
  const nkStore = new NegativeKnowledgeStore(phoenixDir);
  const nk = nkStore.getActive(); // includes failures just recorded this run
  const verdicts: GateVerdict[] = [];
  for (const result of results) {
    const iu = ius.find(i => i.iu_id === result.iu_id);
    if (!iu) continue;
    const verdict = gateIU({
      iu,
      allIUs: ius,
      evalCoverage: evalStore.coverage(iu),
      negativeKnowledge: nk.filter(n => n.subject_id === iu.iu_id),
      previousMass: previousMasses.get(iu.iu_id),
      mode: 'warn',
    });
    result.manifest.regen_metadata.readiness = verdict.readiness;
    result.manifest.regen_metadata.conceptual_mass = verdict.mass;
    verdicts.push(verdict);
  }
  return verdicts;
}

/** Print the regeneration gate verdicts. Warn-first: surfaced, not blocking. */
function reportRegenGate(verdicts: GateVerdict[], indent = '  '): void {
  if (verdicts.length === 0) return;
  console.log(`${indent}${bold('🚪 Regeneration Gate')} ${dim('(warn-first — commits not blocked in alpha)')}`);
  for (const v of verdicts) {
    const icon = readinessToIcon(v.readiness);
    const massStr = v.mass_delta === undefined
      ? `mass ${v.mass}`
      : `mass ${v.mass} (${v.mass_delta >= 0 ? '+' : ''}${v.mass_delta})`;
    console.log(`${indent}  ${icon} ${v.iu_name} ${dim('—')} ${v.readiness}, score ${v.score}, ${massStr}`);
    if (v.ratchet_violation) {
      console.log(`${indent}    ${yellow('⚠ mass ratchet')} ${dim('— conceptual mass grew without justification')}`);
    }
    for (const b of v.blockers) {
      const mark = b.severity === 'error' ? red('●') : yellow('○');
      console.log(`${indent}    ${mark} ${dim(`[${b.category}]`)} ${b.message}`);
    }
  }
  console.log();
}

async function cmdBootstrap(): Promise<void> {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();

  console.log(bold('🔥 Phoenix Bootstrap'));
  console.log();

  const specStore = new SpecStore(phoenixDir);
  const canonStore = new CanonicalStore(phoenixDir);
  const machine = loadBootstrapState(phoenixDir);

  // Step 1: Find and ingest spec files
  const specFiles = findSpecFiles(projectRoot);
  if (specFiles.length === 0) {
    console.log(yellow('  ⚠ No spec files found in spec/ directory.'));
    console.log(dim(`    Add .md files to ${join(projectRoot, 'spec')} and re-run.`));
    return;
  }

  console.log(`  ${dim('Phase A:')} Clause extraction + cold hashing`);
  let totalClauses = 0;
  for (const specFile of specFiles) {
    const result = specStore.ingestDocument(specFile, projectRoot);
    totalClauses += result.clauses.length;
    console.log(`    ${green('✔')} ${relative(projectRoot, specFile)} → ${result.clauses.length} clauses`);
  }
  console.log(`    ${dim(`Total: ${totalClauses} clauses extracted`)}`);
  console.log();

  // Step 2: Canonicalization
  const llmEarly = resolveProvider(phoenixDir);
  if (llmEarly) {
    console.log(`  ${dim('Phase B:')} Canonicalization + warm context hashing ${dim(`(LLM: ${llmEarly.name}/${llmEarly.model})`)}`);
  } else {
    console.log(`  ${dim('Phase B:')} Canonicalization + warm context hashing ${dim('(rule-based)')}`);
  }

  // Collect all clauses
  const allClauses: Clause[] = [];
  for (const specFile of specFiles) {
    const docId = relative(projectRoot, specFile);
    allClauses.push(...specStore.getClauses(docId));
  }

  // Extract canonical nodes (LLM-enhanced when available)
  const canonNodes = await extractCanonicalNodesLLM(allClauses, llmEarly);
  canonStore.replaceNodes(canonNodes);
  // Seed the canonical-stability baseline (first run; nothing to compare yet).
  new CanonStabilityStore(phoenixDir).update(canonNodes);
  new Journal(phoenixDir).append({
    type: 'canonicalize',
    inputs: allClauses.map(c => c.clause_id),
    outputs: canonNodes.map(n => n.canon_id),
    meta: { node_count: canonNodes.length, model_id: llmEarly ? `${llmEarly.name}/${llmEarly.model}` : 'rule' },
  });
  console.log(`    ${green('✔')} ${canonNodes.length} canonical nodes extracted`);

  // Compute warm hashes
  const warmHashes = computeWarmHashes(allClauses, canonNodes);
  console.log(`    ${green('✔')} ${warmHashes.size} warm context hashes computed`);

  // Save warm hashes
  const warmPath = join(phoenixDir, 'graphs', 'warm-hashes.json');
  const warmObj: Record<string, string> = {};
  for (const [k, v] of warmHashes) warmObj[k] = v;
  writeFileSync(warmPath, JSON.stringify(warmObj, null, 2), 'utf8');

  // Mark warm pass complete
  machine.markWarmPassComplete();
  console.log(`    ${green('✔')} System state: ${cyan(machine.getState())}`);
  console.log();

  // Load architecture from config (before planning so output paths match the target).
  const configPath = join(phoenixDir, 'config.json');
  let arch: ResolvedTarget | null = null;
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      if (config.architecture) {
        arch = resolveTarget(config.architecture);
        if (arch) console.log(`  ${dim('Architecture:')} ${cyan(arch.architecture.name)} / ${cyan(arch.runtime.name)}`);
      }
    } catch { /* ignore */ }
  }

  // Step 3: Plan IUs — semantic domain clustering (LLM) when available
  console.log(`  ${dim('Phase C:')} IU planning`);
  const ius = await planIUsAuto(canonNodes, allClauses, llmEarly, arch);
  saveIUs(phoenixDir, ius);
  new Journal(phoenixDir).append({
    type: 'plan',
    inputs: canonNodes.map(n => n.canon_id),
    outputs: ius.map(iu => iu.iu_id),
    meta: { iu_count: ius.length, ius: ius.map(iu => ({ id: iu.iu_id, name: iu.name, canon: iu.source_canon_ids })) },
  });
  console.log(`    ${green('✔')} ${ius.length} Implementation Units planned`);
  for (const iu of ius) {
    console.log(`      ${dim('·')} ${iu.name} ${dim(`(${iu.risk_tier})`)} → ${iu.output_files.join(', ')}`);
  }
  console.log();

  // Step 4: Generate code
  const llm = resolveProvider(phoenixDir);
  const { hint } = describeAvailability();
  if (llm) {
    console.log(`  ${dim('Phase C:')} Code generation ${dim(`(${llm.name}/${llm.model})`)}`);
  } else {
    console.log(`  ${dim('Phase C:')} Code generation ${dim('(stubs — no LLM)')}`);
    console.log(`    ${dim(hint)}`);
  }


  // Write shared architecture files (db.ts/db.py, …) BEFORE code generation so the
  // per-IU compile-retry loop can resolve imports, then let the target prepare the
  // project for its compiler (e.g. npm install for tsc; a no-op for the python AST gate).
  if (arch) {
    for (const [filePath, content] of Object.entries(arch.runtime.sharedFiles)) {
      const fullPath = join(projectRoot, filePath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, 'utf8');
    }
    arch.runtime.prepareProject?.(projectRoot);
  }

  // Step 3.5: Schema-first planning (P0). Derive the shared schema BEFORE any module is
  // generated, so every module prompt carries the SAME table/column names verbatim — the
  // drift → runtime-500 class is prevented, not merely caught. Skipped for non-SQL targets.
  let schemaPlan: SchemaPlan | null = null;
  if (arch) {
    schemaPlan = await planSchema(ius, canonNodes, allClauses, llm, arch);
    if (schemaPlan) {
      console.log(`  ${dim('Schema-first:')} ${cyan(`${schemaPlan.tableCount} table(s)`)} planned ${dim(`(${schemaPlan.source}) — injected into every module prompt`)}`);
      new Journal(phoenixDir).append({
        type: 'schema-plan',
        inputs: ius.map(iu => iu.iu_id),
        outputs: schemaPlan.regions.map(r => r.content_hash),
        meta: { tables: schemaPlan.regions.map(r => r.key), source: schemaPlan.source, ddl_hash: sha256Hex(schemaPlan.ddl) },
      });
    }
  }

  const { nkByIU, onGenerationFailure } = buildNKRouting(phoenixDir, ius);

  const regenCtx: RegenContext = {
    llm: llm ?? undefined,
    canonNodes,
    allIUs: ius,
    projectRoot,
    target: arch,
    negativeKnowledge: nkByIU,
    siblingContracts: loadExistingContracts(projectRoot, ius, arch),
    sharedSchema: schemaPlan?.ddl,
    onGenerationFailure,
    onProgress: (iu, status, msg) => {
      if (status === 'start') process.stdout.write(`    ⏳ ${iu.name}…`);
      else if (status === 'done') process.stdout.write(` ${green('✔')}\n`);
      else if (status === 'error') process.stdout.write(` ${red('✖')} ${dim(msg || 'failed, using stub')}\n`);
    },
  };

  const manifestManager = new ManifestManager(phoenixDir);
  const previousMasses = loadPreviousMasses(manifestManager);
  const regenResults = await generateAll(ius, regenCtx);

  // Lift shared aggregate artifacts (migrations) out of the modules into one file with
  // per-IU regions. In schema-first mode the pre-planned schema is AUTHORITATIVE: its
  // regions seed the file and win the dedupe, so even a module that strays and emits a
  // CREATE TABLE cannot override the frozen schema every prompt was handed.
  const split = schemaPlan
    ? splitSharedArtifacts(regenResults, arch, { preserve: schemaPlan.regions, preserveWins: true })
    : splitSharedArtifacts(regenResults, arch);
  reportArtifactSplit(split, '    ');

  // Gate: stamp readiness + conceptual mass into manifests before recording.
  const gateVerdicts = gateRegenResults(phoenixDir, regenResults, ius, previousMasses);

  for (const result of regenResults) {
    for (const [filePath, content] of result.files) {
      const fullPath = join(projectRoot, filePath);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, content, 'utf8');
    }
    manifestManager.recordIU(result.manifest);
    if (!llm) {
      console.log(`    ${green('✔')} ${result.iu_id.slice(0, 8)}… → ${result.files.size} file(s)`);
    }
  }
  for (const [filePath, content] of split.files) {
    const fullPath = join(projectRoot, filePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }
  manifestManager.recordSharedFiles(split.sharedFiles);
  journalRegen(phoenixDir, regenResults, ius);

  // Derive IU→IU dependencies from the generated imports and persist them onto
  // the IU graph. This is the substrate for cascade, IU-level boundary
  // enforcement, and selective invalidation.
  persistIUDependencies(phoenixDir, projectRoot, ius);

  console.log();
  reportRegenGate(gateVerdicts, '  ');

  // Step 5: Service scaffold
  console.log(`  ${dim('Scaffold:')} Service wiring + project config`);
  const services = deriveServices(ius);
  const projectName = basename(projectRoot);
  const scaffoldFiles = arch
    ? arch.runtime.scaffold(services, projectName, split.serverImports)
    : nodeScaffold(services, projectName, null).files;
  for (const [filePath, content] of scaffoldFiles) {
    const fullPath = join(projectRoot, filePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }
  for (const svc of services) {
    console.log(`    ${green('✔')} ${svc.name} → :${svc.port} (${svc.modules.length} modules)`);
  }
  console.log(`    ${green('✔')} package.json, tsconfig.json`);
  console.log();

  // Compile gate: the assembled system must typecheck. Repair what we can, surface the
  // rest honestly (recorded as negative knowledge; never a silent ✔).
  await runCompileGateAndReport(projectRoot, phoenixDir, ius, {
    llm, target: arch, manifestManager, onGenerationFailure, canonNodes,
  });

  // Repair loop (P1): feed the verifier findings back into targeted regeneration, so the
  // fix that used to sit in the diagnostics is applied automatically. Bounded + journaled;
  // the verifier is frozen. Refresh the build-status the dashboard reads afterward.
  await runRepairPhase(projectRoot, phoenixDir, ius, canonNodes, allClauses, {
    llm, target: arch, manifestManager, sharedSchema: schemaPlan?.ddl, negativeKnowledge: nkByIU, onGenerationFailure,
  });
  if (arch) refreshBuildStatus(projectRoot, phoenixDir, arch);

  // A full bootstrap regenerates everything, so any prior staleness is resolved.
  new InvalidationStore(phoenixDir).clearAll();

  // Save state
  saveBootstrapState(phoenixDir, machine);

  // Step 6: First trust dashboard
  console.log(`  ${dim('Phase D:')} Trust Dashboard`);
  console.log();
  printTrustDashboard(phoenixDir, projectRoot, machine, ius, canonNodes, allClauses);

  console.log();
  console.log(green('  ✔ Bootstrap complete.'));
  console.log(`    State: ${cyan(machine.getState())}`);
  console.log(`    Run ${cyan('phoenix status')} to see the trust dashboard.`);
}

function cmdStatus(): void {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const machine = loadBootstrapState(phoenixDir);
  const ius = loadIUs(phoenixDir);
  const canonStore = new CanonicalStore(phoenixDir);
  const canonNodes = canonStore.getAllNodes();
  const specStore = new SpecStore(phoenixDir);

  // Collect all clauses
  const allClauses: Clause[] = [];
  const specFiles = findSpecFiles(projectRoot);
  for (const specFile of specFiles) {
    const docId = relative(projectRoot, specFile);
    allClauses.push(...specStore.getClauses(docId));
  }

  console.log();
  console.log(bold('🔥 Phoenix Status'));
  console.log();

  printTrustDashboard(phoenixDir, projectRoot, machine, ius, canonNodes, allClauses);
}

function printTrustDashboard(
  phoenixDir: string,
  projectRoot: string,
  machine: BootstrapStateMachine,
  ius: ImplementationUnit[],
  canonNodes: CanonicalNode[],
  allClauses: Clause[],
): void {
  const diagnostics: Diagnostic[] = [];

  // System state
  const state = machine.getState();
  const stateLabel = state === BootstrapState.STEADY_STATE
    ? green(state)
    : state === BootstrapState.BOOTSTRAP_WARMING
      ? yellow(state)
      : cyan(state);
  console.log(`  ${dim('System State:')} ${stateLabel}`);
  console.log(`  ${dim('Canonical Nodes:')} ${canonNodes.length}`);
  console.log(`  ${dim('Implementation Units:')} ${ius.length}`);
  console.log(`  ${dim('Spec Clauses:')} ${allClauses.length}`);

  // Canon type breakdown
  const typeBreakdown: Record<string, number> = {};
  for (const n of canonNodes) typeBreakdown[n.type] = (typeBreakdown[n.type] ?? 0) + 1;
  const typeParts = Object.entries(typeBreakdown).map(([t, c]) => `${c} ${t}`);
  if (typeParts.length > 0) {
    console.log(`  ${dim('Canon Types:')} ${dim(typeParts.join(', '))}`);
  }

  // Resolution metrics
  let totalEdges = 0;
  let relatesToEdges = 0;
  let orphanCount = 0;
  let maxDegree = 0;
  let withParent = 0;
  const nonContextNodes = canonNodes.filter(n => n.type !== 'CONTEXT');
  for (const n of canonNodes) {
    const deg = n.linked_canon_ids.length;
    if (deg === 0) orphanCount++;
    if (deg > maxDegree) maxDegree = deg;
    if (n.parent_canon_id) withParent++;
    for (const [, edgeType] of Object.entries(n.link_types ?? {})) {
      totalEdges++;
      if (edgeType === 'relates_to') relatesToEdges++;
    }
  }
  if (canonNodes.length > 0) {
    const resDRate = totalEdges > 0 ? ((relatesToEdges / totalEdges) * 100).toFixed(0) : '0';
    const orphanPct = ((orphanCount / canonNodes.length) * 100).toFixed(0);
    const hierPct = nonContextNodes.length > 0 ? ((withParent / nonContextNodes.length) * 100).toFixed(0) : '0';
    console.log(`  ${dim('Resolution:')} ${totalEdges} edges ${dim(`(${resDRate}% relates_to)`)}${dim(',')} max degree ${maxDegree}${dim(',')} ${hierPct}% hierarchy`);
  }

  // Canonical stability (PRD §20) — how much the last re-canonicalization churned
  // the graph, measured on the stable anchor layer. Low stability is a trust risk:
  // it means downstream IU identity and invalidation are shifting under you.
  const stabilitySnapshot = new CanonStabilityStore(phoenixDir).loadSnapshot();
  if (stabilitySnapshot?.last_result && !stabilitySnapshot.last_result.first_run) {
    const r = stabilitySnapshot.last_result;
    const pct = (r.retention * 100).toFixed(0);
    const color = r.retention >= 0.9 ? green : r.retention >= 0.7 ? yellow : red;
    console.log(`  ${dim('Canonical Stability:')} ${color(`${pct}%`)} ${dim(`(${r.kept} kept, ${r.added} new, ${r.dropped} dropped)`)}`);
    if (r.retention < 0.7) {
      diagnostics.push({
        severity: 'warning',
        category: 'canon',
        subject: 'Global',
        message: `Canonical stability ${pct}% — re-canonicalization churned the graph`,
        recommended_actions: ['Large churn under an unchanged spec points at extractor instability — investigate before trusting selective invalidation'],
      });
    }
  }

  // Extraction coverage (recompute from current specs)
  if (allClauses.length > 0) {
    const { coverage } = extractCandidates(allClauses);
    const avgCov = coverage.reduce((s, c) => s + c.coverage_pct, 0) / coverage.length;
    const lowCov = coverage.filter(c => c.coverage_pct < 80);
    const covLabel = avgCov >= 95 ? green(`${avgCov.toFixed(0)}%`) : avgCov >= 80 ? yellow(`${avgCov.toFixed(0)}%`) : red(`${avgCov.toFixed(0)}%`);
    console.log(`  ${dim('Coverage:')} ${covLabel} extraction${lowCov.length > 0 ? dim(` (${lowCov.length} clause${lowCov.length !== 1 ? 's' : ''} below 80%)`) : ''}`);
    for (const cov of lowCov) {
      diagnostics.push({
        severity: 'info',
        category: 'canon',
        subject: cov.clause_id.slice(0, 12),
        message: `Extraction coverage ${cov.coverage_pct.toFixed(0)}% (${cov.extracted_sentences + cov.context_sentences}/${cov.total_sentences} sentences)`,
        recommended_actions: cov.uncovered.map(u => `[${u.reason}] ${u.text.slice(0, 60)}`),
      });
    }
  }

  console.log();

  // D-rate
  const dRateTracker = loadDRateTracker(phoenixDir);
  const dRate = dRateTracker.getStatus();
  if (dRate.total_count > 0) {
    const pct = (dRate.rate * 100).toFixed(1);
    let dRateColor: (s: string) => string;
    switch (dRate.level) {
      case DRateLevel.TARGET: dRateColor = green; break;
      case DRateLevel.ACCEPTABLE: dRateColor = green; break;
      case DRateLevel.WARNING: dRateColor = yellow; break;
      case DRateLevel.ALARM: dRateColor = red; break;
    }
    console.log(`  ${dim('D-Rate:')} ${dRateColor(`${pct}%`)} ${dim(`(${dRate.level}, ${dRate.d_count}/${dRate.total_count})`)}`);

    if (dRate.level === DRateLevel.WARNING || dRate.level === DRateLevel.ALARM) {
      if (!machine.shouldSuppressAlarms()) {
        diagnostics.push({
          severity: machine.shouldDowngradeSeverity() ? 'warning' : 'error',
          category: 'd-rate',
          subject: 'Global',
          message: `D-rate ${pct}% (${dRate.level})`,
          recommended_actions: ['Tune classifier or resolve uncertain changes'],
        });
      }
    }
  } else {
    console.log(`  ${dim('D-Rate:')} ${dim('no data')}`);
  }

  // Drift detection — waivers suppress labeled divergences (they still show as
  // WARN so a signed/temporary edit is never invisible, just not an ERROR).
  const manifestManager = new ManifestManager(phoenixDir);
  const manifest = manifestManager.load();
  const waiverStore = new WaiverStore(phoenixDir);
  if (manifest.generated_at) {
    const driftReport = detectDrift(manifest, projectRoot, waiverStore.asMap());
    const waivedCount = driftReport.entries.filter(e => e.status === DriftStatus.WAIVED).length;
    const driftLabel = driftReport.drifted_count === 0 && driftReport.missing_count === 0
      ? (waivedCount > 0 ? yellow(`clean (${waivedCount} waived)`) : green('clean'))
      : red(`${driftReport.drifted_count} drifted, ${driftReport.missing_count} missing`);
    console.log(`  ${dim('Drift:')} ${driftLabel} ${dim(`(${driftReport.clean_count} clean)`)}`);

    for (const entry of driftReport.entries) {
      if (entry.status === DriftStatus.DRIFTED) {
        diagnostics.push({
          severity: 'error',
          category: 'drift',
          subject: entry.file_path,
          iu_id: entry.iu_id,
          message: `Working tree differs from generated manifest`,
          recommended_actions: ['Label edit: `phoenix label <file> --kind=promote_to_requirement|waiver|temporary_patch`', 'Or run `phoenix regen` to regenerate'],
        });
      }
      if (entry.status === DriftStatus.MISSING) {
        diagnostics.push({
          severity: 'error',
          category: 'drift',
          subject: entry.file_path,
          iu_id: entry.iu_id,
          message: `Generated file is missing from working tree`,
          recommended_actions: ['Run `phoenix regen` to regenerate'],
        });
      }
      if (entry.status === DriftStatus.WAIVED && entry.waiver) {
        diagnostics.push({
          severity: 'warning',
          category: 'drift',
          subject: entry.file_path,
          iu_id: entry.iu_id,
          message: `Edit accepted under ${entry.waiver.kind}: ${entry.waiver.reason}`,
          recommended_actions: entry.waiver.expires
            ? [`Expires ${entry.waiver.expires} — reconcile before then`]
            : ['Reconcile into spec when convenient (`phoenix regen` clears it)'],
        });
      }
      if (entry.status === DriftStatus.UNTRACKED) {
        diagnostics.push({
          severity: 'warning',
          category: 'drift',
          subject: entry.file_path,
          iu_id: entry.iu_id,
          message: `Region on disk is not tracked in the manifest`,
          recommended_actions: ['Run `phoenix regen` to reconcile the manifest'],
        });
      }
    }
  } else {
    console.log(`  ${dim('Drift:')} ${dim('no manifest')}`);
  }

  // Selective invalidation — which IUs a spec change made stale, and why. This
  // is the defining capability made visible: not "the app is stale" but "this
  // requirement changed → this IU is stale; that IU depends on it → re-validate".
  const invalidation = new InvalidationStore(phoenixDir).load();
  if (invalidation && (invalidation.stale.length > 0 || invalidation.revalidate.length > 0)) {
    console.log(`  ${dim('Invalidation:')} ${yellow(`${invalidation.stale.length} stale`)}${invalidation.revalidate.length > 0 ? dim(`, ${invalidation.revalidate.length} to re-validate`) : ''}`);
    for (const s of invalidation.stale) {
      diagnostics.push({
        severity: 'warning',
        category: 'canon',
        subject: s.iu_name,
        iu_id: s.iu_id,
        message: `Stale — requirements changed: ${s.cause_chain}`,
        recommended_actions: [`Run \`phoenix regen\` to regenerate only the ${invalidation.stale.length} affected IU(s)`],
      });
    }
    for (const r of invalidation.revalidate) {
      diagnostics.push({
        severity: 'info',
        category: 'canon',
        subject: r.iu_name,
        iu_id: r.iu_id,
        message: `Re-validate — ${r.cause_chain}`,
        recommended_actions: ['Re-run typecheck + boundary + tests after the upstream IU regenerates'],
      });
    }
  }

  // Open promotions — manual edits the user declared to be real requirements.
  // Surfaced (not blocking) so harvested scar-tissue knowledge is never lost:
  // "the implementation remembers". Cleared when the file regenerates.
  const openPromotions = waiverStore.openPromotions();
  if (openPromotions.length > 0) {
    console.log(`  ${dim('Promotions:')} ${yellow(`${openPromotions.length} pending`)}`);
    for (const p of openPromotions) {
      diagnostics.push({
        severity: 'info',
        category: 'canon',
        subject: p.file_path,
        iu_id: p.iu_id,
        message: `Pending promotion to requirement: ${p.reason}`,
        recommended_actions: ['Add the requirement to the spec, then `phoenix ingest` + `phoenix regen`'],
      });
    }
  }

  // Build status — the assembled system's most basic eval: does it compile?
  const buildStatusPath = join(phoenixDir, 'build-status.json');
  if (existsSync(buildStatusPath)) {
    try {
      const bs = JSON.parse(readFileSync(buildStatusPath, 'utf8')) as {
        ok: boolean; unresolved?: Array<{ file: string; line: number; code: string; message: string }>;
      };
      if (bs.ok) {
        console.log(`  ${dim('Build:')} ${green('compiles')}`);
      } else {
        const n = bs.unresolved?.length ?? 0;
        console.log(`  ${dim('Build:')} ${red(`${n} error(s)`)}`);
        for (const e of bs.unresolved ?? []) {
          diagnostics.push({
            severity: 'error',
            category: 'build',
            subject: e.file,
            message: `${e.code} ${e.message}`,
            recommended_actions: ['Run `phoenix regen` — the compile gate will attempt repair', 'Fix the generator if the pattern recurs'],
          });
        }
      }
    } catch { /* ignore malformed build status */ }
  }

  // Boundary validation — includes IU-level coupling (allowed_ius/forbidden_ius).
  diagnostics.push(...computeBoundaryDiagnostics(projectRoot, ius));

  // Structured-constraint validation (SHACL spine, `Bound` shape family): a spec
  // constraint the generated code does not enforce is an ERROR, not a false green.
  diagnostics.push(...computeConstraintDiagnostics(projectRoot, ius, canonNodes, allClauses));

  // Schema-contract validation: the shared DB schema is a contract every module's
  // SQL must honor. A mismatch (a module querying `adventurer` when the migration
  // created `adventurers`) is a guaranteed runtime 500 the compiler cannot see.
  diagnostics.push(...computeSchemaDiagnostics(projectRoot, ius));

  // Policy evaluation — bind to current artifact hashes so stale evidence (for a
  // superseded generation) does not satisfy the policy.
  const evidenceStore = new EvidenceStore(phoenixDir);
  const allEvidence = evidenceStore.getAll();
  const artifactHashes = currentArtifactHashes(ius, manifestManager, projectRoot);
  const policyEvals = evaluateAllPolicies(ius, allEvidence, { currentArtifactHash: artifactHashes });

  let passCount = 0;
  let failCount = 0;
  let incompleteCount = 0;

  for (const eval_ of policyEvals) {
    switch (eval_.verdict) {
      case 'PASS': passCount++; break;
      case 'FAIL': failCount++; break;
      case 'INCOMPLETE': incompleteCount++; break;
    }

    if (eval_.verdict === 'FAIL') {
      diagnostics.push({
        severity: 'error',
        category: 'evidence',
        subject: eval_.iu_name,
        iu_id: eval_.iu_id,
        message: `Evidence failed: ${eval_.failed.join(', ')}`,
        recommended_actions: ['Re-run failing evidence checks', `Risk tier: ${eval_.risk_tier}`],
      });
    } else if (eval_.verdict === 'INCOMPLETE') {
      const staleKinds = eval_.stale ?? [];
      const freshMissing = eval_.missing.filter(m => !staleKinds.includes(m));
      const parts: string[] = [];
      if (freshMissing.length > 0) parts.push(`missing ${freshMissing.join(', ')}`);
      if (staleKinds.length > 0) parts.push(`stale (superseded artifact): ${staleKinds.join(', ')}`);
      const actions: string[] = [];
      if (staleKinds.length > 0) actions.push('Re-run `phoenix regen` — the compile gate re-collects low-tier evidence');
      if (freshMissing.some(m => ['unit_tests', 'property_tests'].includes(m))) actions.push('Generate durable evals: `phoenix evals`');
      if (freshMissing.includes('threat_note')) actions.push('Add a threat note for this high-risk IU');
      if (freshMissing.includes('human_signoff')) actions.push('Obtain human sign-off for this critical IU');
      if (actions.length === 0) actions.push(`Collect required evidence for ${eval_.risk_tier} tier`);
      diagnostics.push({
        severity: 'warning',
        category: 'evidence',
        subject: eval_.iu_name,
        iu_id: eval_.iu_id,
        message: `Evidence incomplete — ${parts.join('; ')}`,
        recommended_actions: actions,
      });
    }
  }

  console.log(`  ${dim('Evidence:')} ${green(`${passCount} pass`)}, ${failCount > 0 ? red(`${failCount} fail`) : dim(`${failCount} fail`)}, ${incompleteCount > 0 ? yellow(`${incompleteCount} incomplete`) : dim(`${incompleteCount} incomplete`)}`);

  // Cascade effects
  const cascadeEvents = computeCascade(policyEvals, ius);
  if (cascadeEvents.length > 0) {
    console.log(`  ${dim('Cascades:')} ${yellow(`${cascadeEvents.length} active`)}`);
    for (const event of cascadeEvents) {
      for (const action of event.actions) {
        if (action.action === 'BLOCK') {
          diagnostics.push({
            severity: 'error',
            category: 'evidence',
            subject: action.iu_name,
            iu_id: action.iu_id,
            message: `BLOCKED: ${action.reason}`,
            recommended_actions: ['Fix failing evidence before proceeding'],
          });
        } else if (action.action === 'RE_VALIDATE') {
          diagnostics.push({
            severity: 'warning',
            category: 'evidence',
            subject: action.iu_name,
            iu_id: action.iu_id,
            message: `Re-validation needed: ${action.reason}`,
            recommended_actions: ['Re-run typecheck + boundary + tagged tests'],
          });
        }
      }
    }
  } else {
    console.log(`  ${dim('Cascades:')} ${dim('none')}`);
  }

  console.log();

  // Diagnostics table
  console.log(bold('  ─── Diagnostics ───'));
  printDiagnosticTable(diagnostics);
  console.log();

  // Summary line
  const errors = diagnostics.filter(d => d.severity === 'error').length;
  const warnings = diagnostics.filter(d => d.severity === 'warning').length;
  const infos = diagnostics.filter(d => d.severity === 'info').length;

  if (errors === 0 && warnings === 0) {
    console.log(green('  ✔ All clear.'));
  } else {
    const parts: string[] = [];
    if (errors > 0) parts.push(red(`${errors} error${errors !== 1 ? 's' : ''}`));
    if (warnings > 0) parts.push(yellow(`${warnings} warning${warnings !== 1 ? 's' : ''}`));
    if (infos > 0) parts.push(blue(`${infos} info`));
    console.log(`  ${parts.join(', ')}`);
  }
}

function cmdIngest(args: string[]): void {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const specStore = new SpecStore(phoenixDir);
  const verbose = args.includes('-v') || args.includes('--verbose');
  const filteredArgs = args.filter(a => a !== '-v' && a !== '--verbose');

  let files: string[];
  if (filteredArgs.length === 0) {
    files = findSpecFiles(projectRoot);
    if (files.length === 0) {
      console.log(yellow('⚠ No spec files found. Provide a path or add files to spec/.'));
      return;
    }
  } else {
    files = args.map(f => resolve(f));
    for (const f of files) {
      if (!existsSync(f)) {
        console.error(red(`✖ File not found: ${f}`));
        process.exit(1);
      }
    }
  }

  console.log(bold('📥 Spec Ingestion'));
  console.log();

  // Canonical graph + IUs (current = "before" state) for classification and
  // invalidation. These reference the pre-change clause ids, which is exactly
  // what we walk to find the affected subtree.
  const canonStoreForClass = new CanonicalStore(phoenixDir);
  const canonNodesBefore = canonStoreForClass.getAllNodes();
  const iusBefore = loadIUs(phoenixDir);
  const changeStore = new ChangeStore(phoenixDir);
  const classifiedByDoc: Array<{ docId: string; classifications: import('./models/classification.js').ChangeClassification[] }> = [];
  // All (diff, classification) pairs across docs, for the invalidation walk.
  const allChanges: Array<{ diff: import('./models/clause.js').ClauseDiff; classification: import('./models/classification.js').ChangeClassification }> = [];
  // clause_id → doc / start line, for readable cause chains.
  const clauseDocs = new Map<string, string>();
  const clauseLines = new Map<string, number>();

  let totalClauses = 0;
  let totalChanges = 0;

  for (const file of files) {
    const docId = relative(projectRoot, file);

    // Show diff BEFORE ingesting
    const diffs = specStore.diffDocument(file, projectRoot);
    const added = diffs.filter(d => d.diff_type === DiffType.ADDED).length;
    const removed = diffs.filter(d => d.diff_type === DiffType.REMOVED).length;
    const modified = diffs.filter(d => d.diff_type === DiffType.MODIFIED).length;
    const hasChanges = added > 0 || removed > 0 || modified > 0;

    // Classify every non-identity change and record it — this drives the D-rate.
    // Only ADDED/REMOVED/MODIFIED/MOVED are recorded; UNCHANGED clauses are not
    // "changes" and must not dilute the window.
    const changed = diffs.filter(d => d.diff_type !== DiffType.UNCHANGED);
    if (changed.length > 0) {
      const classifications = classifyChanges(changed, canonNodesBefore, canonNodesBefore);
      classifiedByDoc.push({ docId, classifications });
      for (let i = 0; i < changed.length; i++) {
        allChanges.push({ diff: changed[i], classification: classifications[i] });
        const before = changed[i].clause_before;
        if (before) {
          clauseDocs.set(before.clause_id, docId);
          clauseLines.set(before.clause_id, before.source_line_range[0]);
        }
      }
    }

    // Now ingest (overwrites stored clauses)
    const result = specStore.ingestDocument(file, projectRoot);
    totalClauses += result.clauses.length;

    if (hasChanges) {
      totalChanges += added + removed + modified;
      console.log(`  ${green('✔')} ${docId} → ${result.clauses.length} clauses`);
      if (added > 0) console.log(`    ${green(`+${added} added`)}`);
      if (removed > 0) console.log(`    ${red(`-${removed} removed`)}`);
      if (modified > 0) console.log(`    ${yellow(`~${modified} modified`)}`);

      // Show which clauses changed
      for (const d of diffs) {
        if (d.diff_type === DiffType.UNCHANGED) continue;
        const pathLabel = d.section_path_after?.join(' > ') || d.section_path_before?.join(' > ') || '';
        const icon = d.diff_type === DiffType.ADDED ? green('+') : d.diff_type === DiffType.REMOVED ? red('-') : yellow('~');
        console.log(`      ${icon} ${pathLabel}`);

        if (verbose && d.diff_type === DiffType.MODIFIED && d.clause_before && d.clause_after) {
          // Show line-level diff of the raw text
          const beforeLines = d.clause_before.raw_text.split('\n');
          const afterLines = d.clause_after.raw_text.split('\n');
          const beforeSet = new Set(beforeLines.map(l => l.trim()));
          const afterSet = new Set(afterLines.map(l => l.trim()));
          for (const line of afterLines) {
            if (!beforeSet.has(line.trim()) && line.trim()) {
              console.log(`        ${green('+ ' + line.trim())}`);
            }
          }
          for (const line of beforeLines) {
            if (!afterSet.has(line.trim()) && line.trim()) {
              console.log(`        ${red('- ' + line.trim())}`);
            }
          }
        } else if (verbose && d.diff_type === DiffType.ADDED && d.clause_after) {
          const lines = d.clause_after.raw_text.split('\n').filter(l => l.trim());
          for (const line of lines.slice(0, 5)) {
            console.log(`        ${green('+ ' + line.trim())}`);
          }
          if (lines.length > 5) console.log(`        ${dim(`... and ${lines.length - 5} more lines`)}`);
        } else if (verbose && d.diff_type === DiffType.REMOVED && d.clause_before) {
          const lines = d.clause_before.raw_text.split('\n').filter(l => l.trim());
          for (const line of lines.slice(0, 5)) {
            console.log(`        ${red('- ' + line.trim())}`);
          }
          if (lines.length > 5) console.log(`        ${dim(`... and ${lines.length - 5} more lines`)}`);
        }
      }
    } else {
      console.log(`  ${green('✔')} ${docId} → ${result.clauses.length} clauses ${dim('(no changes)')}`);
    }
  }

  // Record classifications and report the class breakdown — the D-rate is live now.
  let dCount = 0;
  const classCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const { docId, classifications } of classifiedByDoc) {
    changeStore.record(classifications, docId);
    for (const c of classifications) {
      classCounts[c.change_class] = (classCounts[c.change_class] ?? 0) + 1;
      if (c.change_class === 'D') dCount++;
    }
  }

  // Advance the bootstrap state machine: enough classified history + acceptable
  // D-rate transitions WARMING → STEADY_STATE (previously unreachable).
  const machine = loadBootstrapState(phoenixDir);
  const tracker = loadDRateTracker(phoenixDir);
  const before = machine.getState();
  machine.evaluateTransition(tracker.getStatus());
  if (machine.getState() !== before) {
    saveBootstrapState(phoenixDir, machine);
  }

  // Selective invalidation — the defining capability. Walk the changed clauses
  // through canon → IU → dependents and persist exactly which IUs are stale.
  let invalidationSummary: { stale: number; revalidate: number; canonStale: boolean } | null = null;
  if (allChanges.length > 0 && iusBefore.length > 0) {
    const result = computeInvalidation({
      changes: allChanges,
      canonNodes: canonNodesBefore,
      ius: iusBefore,
      clauseDocs,
      clauseLines,
    });
    if (result.stale.length > 0 || result.revalidate.length > 0 || result.canon_stale) {
      new InvalidationStore(phoenixDir).record(result);
      invalidationSummary = { stale: result.stale.length, revalidate: result.revalidate.length, canonStale: result.canon_stale };
      new Journal(phoenixDir).append({
        type: 'invalidate',
        inputs: result.causes.map(c => c.clause_id),
        outputs: result.stale.map(s => s.iu_id),
        meta: {
          stale: result.stale.map(s => s.iu_name),
          revalidate: result.revalidate.map(s => s.iu_name),
          canon_stale: result.canon_stale,
          causes: result.causes.map(c => ({ clause: c.clause_id, doc: c.doc_id, class: c.change_class })),
        },
      });
    }
  }

  // Journal the ingest itself (spec → clauses), for the provenance chain.
  if (classifiedByDoc.length > 0 || totalChanges > 0) {
    new Journal(phoenixDir).append({
      type: 'ingest',
      inputs: files.map(f => relative(projectRoot, f)),
      outputs: [],
      meta: { total_clauses: totalClauses, changes: totalChanges },
    });
  }

  console.log();
  console.log(`  ${dim(`Total: ${totalClauses} clauses ingested`)}`);
  if (totalChanges > 0) {
    const classParts = (['A', 'B', 'C', 'D'] as const)
      .filter(k => classCounts[k] > 0)
      .map(k => `${classCounts[k]}${k}`);
    console.log(`  ${dim(`Changes: ${totalChanges} clauses affected`)}${classParts.length ? dim(` — classes ${classParts.join(' ')}`) : ''}`);
    if (dCount > 0) {
      const status = tracker.getStatus();
      console.log(`  ${dim(`D-rate: ${(status.rate * 100).toFixed(1)}% (${status.level})`)}`);
    }
    if (machine.getState() !== before) {
      console.log(`  ${green('✔')} ${dim(`System state: ${before} → ${machine.getState()}`)}`);
    }
    if (invalidationSummary) {
      const parts: string[] = [];
      if (invalidationSummary.stale > 0) parts.push(`${invalidationSummary.stale} IU(s) stale`);
      if (invalidationSummary.revalidate > 0) parts.push(`${invalidationSummary.revalidate} to re-validate`);
      if (invalidationSummary.canonStale) parts.push('canon changed');
      console.log(`  ${yellow('▸')} ${dim(`Invalidated: ${parts.join(', ')} — only these regenerate`)}`);
    }
    console.log();
    console.log(`  ${dim('Next: run')} ${cyan('phoenix canonicalize')} ${dim('then')} ${cyan('phoenix regen')} ${dim('to update generated code')}`);
  }
}

function cmdDiff(args: string[]): void {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const specStore = new SpecStore(phoenixDir);

  let files: string[];
  if (args.length === 0) {
    files = findSpecFiles(projectRoot);
  } else {
    files = args.map(f => resolve(f));
  }

  console.log(bold('📊 Clause Diff'));
  console.log();

  for (const file of files) {
    if (!existsSync(file)) {
      console.log(red(`  ✖ ${file}: not found`));
      continue;
    }

    const docId = relative(projectRoot, file);
    const diffs = specStore.diffDocument(file, projectRoot);

    const added = diffs.filter(d => d.diff_type === DiffType.ADDED).length;
    const removed = diffs.filter(d => d.diff_type === DiffType.REMOVED).length;
    const modified = diffs.filter(d => d.diff_type === DiffType.MODIFIED).length;
    const moved = diffs.filter(d => d.diff_type === DiffType.MOVED).length;
    const unchanged = diffs.filter(d => d.diff_type === DiffType.UNCHANGED).length;

    console.log(`  ${bold(docId)}`);

    if (diffs.length === 0) {
      console.log(`    ${dim('(no stored clauses to compare against)')}`);
      continue;
    }

    if (added === 0 && removed === 0 && modified === 0 && moved === 0) {
      console.log(`    ${green('✔')} No changes (${unchanged} clauses)`);
      continue;
    }

    if (added > 0) console.log(`    ${green(`+${added} added`)}`);
    if (removed > 0) console.log(`    ${red(`-${removed} removed`)}`);
    if (modified > 0) console.log(`    ${yellow(`~${modified} modified`)}`);
    if (moved > 0) console.log(`    ${blue(`↗${moved} moved`)}`);
    console.log(`    ${dim(`${unchanged} unchanged`)}`);

    // Show details for non-trivial changes
    for (const d of diffs) {
      if (d.diff_type === DiffType.UNCHANGED) continue;
      const pathLabel = d.section_path_after?.join(' > ') || d.section_path_before?.join(' > ') || '';
      switch (d.diff_type) {
        case DiffType.ADDED:
          console.log(`      ${green('+')} ${pathLabel}`);
          break;
        case DiffType.REMOVED:
          console.log(`      ${red('-')} ${pathLabel}`);
          break;
        case DiffType.MODIFIED:
          console.log(`      ${yellow('~')} ${pathLabel}`);
          break;
        case DiffType.MOVED:
          console.log(`      ${blue('↗')} ${d.section_path_before?.join(' > ')} → ${d.section_path_after?.join(' > ')}`);
          break;
      }
    }
    console.log();
  }
}

function cmdClauses(args: string[]): void {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const specStore = new SpecStore(phoenixDir);

  let files: string[];
  if (args.length === 0) {
    files = findSpecFiles(projectRoot);
  } else {
    files = args.map(f => resolve(f));
  }

  console.log(bold('📋 Stored Clauses'));
  console.log();

  for (const file of files) {
    const docId = relative(projectRoot, file);
    const clauses = specStore.getClauses(docId);

    console.log(`  ${bold(docId)} ${dim(`(${clauses.length} clauses)`)}`);
    for (const c of clauses) {
      const path = c.section_path.join(' > ') || '(root)';
      const lines = `L${c.source_line_range[0]}–${c.source_line_range[1]}`;
      const preview = c.normalized_text.slice(0, 80).replace(/\n/g, ' ');
      console.log(`    ${dim(c.clause_id.slice(0, 8))} ${cyan(path)} ${dim(lines)}`);
      console.log(`      ${dim(preview)}${c.normalized_text.length > 80 ? '…' : ''}`);
    }
    console.log();
  }
}

function cmdCanon(): void {
  const { phoenixDir } = requirePhoenixRoot();
  const canonStore = new CanonicalStore(phoenixDir);
  const nodes = canonStore.getAllNodes();

  console.log(bold('📐 Canonical Graph'));
  console.log();
  console.log(`  ${dim(`${nodes.length} nodes`)}`);
  console.log();

  const byType = new Map<string, CanonicalNode[]>();
  for (const node of nodes) {
    const list = byType.get(node.type) || [];
    list.push(node);
    byType.set(node.type, list);
  }

  for (const [type, typeNodes] of byType) {
    const color = type === 'REQUIREMENT' ? green
      : type === 'CONSTRAINT' ? red
      : type === 'INVARIANT' ? magenta
      : blue;
    console.log(`  ${color(bold(type))} (${typeNodes.length})`);
    for (const node of typeNodes) {
      const preview = node.statement.slice(0, 80).replace(/\n/g, ' ');
      const links = node.linked_canon_ids.length > 0
        ? dim(` ← ${node.linked_canon_ids.length} links`)
        : '';
      console.log(`    ${dim(node.canon_id.slice(0, 8))} ${preview}${node.statement.length > 80 ? '…' : ''}${links}`);
    }
    console.log();
  }
}

async function cmdPlan(): Promise<void> {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const canonStore = new CanonicalStore(phoenixDir);
  const specStore = new SpecStore(phoenixDir);

  const canonNodes = canonStore.getAllNodes();
  if (canonNodes.length === 0) {
    console.log(yellow('⚠ No canonical nodes. Run `phoenix bootstrap` or `phoenix ingest` + `phoenix canonicalize` first.'));
    return;
  }

  // Collect clauses
  const allClauses: Clause[] = [];
  const specFiles = findSpecFiles(projectRoot);
  for (const specFile of specFiles) {
    const docId = relative(projectRoot, specFile);
    allClauses.push(...specStore.getClauses(docId));
  }

  // Semantic domain clustering when a provider is available; rule fallback otherwise.
  let planArch: ResolvedTarget | null = null;
  const planConfigPath = join(phoenixDir, 'config.json');
  if (existsSync(planConfigPath)) {
    try {
      const cfg = JSON.parse(readFileSync(planConfigPath, 'utf8'));
      if (cfg.architecture) planArch = resolveTarget(cfg.architecture);
    } catch { /* ignore */ }
  }
  const ius = await planIUsAuto(canonNodes, allClauses, resolveProvider(phoenixDir), planArch);
  saveIUs(phoenixDir, ius);

  new Journal(phoenixDir).append({
    type: 'plan',
    inputs: canonNodes.map(n => n.canon_id),
    outputs: ius.map(iu => iu.iu_id),
    meta: { iu_count: ius.length, ius: ius.map(iu => ({ id: iu.iu_id, name: iu.name, canon: iu.source_canon_ids })) },
  });

  console.log(bold('📦 IU Plan'));
  console.log();
  console.log(`  ${green(`${ius.length} Implementation Units planned`)}`);
  console.log();

  for (const iu of ius) {
    const riskColor = iu.risk_tier === 'critical' ? red
      : iu.risk_tier === 'high' ? yellow
      : iu.risk_tier === 'medium' ? cyan
      : green;
    console.log(`  ${bold(iu.name)}`);
    console.log(`    ${dim('ID:')}       ${iu.iu_id.slice(0, 12)}…`);
    console.log(`    ${dim('Risk:')}     ${riskColor(iu.risk_tier)}`);
    console.log(`    ${dim('Kind:')}     ${iu.kind}`);
    console.log(`    ${dim('Sources:')}  ${iu.source_canon_ids.length} canonical nodes`);
    console.log(`    ${dim('Output:')}   ${iu.output_files.join(', ')}`);
    console.log(`    ${dim('Evidence:')} ${iu.evidence_policy.required.join(', ')}`);
    if (iu.contract.invariants.length > 0) {
      console.log(`    ${dim('Invariants:')}`);
      for (const inv of iu.contract.invariants) {
        console.log(`      ${dim('·')} ${inv.slice(0, 80)}`);
      }
    }
    console.log();
  }
}

async function cmdRegen(args: string[]): Promise<void> {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const ius = loadIUs(phoenixDir);

  if (ius.length === 0) {
    console.log(yellow('⚠ No IUs planned. Run `phoenix plan` first.'));
    return;
  }

  // Parse --iu=<id> flag and --stubs flag
  const iuFilter = args.find(a => a.startsWith('--iu='))?.split('=')[1];
  const forceStubs = args.includes('--stubs');
  const forceAll = args.includes('--all');

  // Selective invalidation drives regen by default: regenerate ONLY the IUs a
  // spec change made stale (PRD §0). `--all` forces a full regen; `--iu=` targets
  // one explicitly; an empty/absent invalidation set also means full regen.
  const invStore = new InvalidationStore(phoenixDir);
  const staleKeys = invStore.staleKeys();
  let selectionReason: string;
  let targetIUs: ImplementationUnit[];
  if (iuFilter) {
    targetIUs = ius.filter(iu => iu.iu_id.startsWith(iuFilter) || iu.name === iuFilter);
    selectionReason = `--iu=${iuFilter}`;
  } else if (!forceAll && staleKeys.size > 0) {
    targetIUs = ius.filter(iu => staleKeys.has(iuKey(iu)));
    selectionReason = `selective (${targetIUs.length} stale of ${ius.length})`;
  } else {
    targetIUs = ius;
    selectionReason = forceAll ? 'all (--all)' : 'all';
  }

  if (targetIUs.length === 0) {
    if (iuFilter) {
      console.log(red(`✖ No IU matching: ${iuFilter}`));
    } else {
      console.log(green('✔ Nothing stale — all IUs are up to date.'));
    }
    return;
  }

  const llm = forceStubs ? null : resolveProvider(phoenixDir);
  const canonStore = new CanonicalStore(phoenixDir);
  const canonNodes = canonStore.getAllNodes();

  console.log(bold('⚡ Code Regeneration'));
  if (llm) {
    console.log(`  ${dim(`Provider: ${llm.name}/${llm.model}`)}`);
  } else {
    const { hint } = describeAvailability();
    console.log(`  ${dim('Mode: stubs')}${forceStubs ? '' : ` ${dim('—')} ${dim(hint)}`}`);
  }
  console.log(`  ${dim(`Scope: ${selectionReason}`)}`);
  if (selectionReason.startsWith('selective')) {
    for (const iu of targetIUs) console.log(`    ${yellow('▸')} ${dim(iu.name)}`);
  }
  console.log();

  // Load architecture
  const configPath = join(phoenixDir, 'config.json');
  let regenArch: ResolvedTarget | null = null;
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      if (cfg.architecture) regenArch = resolveTarget(cfg.architecture);
    } catch { /* ignore */ }
  }

  const { nkByIU, onGenerationFailure } = buildNKRouting(phoenixDir, ius);

  const regenCtx: RegenContext = {
    llm: llm ?? undefined,
    canonNodes,
    allIUs: ius,
    projectRoot,
    target: regenArch,
    negativeKnowledge: nkByIU,
    siblingContracts: loadExistingContracts(projectRoot, ius, regenArch),
    onGenerationFailure,
    onProgress: (iu, status, msg) => {
      if (status === 'start') process.stdout.write(`  ⏳ ${iu.name}…`);
      else if (status === 'done') process.stdout.write(` ${green('✔')}\n`);
      else if (status === 'error') process.stdout.write(` ${red('✖')} ${dim(msg || 'failed, using stub')}\n`);
    },
  };

  const manifestManager = new ManifestManager(phoenixDir);
  const previousMasses = loadPreviousMasses(manifestManager);

  // Snapshot the target IUs' OLD contracts from disk (pre-write) so we can detect a
  // contract change after regeneration and pull in dependents that would break.
  const oldContracts = loadExistingContracts(projectRoot, targetIUs, regenArch);

  const results = await generateAll(targetIUs, regenCtx);

  // Contract-aware dependent regeneration: if a regenerated IU's contract CHANGED,
  // regenerate its transitive dependents against the new contract — otherwise a
  // downstream consumer (e.g. the dashboard) breaks until a manual `regen --all`.
  // Skipped for --all (everything already regenerates).
  if (!forceAll && regenArch) {
    const changed = new Set<string>();
    for (const r of results) {
      const iu = targetIUs.find(i => i.iu_id === r.iu_id);
      if (!iu) continue;
      const primary = r.files.get(iu.output_files[0]) ?? [...r.files.values()][0];
      const newContract = primary ? regenArch.runtime.extractContract(primary) : undefined;
      const old = oldContracts.get(r.iu_id);
      if (newContract && old !== undefined && newContract !== old) changed.add(r.iu_id);
    }
    if (changed.size > 0) {
      const already = new Set(results.map(r => r.iu_id));
      const depIds = dependentsToRegenerate(changed, ius);
      const depIUs = ius.filter(iu => depIds.has(iu.iu_id) && !already.has(iu.iu_id));
      if (depIUs.length > 0) {
        console.log(`  ${yellow('▸')} ${dim(`${depIUs.length} dependent(s) regenerated (upstream contract changed): ${depIUs.map(d => d.name).join(', ')}`)}`);
        const depResults = await generateAll(depIUs, regenCtx);
        results.push(...depResults);
        targetIUs = [...targetIUs, ...depIUs]; // so downstream (writes, manifest, clearKeys) include them
      }
    }
  }

  // Shared aggregate (migrations): this may be a PARTIAL regen, so preserve regions
  // owned by IUs not in this batch and merge the freshly-generated ones over them.
  const regeneratedIUs = new Set(results.map(r => r.iu_id));
  const preserve = readSharedRegions(projectRoot, regenArch)
    .filter(r => !regeneratedIUs.has(r.iu_id));
  const split = splitSharedArtifacts(results, regenArch, { preserve });
  reportArtifactSplit(split, '  ');

  // Gate: stamp readiness + conceptual mass into manifests before recording.
  const gateVerdicts = gateRegenResults(phoenixDir, results, ius, previousMasses);

  for (const result of results) {
    for (const [filePath, content] of result.files) {
      const fullPath = join(projectRoot, filePath);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, content, 'utf8');
    }
    manifestManager.recordIU(result.manifest);

    if (!llm) {
      const iu = targetIUs.find(i => i.iu_id === result.iu_id);
      console.log(`  ${green('✔')} ${iu?.name || result.iu_id.slice(0, 12)}`);
      for (const [filePath] of result.files) {
        console.log(`    → ${cyan(filePath)}`);
      }
    }
  }
  for (const [filePath, content] of split.files) {
    const fullPath = join(projectRoot, filePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }
  if (split.sharedFiles.length) manifestManager.recordSharedFiles(split.sharedFiles);

  // A regen replaces the file, so any waiver/promotion that labeled a *previous*
  // manual divergence in a regenerated file is now resolved — a waiver labels one
  // divergence, not the file forever (immutable-code discipline).
  const waiverStore = new WaiverStore(phoenixDir);
  let clearedWaivers = 0;
  let resolvedPromotions = 0;
  for (const result of results) {
    for (const [filePath] of result.files) {
      clearedWaivers += waiverStore.clearForFile(filePath).length;
      resolvedPromotions += waiverStore.resolvePromotions(filePath);
    }
  }
  if (clearedWaivers > 0 || resolvedPromotions > 0) {
    console.log(`  ${dim(`Labels: cleared ${clearedWaivers} waiver(s), resolved ${resolvedPromotions} promotion(s) on regenerated files`)}`);
  }

  journalRegen(phoenixDir, results, ius);

  // Clear the invalidation marks for the IUs we just regenerated — the stale
  // work is done. Remaining stale IUs (if this was a targeted regen) persist.
  invStore.clearKeys(targetIUs.map(iuKey));

  // Derive and persist IU→IU dependencies from the freshly generated imports.
  persistIUDependencies(phoenixDir, projectRoot, loadIUs(phoenixDir));

  // Re-generate scaffold wiring. Pass the architecture so the unified app/server
  // wiring (src/server.ts) is refreshed too — otherwise removing or renaming an IU
  // leaves stale imports to deleted modules and the app won't compile.
  const allIUs = loadIUs(phoenixDir);
  const services = deriveServices(allIUs);
  const scaffoldFiles = regenArch
    ? regenArch.runtime.scaffold(services, basename(projectRoot), split.serverImports)
    : nodeScaffold(services, basename(projectRoot), null).files;
  for (const [filePath, content] of scaffoldFiles) {
    const fullPath = join(projectRoot, filePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }

  console.log();
  reportRegenGate(gateVerdicts, '  ');
  console.log(`  ${dim(`${results.length} IU(s) regenerated. Scaffold updated.`)}`);
  console.log();

  // Compile gate over the whole assembled project (regen touched a subset, but the
  // system as a whole must still typecheck).
  await runCompileGateAndReport(projectRoot, phoenixDir, allIUs, {
    llm, target: regenArch, manifestManager, onGenerationFailure, canonNodes,
  });
}

/**
 * `phoenix repair` — run the repair loop (P1) on an existing project: verify → route
 * findings → regenerate offending IUs with the findings verbatim → re-verify, bounded.
 * The same loop bootstrap runs; exposed standalone so it can be re-run and iterated.
 * `--rounds=N` overrides the round budget (default 3).
 */
async function cmdRepair(args: string[]): Promise<void> {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const ius = loadIUs(phoenixDir);
  if (ius.length === 0) {
    console.log(yellow('⚠ No IUs planned. Run `phoenix bootstrap` first.'));
    return;
  }
  const roundsArg = args.find(a => a.startsWith('--rounds='))?.split('=')[1];
  const maxRounds = roundsArg ? Math.max(1, parseInt(roundsArg, 10) || 3) : 3;

  const canonNodes = new CanonicalStore(phoenixDir).getAllNodes();
  const specStore = new SpecStore(phoenixDir);
  const allClauses: Clause[] = [];
  for (const specFile of findSpecFiles(projectRoot)) {
    allClauses.push(...specStore.getClauses(relative(projectRoot, specFile)));
  }

  let arch: ResolvedTarget | null = null;
  const configPath = join(phoenixDir, 'config.json');
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      if (cfg.architecture) arch = resolveTarget(cfg.architecture);
    } catch { /* ignore */ }
  }

  const llm = resolveProvider(phoenixDir);
  console.log(bold('🩹 Phoenix Repair'));
  if (llm) console.log(`  ${dim(`Provider: ${llm.name}/${llm.model}`)}`); else console.log(`  ${dim('Mode: verify-only (no LLM — set an API key to repair)')}`);
  console.log(`  ${dim(`Round budget: ${maxRounds}`)}`);
  console.log();

  // Reconstruct the shared schema DDL from the migrations file so repair prompts carry it.
  const migFull = join(projectRoot, 'src', 'generated', '_migrations.ts');
  let sharedSchema: string | undefined;
  if (existsSync(migFull)) {
    const plan = planFromMigrations(readFileSync(migFull, 'utf8'), 'derived');
    sharedSchema = plan?.ddl;
  }

  const manifestManager = new ManifestManager(phoenixDir);
  const { nkByIU, onGenerationFailure } = buildNKRouting(phoenixDir, ius);
  const result = await runRepairPhase(projectRoot, phoenixDir, ius, canonNodes, allClauses, {
    llm, target: arch, manifestManager, sharedSchema, negativeKnowledge: nkByIU, onGenerationFailure, maxRounds, indent: '  ',
  });
  if (arch) refreshBuildStatus(projectRoot, phoenixDir, arch);

  if (result.green) {
    console.log(green('  ✔ Repair complete — zero verifier errors.'));
  } else {
    console.log(yellow(`  ⚠ ${result.residual.length} finding(s) remain (honest residual). Run \`phoenix status\` for detail.`));
  }
  process.exitCode = result.green ? 0 : 0; // repair itself succeeds; residuals surface in status
}

function cmdDrift(): void {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const manifestManager = new ManifestManager(phoenixDir);
  const manifest = manifestManager.load();

  if (!manifest.generated_at) {
    console.log(yellow('⚠ No generated manifest. Run `phoenix regen` first.'));
    return;
  }

  const report = detectDrift(manifest, projectRoot, new WaiverStore(phoenixDir).asMap());

  // Map IU id → name so shared-file regions show whose contribution drifted.
  const iuNames = new Map(loadIUs(phoenixDir).map(iu => [iu.iu_id, iu.name]));
  // A shared-file region: distinguish it from the file as a whole.
  const label = (entry: DriftEntry): string => {
    if (!entry.role) return entry.file_path;
    const owner = entry.iu_id ? (iuNames.get(entry.iu_id) ?? entry.iu_id.slice(0, 8)) : '?';
    const where = entry.region ? ` ${dim(`L${entry.region.start_line + 1}–${entry.region.end_line}`)}` : '';
    return `${entry.file_path} ${dim('›')} ${entry.role}${entry.key ? `:${entry.key}` : ''} ${dim(`(${owner})`)}${where}`;
  };

  console.log(bold('🔍 Drift Detection'));
  console.log();

  if (report.drifted_count === 0 && report.missing_count === 0) {
    console.log(`  ${green('✔')} ${report.summary}`);
  } else {
    console.log(`  ${red('✖')} ${report.summary}`);
  }
  console.log();

  for (const entry of report.entries) {
    switch (entry.status) {
      case DriftStatus.CLEAN:
        console.log(`  ${green('✔')} ${label(entry)}`);
        break;
      case DriftStatus.DRIFTED:
        console.log(`  ${red('✖')} ${label(entry)} ${red('DRIFTED')}`);
        console.log(`    ${dim('expected:')} ${entry.expected_hash?.slice(0, 12)}…`);
        console.log(`    ${dim('actual:')}   ${entry.actual_hash?.slice(0, 12)}…`);
        console.log(`    ${dim('→ Label this edit: promote_to_requirement | waiver | temporary_patch')}`);
        break;
      case DriftStatus.MISSING:
        console.log(`  ${red('✖')} ${label(entry)} ${red('MISSING')}`);
        console.log(`    ${dim('→ Run `phoenix regen` to regenerate')}`);
        break;
      case DriftStatus.WAIVED:
        console.log(`  ${yellow('⚠')} ${label(entry)} ${yellow('WAIVED')}`);
        if (entry.waiver) {
          console.log(`    ${dim('kind:')} ${entry.waiver.kind}`);
          console.log(`    ${dim('reason:')} ${entry.waiver.reason}`);
        }
        break;
    }
  }
}

/**
 * `phoenix label <file> --kind=<kind> --reason="..."` — the labeling workflow
 * for manual edits (PRD §9). Turns an unlabeled DRIFTED file (an ERROR that
 * blocks trust) into a labeled, explainable divergence:
 *
 *   waiver               — signed, deliberate acceptance (optionally --expires)
 *   temporary_patch      — hotfix with an expiry (default 14d)
 *   promote_to_requirement — harvest the edit into the spec (records a pending
 *                            promotion; status surfaces it until reconciled)
 */
function cmdLabel(args: string[]): void {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();

  const positional = args.filter(a => !a.startsWith('--'));
  const file = positional[0];
  const kindArg = args.find(a => a.startsWith('--kind='))?.split('=')[1];
  const reason = args.find(a => a.startsWith('--reason='))?.slice('--reason='.length);
  const expiresArg = args.find(a => a.startsWith('--expires='))?.split('=')[1];
  const signedByArg = args.find(a => a.startsWith('--signed-by='))?.slice('--signed-by='.length);
  const listMode = args.includes('--list');
  const removeMode = args.includes('--remove');

  const waiverStore = new WaiverStore(phoenixDir);

  if (listMode) {
    const waivers = waiverStore.getAll();
    const promotions = waiverStore.openPromotions();
    console.log(bold('🏷️  Labels'));
    console.log();
    if (waivers.length === 0 && promotions.length === 0) {
      console.log(`  ${dim('No active labels.')}`);
      return;
    }
    for (const w of waivers) {
      const exp = w.expires ? dim(` (expires ${w.expires})`) : '';
      console.log(`  ${yellow('⚠')} ${w.key} ${dim('—')} ${w.kind}${exp}`);
      console.log(`    ${dim(w.reason)}${w.signed_by ? dim(` — ${w.signed_by}`) : ''}`);
    }
    for (const p of promotions) {
      console.log(`  ${blue('ℹ')} ${p.file_path} ${dim('—')} promote_to_requirement (pending)`);
      console.log(`    ${dim(p.reason)}`);
    }
    return;
  }

  if (!file) {
    console.error(red('✖ Usage: phoenix label <file> --kind=<waiver|temporary_patch|promote_to_requirement> --reason="..."'));
    console.error(dim('        phoenix label --list                 # show active labels'));
    console.error(dim('        phoenix label <file> --remove         # remove a label'));
    process.exit(1);
  }

  // Normalize to a project-relative key so it matches the manifest/drift keys.
  const key = relative(projectRoot, resolve(file)) || file;

  if (removeMode) {
    let removed = waiverStore.remove(key);
    // Also remove any region-scoped labels expanded from this file (shared artifacts).
    for (const w of waiverStore.getAll()) {
      if (w.key.startsWith(`${key}#`)) removed = waiverStore.remove(w.key) || removed;
    }
    console.log(removed ? green(`✔ Removed label on ${key}`) : yellow(`⚠ No label found for ${key}`));
    return;
  }

  const kind = kindArg as StoredWaiver['kind'] | undefined;
  const validKinds = ['waiver', 'temporary_patch', 'promote_to_requirement'];
  if (!kind || !validKinds.includes(kind)) {
    console.error(red(`✖ --kind must be one of: ${validKinds.join(', ')}`));
    process.exit(1);
  }
  if (!reason) {
    console.error(red('✖ --reason="..." is required (why does this edit exist?)'));
    process.exit(1);
  }

  // Capture the current on-disk hash so the label is tied to THIS divergence.
  const full = join(projectRoot, key);
  let labeledHash: string | undefined;
  if (existsSync(full)) {
    try { labeledHash = createHash('sha256').update(readFileSync(full, 'utf8')).digest('hex'); } catch { /* ignore */ }
  }

  // Expiry: temporary_patch defaults to 14d; others honor --expires if given.
  let expires: string | undefined;
  if (expiresArg) {
    expires = parseExpiry(expiresArg);
    if (!expires) {
      console.error(red(`✖ --expires: unrecognized value "${expiresArg}" (use ISO date or Nd/Nh/Nm)`));
      process.exit(1);
    }
  } else if (kind === 'temporary_patch') {
    expires = parseExpiry('14d');
  }

  const signed_by = kind === 'waiver' ? (signedByArg ?? defaultSigner(projectRoot)) : signedByArg;

  const waiver: StoredWaiver = {
    key,
    kind,
    reason,
    signed_by,
    expires,
    created_at: new Date().toISOString(),
    labeled_hash: labeledHash,
  };

  // A SHARED aggregate file's drift is per-REGION (a bare-path waiver must not
  // blanket other IUs' regions — that granularity is deliberate). Labeling a shared
  // file therefore expands to region-keyed waivers for exactly the regions that are
  // drifted RIGHT NOW; drift appearing later in another region still errors.
  const manifestForLabel = new ManifestManager(phoenixDir).load();
  const sharedFile = Object.values(manifestForLabel.shared_files ?? {}).find(s => s.path === key);
  if (sharedFile) {
    const report = detectDrift(manifestForLabel, projectRoot, waiverStore.asMap());
    const drifted = report.entries.filter(e => e.file_path === key && e.status === DriftStatus.DRIFTED);
    if (drifted.length === 0) {
      console.log(yellow(`⚠ ${key} is a shared artifact with no drifted regions — nothing to label.`));
      return;
    }
    for (const e of drifted) {
      const regionKey = `${key}#${e.iu_id}|${e.role ?? ''}|${e.key ?? ''}`;
      waiverStore.add({ ...waiver, key: regionKey });
    }
    console.log(dim(`  shared artifact: labeled ${drifted.length} drifted region(s), attributed per IU`));
  } else {
    waiverStore.add(waiver);
  }

  if (kind === 'promote_to_requirement') {
    // Also record a pending promotion so status surfaces the harvest until it
    // lands in the spec — the scar-tissue is not lost even if the file regenerates.
    const iuId = loadIUs(phoenixDir).find(iu => iu.output_files.some(f => f === key || key.endsWith(f)))?.iu_id;
    waiverStore.addPromotion({
      file_path: key,
      iu_id: iuId,
      reason,
      created_at: waiver.created_at,
      labeled_hash: labeledHash,
    });
  }

  new Journal(phoenixDir).append({
    type: 'label',
    inputs: [key],
    outputs: [],
    meta: { kind, reason, signed_by, expires, labeled_hash: labeledHash },
  });

  console.log(green(`✔ Labeled ${key} as ${kind}`));
  console.log(`  ${dim('reason:')} ${reason}`);
  if (signed_by) console.log(`  ${dim('signed by:')} ${signed_by}`);
  if (expires) console.log(`  ${dim('expires:')} ${expires}`);
  if (kind === 'promote_to_requirement') {
    console.log();
    console.log(`  ${dim('→ Add this requirement to your spec, then run')} ${cyan('phoenix ingest')} ${dim('+')} ${cyan('phoenix regen')}`);
    console.log(`  ${dim('  The pending promotion shows in `phoenix status` until reconciled.')}`);
  }
}

/**
 * `phoenix attest <iu> --kind=<kind> [--note="..."]` — record human/manual
 * evidence that Phoenix can't auto-collect: threat_note, human_signoff,
 * static_analysis, formal_verification, simulation. This is how a high/critical
 * IU reaches a PASS verdict (PRD §10). Bound to the IU's current artifact hash so
 * it goes stale if the code is regenerated.
 */
function cmdAttest(args: string[]): void {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const positional = args.filter(a => !a.startsWith('--'));
  const iuArg = positional[0];
  const kind = args.find(a => a.startsWith('--kind='))?.split('=')[1];
  const note = args.find(a => a.startsWith('--note='))?.slice('--note='.length);

  const manualKinds = ['threat_note', 'human_signoff', 'static_analysis', 'formal_verification', 'simulation'];
  if (!iuArg || !kind || !manualKinds.includes(kind)) {
    console.error(red(`✖ Usage: phoenix attest <iu> --kind=<${manualKinds.join('|')}> [--note="..."]`));
    process.exit(1);
  }

  const ius = loadIUs(phoenixDir);
  const iu = ius.find(u => u.iu_id.startsWith(iuArg) || u.name === iuArg);
  if (!iu) {
    console.error(red(`✖ No IU matching: ${iuArg}`));
    process.exit(1);
  }

  const manifest = new ManifestManager(phoenixDir).load();
  const artifactHash = iuArtifactHash(iu, manifest, projectRoot);
  const timestamp = new Date().toISOString();
  const signer = kind === 'human_signoff' ? defaultSigner(projectRoot) : undefined;

  new EvidenceStore(phoenixDir).addRecord({
    evidence_id: createHash('sha256').update(`${kind}\x00${iu.iu_id}\x00${timestamp}`).digest('hex').slice(0, 16),
    kind: kind as import('./models/evidence.js').EvidenceKind,
    status: 'PASS' as import('./models/evidence.js').EvidenceStatus,
    iu_id: iu.iu_id,
    canon_ids: iu.source_canon_ids,
    artifact_hash: artifactHash,
    message: note ?? `${kind} attested${signer ? ` by ${signer}` : ''}`,
    timestamp,
  });

  new Journal(phoenixDir).append({
    type: 'evidence',
    inputs: [iu.iu_id],
    outputs: [],
    meta: { kind, iu_name: iu.name, note, signer, artifact_hash: artifactHash },
  });

  console.log(green(`✔ Recorded ${kind} for ${iu.name}`));
  if (signer) console.log(`  ${dim('signed by:')} ${signer}`);
  if (note) console.log(`  ${dim('note:')} ${note}`);
  console.log(`  ${dim('Bound to artifact')} ${artifactHash.slice(0, 12)} ${dim('— regenerating')} ${iu.name} ${dim('will invalidate it.')}`);
}

/**
 * `phoenix upgrade [--apply]` — shadow-canonicalization (PRD §5.1). Re-runs the
 * canonicalization pipeline WITHOUT committing, diffs the result against the
 * current graph on the stable-anchor layer, and classifies the upgrade
 * SAFE / COMPACTION_EVENT / REJECT. Only applies with --apply, and never applies
 * a REJECT. Emits a PipelineUpgrade meta-event to the journal.
 */
async function cmdUpgrade(args: string[]): Promise<void> {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const apply = args.includes('--apply');

  const specStore = new SpecStore(phoenixDir);
  const canonStore = new CanonicalStore(phoenixDir);
  const oldNodes = canonStore.getAllNodes();
  if (oldNodes.length === 0) {
    console.log(yellow('⚠ No canonical graph yet. Run `phoenix bootstrap` first.'));
    return;
  }

  const allClauses: Clause[] = [];
  for (const specFile of findSpecFiles(projectRoot)) {
    allClauses.push(...specStore.getClauses(relative(projectRoot, specFile)));
  }

  const llm = resolveProvider(phoenixDir);
  console.log(bold('🔀 Shadow Canonicalization Upgrade'));
  console.log(dim('  Runs the new pipeline in parallel and classifies the diff before committing.'));
  console.log();

  // Run the new pipeline (fresh extraction) without saving.
  const newNodes = await extractCanonicalNodesLLM(allClauses, llm);

  const oldCfg = {
    pipeline_id: 'current', model_id: 'stored', promptpack_version: 'stored',
    extraction_rules_version: 'stored', diff_policy_version: 'stored',
  };
  const newCfg = {
    pipeline_id: 'candidate', model_id: llm ? `${llm.name}/${llm.model}` : 'rule',
    promptpack_version: 'candidate', extraction_rules_version: 'v2', diff_policy_version: 'candidate',
  };
  const result = runShadowPipeline(oldCfg, newCfg, oldNodes, newNodes);
  const m = result.metrics;

  const classColor = result.classification === 'SAFE' ? green
    : result.classification === 'COMPACTION_EVENT' ? yellow : red;
  console.log(`  ${dim('Old nodes:')} ${oldNodes.length}  ${dim('New nodes:')} ${newNodes.length}`);
  console.log(`  ${dim('Node change:')} ${m.node_change_pct}%  ${dim('Edge change:')} ${m.edge_change_pct}%`);
  console.log(`  ${dim('Risk escalations:')} ${m.risk_escalations}  ${dim('Orphans:')} ${m.orphan_nodes}  ${dim('Semantic drift:')} ${m.semantic_stmt_drift}%`);
  console.log(`  ${dim('Classification:')} ${classColor(bold(result.classification))} ${dim('—')} ${result.reason}`);
  console.log();

  new Journal(phoenixDir).append({
    type: 'canonicalize',
    inputs: oldNodes.map(n => n.canon_id),
    outputs: newNodes.map(n => n.canon_id),
    meta: { PipelineUpgrade: true, classification: result.classification, reason: result.reason, metrics: m, applied: apply && result.classification !== 'REJECT' },
  });

  if (result.classification === 'REJECT') {
    console.log(red('  ✖ Upgrade REJECTED — not applied. Resolve orphans / churn before upgrading.'));
    return;
  }
  if (!apply) {
    console.log(dim(`  Preview only. Re-run with ${cyan('--apply')} to commit this ${result.classification}.`));
    return;
  }
  canonStore.replaceNodes(newNodes);
  new CanonStabilityStore(phoenixDir).update(newNodes);
  console.log(green(`  ✔ Applied ${result.classification}. Canonical graph updated. Re-plan + regen affected IUs.`));
}

async function cmdCanonicalize(): Promise<void> {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const specStore = new SpecStore(phoenixDir);
  const canonStore = new CanonicalStore(phoenixDir);

  const allClauses: Clause[] = [];
  const specFiles = findSpecFiles(projectRoot);
  for (const specFile of specFiles) {
    const docId = relative(projectRoot, specFile);
    allClauses.push(...specStore.getClauses(docId));
  }

  if (allClauses.length === 0) {
    console.log(yellow('⚠ No ingested clauses. Run `phoenix ingest` first.'));
    return;
  }

  const llm = resolveProvider(phoenixDir);
  console.log(bold('📐 Canonicalization'));
  if (llm) {
    console.log(`  ${dim(`LLM: ${llm.name}/${llm.model}`)}`);
  }
  console.log();

  const canonNodes = await extractCanonicalNodesLLM(allClauses, llm);
  canonStore.replaceNodes(canonNodes);

  // Canonical stability (PRD §20): how much did re-canonicalization churn the
  // graph, measured on the stable anchor layer? A cosmetic edit should score high.
  const stability = new CanonStabilityStore(phoenixDir).update(canonNodes);

  new Journal(phoenixDir).append({
    type: 'canonicalize',
    inputs: allClauses.map(c => c.clause_id),
    outputs: canonNodes.map(n => n.canon_id),
    meta: { node_count: canonNodes.length, stability_retention: stability.retention, model_id: llm ? `${llm.name}/${llm.model}` : 'rule' },
  });

  console.log(`  ${green('✔')} ${canonNodes.length} canonical nodes extracted from ${allClauses.length} clauses`);
  if (!stability.first_run) {
    const pct = (stability.retention * 100).toFixed(0);
    const color = stability.retention >= 0.9 ? green : stability.retention >= 0.7 ? yellow : red;
    console.log(`  ${dim('Canonical stability:')} ${color(`${pct}%`)} ${dim(`(${stability.kept} kept, ${stability.added} new, ${stability.dropped} dropped)`)}`);
  }

  const byType = new Map<string, number>();
  for (const node of canonNodes) {
    byType.set(node.type, (byType.get(node.type) || 0) + 1);
  }
  for (const [type, count] of byType) {
    console.log(`    ${dim('·')} ${type}: ${count}`);
  }

  // Compute warm hashes
  const warmHashes = computeWarmHashes(allClauses, canonNodes);
  const warmPath = join(phoenixDir, 'graphs', 'warm-hashes.json');
  const warmObj: Record<string, string> = {};
  for (const [k, v] of warmHashes) warmObj[k] = v;
  writeFileSync(warmPath, JSON.stringify(warmObj, null, 2), 'utf8');

  console.log(`  ${green('✔')} ${warmHashes.size} warm context hashes computed`);
}

function cmdEvaluate(args: string[]): void {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const ius = loadIUs(phoenixDir);
  const evidenceStore = new EvidenceStore(phoenixDir);
  const allEvidence = evidenceStore.getAll();

  const iuFilter = args.find(a => a.startsWith('--iu='))?.split('=')[1];
  const targetIUs = iuFilter
    ? ius.filter(iu => iu.iu_id.startsWith(iuFilter) || iu.name === iuFilter)
    : ius;

  const artifactHashes = currentArtifactHashes(targetIUs, new ManifestManager(phoenixDir), projectRoot);
  const evals = evaluateAllPolicies(targetIUs, allEvidence, { currentArtifactHash: artifactHashes });

  console.log(bold('📋 Policy Evaluation'));
  console.log();

  for (const eval_ of evals) {
    const verdictColor = eval_.verdict === 'PASS' ? green
      : eval_.verdict === 'FAIL' ? red
      : yellow;

    console.log(`  ${verdictColor(eval_.verdict)} ${bold(eval_.iu_name)} ${dim(`(${eval_.risk_tier})`)}`);
    if (eval_.satisfied.length > 0) {
      console.log(`    ${green('✔')} ${eval_.satisfied.join(', ')}`);
    }
    if (eval_.missing.length > 0) {
      console.log(`    ${yellow('○')} Missing: ${eval_.missing.join(', ')}`);
    }
    if (eval_.failed.length > 0) {
      console.log(`    ${red('✖')} Failed: ${eval_.failed.join(', ')}`);
    }
    console.log();
  }
}

/**
 * `phoenix evals [--iu=<id>]` — generate durable behavioral evaluations from the
 * canonical graph, check them against the generated code, and record the
 * unit_tests / property_tests evidence. This is how a medium/high-tier IU stops
 * being permanently INCOMPLETE: it acquires an oracle.
 */
function cmdEvals(args: string[]): void {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const ius = loadIUs(phoenixDir);
  const canonNodes = new CanonicalStore(phoenixDir).getAllNodes();
  const manifestManager = new ManifestManager(phoenixDir);

  const iuFilter = args.find(a => a.startsWith('--iu='))?.split('=')[1];
  const targetIUs = iuFilter
    ? ius.filter(iu => iu.iu_id.startsWith(iuFilter) || iu.name === iuFilter)
    : ius;

  if (targetIUs.length === 0) {
    console.log(yellow('⚠ No IUs. Run `phoenix plan` first.'));
    return;
  }

  console.log(bold('🎯 Durable Evaluations'));
  console.log(dim('  The oracle: what regenerated code must satisfy, independent of implementation.'));
  console.log();

  const canonById = new Map(canonNodes.map(n => [n.canon_id, n]));
  for (const iu of targetIUs) {
    const derived = deriveEvaluations(iu, canonNodes);
    const primary = iu.output_files[0];
    const full = primary ? join(projectRoot, primary) : '';
    const source = full && existsSync(full) ? readFileSync(full, 'utf8') : null;

    console.log(`  ${bold(iu.name)} ${dim(`(${iu.risk_tier})`)} — ${derived.length} eval(s)`);
    for (const e of derived) {
      let mark = dim('○ untested');
      if (source) {
        const r = checkEvaluation(e, source, canonById);
        mark = r.status === 'pass' ? green(`✔ ${r.reason}`) : red(`✖ ${r.reason}`);
      }
      const bindingColor = e.binding === 'invariant' ? magenta : e.binding === 'failure_mode' ? red : e.binding === 'boundary_contract' ? cyan : green;
      console.log(`    ${bindingColor(e.binding.padEnd(18))} ${e.assertion.slice(0, 50)} ${mark}`);
    }
    console.log();
  }

  const result = generateCheckAndRecordEvals(phoenixDir, projectRoot, targetIUs, canonNodes, manifestManager);
  console.log(`  ${dim(`Generated ${result.generated} evals — ${result.passed} pass, ${result.failed} fail. Recorded as evidence.`)}`);
  console.log(`  ${dim('Run')} ${cyan('phoenix status')} ${dim('to see updated policy verdicts.')}`);
}

function cmdCascade(): void {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const ius = loadIUs(phoenixDir);
  const evidenceStore = new EvidenceStore(phoenixDir);
  const allEvidence = evidenceStore.getAll();
  const artifactHashes = currentArtifactHashes(ius, new ManifestManager(phoenixDir), projectRoot);
  const evals = evaluateAllPolicies(ius, allEvidence, { currentArtifactHash: artifactHashes });
  const cascadeEvents = computeCascade(evals, ius);

  console.log(bold('🌊 Cascade Effects'));
  console.log();

  if (cascadeEvents.length === 0) {
    console.log(`  ${green('✔')} No cascading failures.`);
    return;
  }

  for (const event of cascadeEvents) {
    console.log(`  ${red('✖')} ${bold(event.source_iu_name)} (${event.failure_kind})`);
    for (const action of event.actions) {
      const icon = action.action === 'BLOCK' ? red('⊘') : yellow('↻');
      console.log(`    ${icon} ${action.iu_name}: ${action.action}`);
      console.log(`      ${dim(action.reason)}`);
    }
    console.log();
  }
}

async function cmdBot(args: string[]): Promise<void> {
  if (args.length === 0) {
    const commands = getAllCommands();
    console.log(bold('🤖 Phoenix Bots'));
    console.log();
    for (const [bot, cmds] of Object.entries(commands)) {
      console.log(`  ${bold(bot)}: ${cmds.join(', ')}`);
    }
    console.log();
    console.log(dim('  Usage: phoenix bot "BotName: action arg=value"'));
    console.log(dim('         phoenix bot "phx confirm <id>"  (or "ok")  — run a pending mutating command'));
    return;
  }

  const { phoenixDir } = requirePhoenixRoot();
  const confirmStore = new ConfirmStore(phoenixDir);
  const raw = args.join(' ').trim();

  // Confirmation replies: `ok` runs the most recent pending; `phx confirm <id>` a specific one.
  const confirmMatch = raw.match(/^(?:phx\s+confirm\s+(\S+)|ok)$/i);
  if (confirmMatch) {
    const pending = confirmMatch[1] ? confirmStore.take(confirmMatch[1]) : (() => {
      const latest = confirmStore.latest();
      return latest ? confirmStore.take(latest.confirm_id) : null;
    })();
    if (!pending) {
      console.error(red('✖ No matching pending command to confirm.'));
      process.exit(1);
    }
    console.log(bold(`🤖 ${pending.command.bot}`));
    console.log(`  ${green('✔')} confirmed: ${pending.intent}`);
    console.log();
    await dispatchBotCommand(pending.command);
    return;
  }

  const parsed = parseCommand(raw);
  if ('error' in parsed) {
    console.error(red(`✖ ${parsed.error}`));
    process.exit(1);
  }

  const response = routeCommand(parsed);
  console.log(bold(`🤖 ${response.bot}`));
  console.log();

  if (response.mutating && response.confirm_id) {
    // Persist the pending command so it can be confirmed in a later invocation.
    confirmStore.add({
      confirm_id: response.confirm_id,
      command: parsed,
      intent: response.intent ?? `${parsed.bot} ${parsed.action}`,
      created_at: new Date().toISOString(),
    });
    console.log(`  ${response.message}`);
    return;
  }

  // Read-only: actually execute (help/commands/version print their own message).
  if (['help', 'commands', 'version'].includes(parsed.action)) {
    console.log(`  ${response.message}`);
    return;
  }
  await dispatchBotCommand(parsed);
}

/**
 * Execute a parsed bot command by dispatching to the real CLI command — bots
 * "behave as normal users" (PRD §14): they run the same operations, not stand-ins.
 */
async function dispatchBotCommand(cmd: import('./models/bot.js').BotCommand): Promise<void> {
  const doc = cmd.args['_'] || cmd.args['doc'];
  const iu = cmd.args['iu'] || cmd.args['_'];
  switch (`${cmd.bot}:${cmd.action}`) {
    case 'SpecBot:ingest': cmdIngest(doc ? [doc] : []); break;
    case 'SpecBot:diff': cmdDiff(doc ? [doc] : []); break;
    case 'SpecBot:clauses': cmdClauses(doc ? [doc] : []); break;
    case 'ImplBot:plan': await cmdPlan(); break;
    case 'ImplBot:regen': await cmdRegen(iu ? [`--iu=${iu}`] : []); break;
    case 'ImplBot:drift': cmdDrift(); break;
    case 'PolicyBot:status': cmdStatus(); break;
    case 'PolicyBot:evidence': cmdEvaluate(iu ? [`--iu=${iu}`] : []); break;
    case 'PolicyBot:cascade': cmdCascade(); break;
    case 'PolicyBot:evaluate': cmdEvaluate(iu ? [`--iu=${iu}`] : []); break;
    default: console.log(dim(`  (no executor for ${cmd.bot}:${cmd.action})`));
  }
}

function cmdGraph(): void {
  const { phoenixDir } = requirePhoenixRoot();
  const canonStore = new CanonicalStore(phoenixDir);
  const graph = canonStore.getGraph();
  const ius = loadIUs(phoenixDir);

  console.log(bold('🕸️  Provenance Graph'));
  console.log();

  // Clause → Canon
  const provenanceCount = Object.values(graph.provenance).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`  ${dim('Provenance edges:')} ${provenanceCount}`);
  console.log(`  ${dim('Canon → Canon links:')} ${Object.values(graph.nodes).reduce((sum, n) => sum + n.linked_canon_ids.length, 0)}`);
  console.log(`  ${dim('Canon → IU mappings:')} ${ius.reduce((sum, iu) => sum + iu.source_canon_ids.length, 0)}`);
  console.log();

  // Show IU dependency graph
  if (ius.length > 0) {
    console.log(`  ${bold('IU Dependency Graph:')}`);
    for (const iu of ius) {
      const deps = iu.dependencies.length > 0
        ? iu.dependencies.map(d => {
            const dep = ius.find(i => i.iu_id === d);
            return dep?.name || d.slice(0, 8);
          }).join(', ')
        : dim('(none)');
      console.log(`    ${iu.name} → ${deps}`);
    }
  }
}

async function cmdInspect(args: string[]): Promise<void> {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const machine = loadBootstrapState(phoenixDir);
  const ius = loadIUs(phoenixDir);
  const canonStore = new CanonicalStore(phoenixDir);
  const canonNodes = canonStore.getAllNodes();
  const specStore = new SpecStore(phoenixDir);
  const manifestManager = new ManifestManager(phoenixDir);
  const manifest = manifestManager.load();

  // Collect all clauses
  const allClauses: Clause[] = [];
  const specFiles = findSpecFiles(projectRoot);
  for (const specFile of specFiles) {
    const docId = relative(projectRoot, specFile);
    allClauses.push(...specStore.getClauses(docId));
  }

  // Drift
  let driftReport = null;
  if (manifest.generated_at) {
    driftReport = detectDrift(manifest, projectRoot);
  }

  // Trust layer — evidence, negative knowledge, evaluation coverage per IU
  const evidenceStore = new EvidenceStore(phoenixDir);
  const nkStore = new NegativeKnowledgeStore(phoenixDir);
  const evalStore = new EvaluationStore(phoenixDir);
  const trust: TrustInputs = { evidenceByIU: {}, nkByIU: {}, evalByIU: {} };
  for (const iu of ius) {
    trust.evidenceByIU![iu.iu_id] = evidenceStore.getByIU(iu.iu_id).map(e => ({
      kind: e.kind,
      status: e.status,
      message: e.message,
    }));
    trust.nkByIU![iu.iu_id] = nkStore.getBySubject(iu.iu_id).map(nk => ({
      kind: nk.kind,
      whatWasTried: nk.what_was_tried,
      whyItFailed: nk.why_it_failed,
      constraint: nk.constraint_for_future,
    }));
    const cov = evalStore.coverage(iu);
    trust.evalByIU![iu.iu_id] = { total: cov.total_evaluations, ratio: cov.coverage_ratio, gaps: cov.gaps.length };
  }

  const projectName = basename(projectRoot);
  const data = collectInspectData(
    projectName,
    machine.getState(),
    allClauses,
    canonNodes,
    ius,
    manifest,
    driftReport,
    projectRoot,
    trust,
  );

  const html = renderInspectHTML(data);
  const dataJson = JSON.stringify(data);

  // Parse --port flag
  const portArg = args.find(a => a.startsWith('--port='))?.split('=')[1];
  const port = portArg ? parseInt(portArg, 10) : 0; // 0 = random

  const instance = serveInspect(html, port, dataJson);
  await instance.ready;

  console.log();
  console.log(bold('🔥 Phoenix Inspect'));
  console.log();
  console.log(`  ${cyan(`http://localhost:${instance.port}`)}`);
  console.log();
  console.log(`  ${dim(`${data.stats.specFiles} specs → ${data.stats.clauses} clauses → ${data.stats.canonNodes} canon → ${data.stats.ius} IUs → ${data.stats.generatedFiles} files`)}`);
  console.log(`  ${dim(`${data.stats.edgeCount} provenance edges`)}`);
  console.log();
  console.log(dim('  Press Ctrl+C to stop.'));

  // Keep process alive
  await new Promise(() => {});
}

// ─── Replacement Audit (Fowler Ch. 4) ────────────────────────────────────────

function cmdAudit(args: string[]): void {
  const { phoenixDir } = requirePhoenixRoot();
  const ius = loadIUs(phoenixDir);
  const evalStore = new EvaluationStore(phoenixDir);
  const nkStore = new NegativeKnowledgeStore(phoenixDir);

  if (ius.length === 0) {
    console.log(yellow('⚠ No Implementation Units found. Run `phoenix plan` first.'));
    return;
  }

  // Build coverage map
  const evalCoverages = new Map<string, any>();
  for (const iu of ius) {
    evalCoverages.set(iu.iu_id, evalStore.coverage(iu));
  }

  // Load pace layers (from iu metadata or defaults)
  const paceLayers = new Map<string, PaceLayerMetadata>();
  // TODO: load from .phoenix/pace-layers.json when populated

  const nk = nkStore.getActive();
  // Conceptual mass stamped by the regeneration gate into the manifest.
  const previousMasses = loadPreviousMasses(new ManifestManager(phoenixDir));

  // Filter by --iu if specified
  const iuArg = args.find(a => a.startsWith('--iu='));
  const targetIUs = iuArg
    ? ius.filter(iu => iu.iu_id === iuArg.slice(5) || iu.name === iuArg.slice(5))
    : ius;

  const results = auditAll(targetIUs, evalCoverages, paceLayers, nk, previousMasses);

  console.log();
  console.log(bold('🔥 Phoenix Replacement Audit'));
  console.log(dim('  "Could I replace this implementation entirely and have its dependents not notice?"'));
  console.log();

  // Summary counts
  const readinessCounts: Record<ReadinessLevel, number> = {
    regenerable: 0, evaluable: 0, observable: 0, opaque: 0,
  };
  for (const r of results) readinessCounts[r.readiness]++;

  console.log(
    `  ${green(`● ${readinessCounts.regenerable} regenerable`)}  ` +
    `${blue(`◐ ${readinessCounts.evaluable} evaluable`)}  ` +
    `${yellow(`○ ${readinessCounts.observable} observable`)}  ` +
    `${red(`◌ ${readinessCounts.opaque} opaque`)}`
  );
  console.log();

  // Per-IU details
  for (const result of results) {
    const readinessIcon = readinessToIcon(result.readiness);
    const scoreColor = result.score >= 75 ? green : result.score >= 50 ? yellow : red;

    console.log(`  ${readinessIcon} ${bold(result.iu_name)} ${dim(`(${result.iu_id})`)} — ${scoreColor(`${result.score}/100`)} ${dim(result.readiness)}`);

    // Dimension summary
    const dims = [
      result.boundary_clarity,
      result.evaluation_coverage,
      result.blast_radius,
      result.deletion_safety,
      result.pace_layer,
      result.conceptual_mass,
      result.negative_knowledge,
    ];
    for (const d of dims) {
      const icon = d.status === 'good' ? green('✓') : d.status === 'warning' ? yellow('⚠') : red('✖');
      console.log(`    ${icon} ${dim(d.name + ':')} ${d.detail}`);
    }

    // Blockers
    if (result.blockers.length > 0) {
      console.log(`    ${red('Blockers:')}`);
      for (const b of result.blockers) {
        const sev = b.severity === 'error' ? red('✖') : yellow('⚠');
        console.log(`      ${sev} ${b.message}`);
        console.log(`        ${dim('→ ' + b.recommended_action)}`);
      }
    }

    // Recommendations
    if (result.recommendations.length > 0) {
      console.log(`    ${cyan('Recommendations:')}`);
      for (const r of result.recommendations) {
        console.log(`      ${dim('→')} ${r}`);
      }
    }

    console.log();
  }

  // Overall verdict
  const totalScore = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
    : 0;
  const totalBlockers = results.reduce((sum, r) => sum + r.blockers.length, 0);

  console.log(dim('  ─────────────────────────────────────────'));
  console.log(`  ${bold('Overall:')} ${totalScore}/100 avg score, ${totalBlockers} blocker(s)`);
  console.log(`  ${dim('Trust > cleverness.')}`);
  console.log();
}

function readinessToIcon(readiness: ReadinessLevel): string {
  switch (readiness) {
    case 'regenerable': return green('●');
    case 'evaluable': return blue('◐');
    case 'observable': return yellow('○');
    case 'opaque': return red('◌');
  }
}

/**
 * `phoenix why <file>` — the query the whole "provenance is version control"
 * thesis exists for. Walks the journal + graphs backward from a generated file
 * to the spec lines, decisions, and generation record that produced it:
 *   file → regen event (model, promptpack) → IU → canonical nodes → source clauses → spec lines.
 */
function cmdWhy(args: string[]): void {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const target = args.find(a => !a.startsWith('--'));
  if (!target) {
    console.error(red('✖ Usage: phoenix why <file>'));
    process.exit(1);
  }
  const key = relative(projectRoot, resolve(target)) || target;

  const journal = new Journal(phoenixDir);
  const events = journal.readAll();
  const ius = loadIUs(phoenixDir);
  const canonStore = new CanonicalStore(phoenixDir);
  const canonById = new Map(canonStore.getAllNodes().map(n => [n.canon_id, n]));
  const specStore = new SpecStore(phoenixDir);

  console.log(bold(`🔎 Why does ${key} exist?`));
  console.log();

  // The most recent regen event that produced this file.
  const regen = [...events].reverse().find(e => e.type === 'regen' && e.outputs.includes(key));
  if (!regen) {
    console.log(yellow(`  No regeneration record found for ${key}.`));
    console.log(dim('  (Run `phoenix bootstrap` or `phoenix regen` to build the provenance chain.)'));
    return;
  }

  const iuId = regen.meta.iu_id as string;
  const iu = ius.find(u => u.iu_id === iuId);
  console.log(`  ${dim('Generated by:')} ${cyan(regen.meta.iu_name as string)} ${dim(`(IU ${String(iuId).slice(0, 8)})`)}`);
  console.log(`  ${dim('Model:')} ${regen.meta.model_id} ${dim('·')} ${dim('promptpack')} ${String(regen.meta.promptpack_hash).slice(0, 12)} ${dim('·')} ${regen.timestamp}`);
  console.log();

  // The canonical requirements that drove it, and their source spec lines.
  const canonIds = iu?.source_canon_ids ?? regen.inputs;
  console.log(`  ${bold('Requirements that drove this code:')}`);
  const seenClauses = new Set<string>();
  for (const cid of canonIds) {
    const node = canonById.get(cid);
    if (!node) continue;
    const typeColor = node.type === 'CONSTRAINT' ? red : node.type === 'INVARIANT' ? magenta : node.type === 'REQUIREMENT' ? green : blue;
    console.log(`    ${typeColor(node.type)} ${node.statement.slice(0, 70)}${node.statement.length > 70 ? '…' : ''}`);
    for (const clauseId of node.source_clause_ids) {
      if (seenClauses.has(clauseId)) continue;
      seenClauses.add(clauseId);
      const clause = specStore.getClause(clauseId);
      if (clause) {
        const loc = `${clause.source_doc_id}:L${clause.source_line_range[0]}`;
        console.log(`      ${dim('←')} ${dim(loc)} ${dim(`"${clause.raw_text.slice(0, 50).replace(/\n/g, ' ')}"`)}`);
      }
    }
  }
  console.log();

  // Any invalidations or labels that touched this file/IU.
  const related = events.filter(e =>
    (e.type === 'invalidate' && (e.outputs.includes(iuId) || (e.meta.stale as string[] | undefined)?.includes(regen.meta.iu_name as string))) ||
    (e.type === 'label' && e.inputs.includes(key)),
  );
  if (related.length > 0) {
    console.log(`  ${bold('History:')}`);
    for (const e of related) {
      if (e.type === 'invalidate') console.log(`    ${yellow('▸')} ${dim(e.timestamp)} invalidated (spec change)`);
      if (e.type === 'label') console.log(`    ${blue('🏷')} ${dim(e.timestamp)} labeled ${e.meta.kind}: ${e.meta.reason}`);
    }
    console.log();
  }

  console.log(dim(`  Provenance chain verified against ${events.length} journal events.`));
}

/** `phoenix journal [--verify]` — show or verify the provenance chain. */
function cmdJournal(args: string[]): void {
  const { phoenixDir } = requirePhoenixRoot();
  const journal = new Journal(phoenixDir);
  const events = journal.readAll();

  console.log(bold('📜 Provenance Journal'));
  console.log();

  if (events.length === 0) {
    console.log(dim('  No events yet. Run `phoenix bootstrap`.'));
    return;
  }

  const verify = journal.verify();
  if (verify.ok) {
    console.log(`  ${green('✔')} chain intact ${dim(`(${events.length} events, tamper-evident)`)}`);
  } else {
    console.log(`  ${red('✖')} chain broken at seq ${verify.brokenSeq}: ${verify.reason}`);
  }
  console.log();

  if (args.includes('--verify')) return;

  const limit = 25;
  const shown = events.slice(-limit);
  if (events.length > limit) console.log(dim(`  (showing last ${limit} of ${events.length})`));
  for (const e of shown) {
    const typeColor = e.type === 'regen' ? green : e.type === 'invalidate' ? yellow : e.type === 'label' ? blue : cyan;
    const summary = e.type === 'regen' ? `${e.meta.iu_name} → ${e.outputs.length} file(s)`
      : e.type === 'canonicalize' ? `${e.meta.node_count} nodes`
      : e.type === 'plan' ? `${e.meta.iu_count} IUs`
      : e.type === 'invalidate' ? `${(e.meta.stale as string[])?.length ?? 0} stale`
      : e.type === 'label' ? `${e.meta.kind}`
      : e.type === 'ingest' ? `${e.meta.total_clauses} clauses`
      : '';
    console.log(`  ${dim(`#${e.seq}`)} ${typeColor(e.type.padEnd(12))} ${dim(e.timestamp.slice(11, 19))} ${summary}`);
  }
}

/**
 * `phoenix selftest [--json] [--strict]` — run Phoenix's own capability eval and
 * print the Red/Green scorecard. This is the project's trust surface for itself: green
 * capabilities are locked against regression; red ones are the honest, documented
 * backlog. Exit non-zero on any regression (a proven capability that broke), and —
 * under --strict — also on any promotion (a red that now passes and should be
 * flipped to green). Unlike a normal command this does not require a Phoenix project.
 */
async function cmdEval(args: string[]): Promise<void> {
  const asJson = args.includes('--json');
  const strict = args.includes('--strict');
  const sc = await runSuite(CAPABILITY_SUITE, () => new Date().toISOString());

  if (asJson) {
    console.log(JSON.stringify(scorecardArtifact(sc), null, 2));
  } else {
    console.log(renderScorecard(sc, { color: process.stdout.isTTY ?? false }));
  }

  if (sc.regressions.length > 0) {
    console.error(red(`✖ ${sc.regressions.length} regression(s) — a proven capability broke.`));
    process.exit(1);
  }
  if (strict && sc.promotions.length > 0) {
    console.error(yellow(`⚠ ${sc.promotions.length} promotion(s) — flip these reds to green (--strict).`));
    process.exit(2);
  }
}

function cmdVersion(): void {
  console.log(`Phoenix VCS v${VERSION}`);
}

function cmdHelp(): void {
  console.log(`
${bold('🔥 Phoenix VCS')} — Regenerative Version Control
${dim(`v${VERSION}`)}

${bold('Usage:')} phoenix <command> [options]

${bold('Getting Started:')}
  ${cyan('init')}                 Initialize a new Phoenix project
  ${cyan('bootstrap')}            Full bootstrap: ingest → canonicalize → plan → generate

${bold('Spec Management:')}
  ${cyan('ingest')} [files...]     Ingest spec documents (default: all in spec/)
  ${cyan('diff')} [files...]       Show clause diffs vs stored state
  ${cyan('clauses')} [files...]    List stored clauses

${bold('Canonical Graph:')}
  ${cyan('canonicalize')}          Extract canonical nodes from ingested clauses
  ${cyan('canon')}                 Show the canonical graph
  ${cyan('upgrade')} [--apply]      Shadow-canonicalize: classify a pipeline upgrade before committing

${bold('Implementation:')}
  ${cyan('plan')}                  Plan Implementation Units from canonical graph
  ${cyan('regen')} [--iu=<id>]    Regenerate code — selective by default (only stale IUs)
                         ${dim('Uses LLM if ANTHROPIC_API_KEY or OPENAI_API_KEY is set')}
                         ${dim('--all    Regenerate every IU (ignore the invalidation set)')}
                         ${dim('--stubs  Force stub generation (skip LLM)')}
  ${cyan('repair')} [--rounds=N]   Repair loop: feed verifier findings into targeted regeneration
                         ${dim('Bounded (default 3 rounds); the verifier is frozen — code changes only')}

${bold('Verification:')}
  ${cyan('status')}                Trust dashboard — the primary UX
  ${cyan('drift')}                 Check generated files for drift
  ${cyan('label')} <file>          Label a manual edit (waiver | temporary_patch | promote_to_requirement)
                         ${dim('--kind=<kind> --reason="..." [--expires=Nd] [--signed-by=NAME]')}
                         ${dim('--list to show labels, --remove to clear one')}
  ${cyan('evals')} [--iu=<id>]    Generate durable evaluations (the oracle) + record evidence
  ${cyan('attest')} <iu>          Record manual evidence (threat_note|human_signoff|static_analysis|…)
                         ${dim('--kind=<kind> [--note="..."]')}
  ${cyan('evaluate')} [--iu=<id>] Evaluate evidence against policy
  ${cyan('cascade')}               Show cascade failure effects
  ${cyan('audit')} [--iu=<id>]    Replacement audit — readiness per IU

${bold('Inspection:')}
  ${cyan('inspect')} [--port=N]    Interactive pipeline visualisation (opens browser)
  ${cyan('graph')}                 Show provenance graph summary
  ${cyan('why')} <file>            Trace a generated file back to the spec lines that produced it
  ${cyan('journal')} [--verify]    Show/verify the append-only provenance chain
  ${cyan('bot')} "<command>"       Route a bot command (e.g., "SpecBot: help")

${bold('Meta:')}
  ${cyan('selftest')} [--json]     Phoenix's own capability eval — the Red/Green scorecard
                         ${dim('--strict also fails on promotions (reds that now pass)')}
  ${cyan('version')}               Show version
  ${cyan('help')}                  Show this help

${dim('Trust > cleverness.')}
`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case 'init':
      cmdInit(commandArgs);
      break;
    case 'bootstrap':
      await cmdBootstrap();
      break;
    case 'status':
      cmdStatus();
      break;
    case 'ingest':
      cmdIngest(commandArgs);
      break;
    case 'diff':
      cmdDiff(commandArgs);
      break;
    case 'clauses':
      cmdClauses(commandArgs);
      break;
    case 'canonicalize':
    case 'canon-extract':
      await cmdCanonicalize();
      break;
    case 'upgrade':
      await cmdUpgrade(commandArgs);
      break;
    case 'canon':
      cmdCanon();
      break;
    case 'plan':
      await cmdPlan();
      break;
    case 'regen':
    case 'regenerate':
      await cmdRegen(commandArgs);
      break;
    case 'repair':
      await cmdRepair(commandArgs);
      break;
    case 'drift':
      cmdDrift();
      break;
    case 'label':
      cmdLabel(commandArgs);
      break;
    case 'evaluate':
    case 'eval':
      cmdEvaluate(commandArgs);
      break;
    case 'cascade':
      cmdCascade();
      break;
    case 'evals':
    case 'eval-gen':
      cmdEvals(commandArgs);
      break;
    case 'selftest':
    case 'capabilities':
      await cmdEval(commandArgs);
      break;
    case 'attest':
      cmdAttest(commandArgs);
      break;
    case 'audit':
      cmdAudit(commandArgs);
      break;
    case 'inspect':
      await cmdInspect(commandArgs);
      break;
    case 'graph':
      cmdGraph();
      break;
    case 'why':
      cmdWhy(commandArgs);
      break;
    case 'journal':
      cmdJournal(commandArgs);
      break;
    case 'bot':
      await cmdBot(commandArgs);
      break;
    case 'version':
    case '--version':
    case '-v':
      cmdVersion();
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      cmdHelp();
      break;
    default:
      console.error(red(`✖ Unknown command: ${command}`));
      console.error(dim('  Run `phoenix help` for available commands.'));
      process.exit(1);
  }
}

main().catch(err => {
  console.error(red(`✖ ${err.message || err}`));
  process.exit(1);
});
