#!/usr/bin/env node
/**
 * Phoenix VCS — Command Line Interface
 *
 * The primary UX surface for Phoenix. `phoenix status` is the most
 * important command — it must always be explainable, conservative,
 * and correct-enough to rely on.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, relative, basename } from 'node:path';

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
import { planIUs } from './iu-planner.js';
import { generateIU, generateAll } from './regen.js';
import type { RegenContext } from './regen.js';
import { detectDrift } from './drift.js';
import { extractDependencies } from './dep-extractor.js';
import { validateBoundary } from './boundary-validator.js';

// Phase D
import { evaluatePolicy, evaluateAllPolicies } from './policy-engine.js';
import { computeCascade } from './cascade.js';
import { runEvidence, runAllEvidence } from './evidence-runner.js';
import type { EvidenceRunResult, CheckResult } from './evidence-runner.js';

// Phase E
import { runShadowPipeline } from './shadow-pipeline.js';

// Phase F
import { parseCommand, routeCommand, getAllCommands } from './bot-router.js';

// Scaffold
import { deriveServices, generateScaffold } from './scaffold.js';

// Inspect
import { collectInspectData, renderInspectHTML, serveInspect } from './inspect.js';

// LLM
import { resolveProvider, describeAvailability } from './llm/resolve.js';

// Models
import type { Clause, ClauseDiff } from './models/clause.js';
import { DiffType } from './models/clause.js';
import type { CanonicalNode } from './models/canonical.js';
import type { ImplementationUnit } from './models/iu.js';
import type { Diagnostic } from './models/diagnostic.js';
import type { DriftReport } from './models/manifest.js';
import { DriftStatus } from './models/manifest.js';
import { BootstrapState, DRateLevel } from './models/classification.js';
import type { PolicyEvaluation, CascadeEvent } from './models/evidence.js';

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

function loadDRateTracker(phoenixDir: string): DRateTracker {
  const path = join(phoenixDir, 'drate.json');
  if (existsSync(path)) {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const tracker = new DRateTracker(data.window_size || 100);
    // Re-record stored window
    if (data.window) {
      for (const cls of data.window) {
        tracker.recordOne(cls);
      }
    }
    return tracker;
  }
  return new DRateTracker();
}

function saveDRateTracker(phoenixDir: string, tracker: DRateTracker): void {
  const status = tracker.getStatus();
  writeFileSync(join(phoenixDir, 'drate.json'), JSON.stringify({
    window_size: status.window_size,
    rate: status.rate,
    level: status.level,
    d_count: status.d_count,
    total_count: status.total_count,
  }, null, 2), 'utf8');
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

function cmdInit(): void {
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
  console.log();
  console.log(`  ${dim('Next steps:')}`);
  console.log(`    1. Add spec documents to ${cyan('spec/')}`);
  console.log(`    2. Run ${cyan('phoenix bootstrap')} to ingest & canonicalize`);
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
  canonStore.saveNodes(canonNodes);
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

  // Step 3: Plan IUs
  console.log(`  ${dim('Phase C:')} IU planning`);
  const ius = planIUs(canonNodes, allClauses);
  saveIUs(phoenixDir, ius);
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

  const regenCtx: RegenContext = {
    llm: llm ?? undefined,
    canonNodes,
    allIUs: ius,
    projectRoot,
    onProgress: (iu, status, msg) => {
      if (status === 'start') process.stdout.write(`    ⏳ ${iu.name}…`);
      else if (status === 'done') process.stdout.write(` ${green('✔')}\n`);
      else if (status === 'error') process.stdout.write(` ${red('✖')} ${dim(msg || 'failed, using stub')}\n`);
    },
  };

  const manifestManager = new ManifestManager(phoenixDir);
  const regenResults = await generateAll(ius, regenCtx);
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
  console.log();

  // Step 5: Service scaffold
  console.log(`  ${dim('Scaffold:')} Service wiring + project config`);
  const services = deriveServices(ius);
  const projectName = basename(projectRoot);
  const scaffold = generateScaffold(services, projectName);
  for (const [filePath, content] of scaffold.files) {
    const fullPath = join(projectRoot, filePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }
  for (const svc of services) {
    console.log(`    ${green('✔')} ${svc.name} → :${svc.port} (${svc.modules.length} modules)`);
  }
  console.log(`    ${green('✔')} package.json, tsconfig.json`);
  console.log();

  // Save state
  saveBootstrapState(phoenixDir, machine);

  // Step 6: Evidence verification
  console.log(`  ${dim('Phase D:')} Evidence verification`);
  const evidenceStore = new EvidenceStore(phoenixDir);
  const evidenceResults = runAllEvidence(ius, {
    projectRoot,
    onProgress: (u, check, status) => {
      if (status === 'start') process.stdout.write(`    ${dim('⏳')} ${u.name} · ${check}…`);
      else if (status === 'pass') process.stdout.write(` ${green('✔')}\n`);
      else if (status === 'fail') process.stdout.write(` ${red('✖')}\n`);
      else if (status === 'skip') process.stdout.write(` ${dim('⊘')}\n`);
    },
  });
  for (const r of evidenceResults) {
    evidenceStore.addRecords(r.records);
  }
  const evPass = evidenceResults.flatMap(r => r.checks).filter(c => c.status === 'PASS').length;
  const evFail = evidenceResults.flatMap(r => r.checks).filter(c => c.status === 'FAIL').length;
  console.log(`    ${evFail === 0 ? green('✔') : red('✖')} ${evPass} pass, ${evFail} fail`);
  console.log();

  // Step 7: Trust dashboard
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

  // Drift detection
  const manifestManager = new ManifestManager(phoenixDir);
  const manifest = manifestManager.load();
  if (manifest.generated_at) {
    const driftReport = detectDrift(manifest, projectRoot);
    const driftLabel = driftReport.drifted_count === 0 && driftReport.missing_count === 0
      ? green('clean')
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
          recommended_actions: ['Label edit (promote_to_requirement, waiver, or temporary_patch)', 'Or run `phoenix regen` to regenerate'],
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
    }
  } else {
    console.log(`  ${dim('Drift:')} ${dim('no manifest')}`);
  }

  // Boundary validation
  for (const iu of ius) {
    for (const outputFile of iu.output_files) {
      const fullPath = join(projectRoot, outputFile);
      if (!existsSync(fullPath)) continue;
      const source = readFileSync(fullPath, 'utf8');
      const depGraph = extractDependencies(source, outputFile);
      const boundaryDiags = validateBoundary(depGraph, iu);
      diagnostics.push(...boundaryDiags);
    }
  }

  // Policy evaluation
  const evidenceStore = new EvidenceStore(phoenixDir);
  const allEvidence = evidenceStore.getAll();
  const policyEvals = evaluateAllPolicies(ius, allEvidence);

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
      diagnostics.push({
        severity: 'warning',
        category: 'evidence',
        subject: eval_.iu_name,
        iu_id: eval_.iu_id,
        message: `Missing evidence: ${eval_.missing.join(', ')}`,
        recommended_actions: [`Collect required evidence for ${eval_.risk_tier} tier`],
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

  let files: string[];
  if (args.length === 0) {
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

  let totalClauses = 0;
  for (const file of files) {
    const result = specStore.ingestDocument(file, projectRoot);
    totalClauses += result.clauses.length;
    console.log(`  ${green('✔')} ${relative(projectRoot, file)} → ${result.clauses.length} clauses`);
  }

  console.log();
  console.log(`  ${dim(`Total: ${totalClauses} clauses ingested`)}`);
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

function cmdPlan(): void {
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

  const ius = planIUs(canonNodes, allClauses);
  saveIUs(phoenixDir, ius);

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
  const targetIUs = iuFilter
    ? ius.filter(iu => iu.iu_id.startsWith(iuFilter) || iu.name === iuFilter)
    : ius;

  if (targetIUs.length === 0) {
    console.log(red(`✖ No IU matching: ${iuFilter}`));
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
  console.log();

  const regenCtx: RegenContext = {
    llm: llm ?? undefined,
    canonNodes,
    allIUs: ius,
    projectRoot,
    onProgress: (iu, status, msg) => {
      if (status === 'start') process.stdout.write(`  ⏳ ${iu.name}…`);
      else if (status === 'done') process.stdout.write(` ${green('✔')}\n`);
      else if (status === 'error') process.stdout.write(` ${red('✖')} ${dim(msg || 'failed, using stub')}\n`);
    },
  };

  const manifestManager = new ManifestManager(phoenixDir);
  const results = await generateAll(targetIUs, regenCtx);

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

  // Re-generate scaffold wiring
  const allIUs = loadIUs(phoenixDir);
  const services = deriveServices(allIUs);
  const scaffold = generateScaffold(services, basename(projectRoot));
  for (const [filePath, content] of scaffold.files) {
    const fullPath = join(projectRoot, filePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }

  console.log();
  console.log(`  ${dim(`${results.length} IU(s) regenerated. Scaffold updated.`)}`);
}

function cmdDrift(): void {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const manifestManager = new ManifestManager(phoenixDir);
  const manifest = manifestManager.load();

  if (!manifest.generated_at) {
    console.log(yellow('⚠ No generated manifest. Run `phoenix regen` first.'));
    return;
  }

  const report = detectDrift(manifest, projectRoot);

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
        console.log(`  ${green('✔')} ${entry.file_path}`);
        break;
      case DriftStatus.DRIFTED:
        console.log(`  ${red('✖')} ${entry.file_path} ${red('DRIFTED')}`);
        console.log(`    ${dim('expected:')} ${entry.expected_hash?.slice(0, 12)}…`);
        console.log(`    ${dim('actual:')}   ${entry.actual_hash?.slice(0, 12)}…`);
        console.log(`    ${dim('→ Label this edit: promote_to_requirement | waiver | temporary_patch')}`);
        break;
      case DriftStatus.MISSING:
        console.log(`  ${red('✖')} ${entry.file_path} ${red('MISSING')}`);
        console.log(`    ${dim('→ Run `phoenix regen` to regenerate')}`);
        break;
      case DriftStatus.WAIVED:
        console.log(`  ${yellow('⚠')} ${entry.file_path} ${yellow('WAIVED')}`);
        if (entry.waiver) {
          console.log(`    ${dim('kind:')} ${entry.waiver.kind}`);
          console.log(`    ${dim('reason:')} ${entry.waiver.reason}`);
        }
        break;
    }
  }
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
  canonStore.saveNodes(canonNodes);

  console.log(`  ${green('✔')} ${canonNodes.length} canonical nodes extracted from ${allClauses.length} clauses`);

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
  const { phoenixDir } = requirePhoenixRoot();
  const ius = loadIUs(phoenixDir);
  const evidenceStore = new EvidenceStore(phoenixDir);
  const allEvidence = evidenceStore.getAll();

  const iuFilter = args.find(a => a.startsWith('--iu='))?.split('=')[1];
  const targetIUs = iuFilter
    ? ius.filter(iu => iu.iu_id.startsWith(iuFilter) || iu.name === iuFilter)
    : ius;

  const evals = evaluateAllPolicies(targetIUs, allEvidence);

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

function cmdVerify(args: string[]): void {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const ius = loadIUs(phoenixDir);

  if (ius.length === 0) {
    console.log(yellow('⚠ No IUs planned. Run `phoenix bootstrap` or `phoenix plan` first.'));
    return;
  }

  // Parse flags
  const iuFilter = args.find(a => a.startsWith('--iu='))?.split('=')[1];
  const onlyFlag = args.find(a => a.startsWith('--only='))?.split('=')[1];
  const skipFlag = args.find(a => a.startsWith('--skip='))?.split('=')[1];
  const timeoutFlag = args.find(a => a.startsWith('--timeout='))?.split('=')[1];

  const targetIUs = iuFilter
    ? ius.filter(iu => iu.iu_id.startsWith(iuFilter) || iu.name === iuFilter)
    : ius;

  if (targetIUs.length === 0) {
    console.log(red(`✖ No IU matching: ${iuFilter}`));
    return;
  }

  const only = onlyFlag ? onlyFlag.split(',') as any[] : undefined;
  const skip = skipFlag ? skipFlag.split(',') as any[] : undefined;
  const timeout = timeoutFlag ? parseInt(timeoutFlag) : 30000;

  console.log(bold('🔬 Evidence Verification'));
  console.log(`  ${dim(`${targetIUs.length} IU(s), timeout ${timeout / 1000}s`)}`);
  console.log();

  const evidenceStore = new EvidenceStore(phoenixDir);
  let totalPass = 0;
  let totalFail = 0;
  let totalSkip = 0;

  for (const iu of targetIUs) {
    const result = runEvidence(iu, {
      projectRoot,
      only,
      skip,
      timeout,
      onProgress: (u, check, status) => {
        if (status === 'start') {
          process.stdout.write(`  ${dim('⏳')} ${u.name} · ${check}…`);
        } else if (status === 'pass') {
          process.stdout.write(` ${green('✔')}\n`);
        } else if (status === 'fail') {
          process.stdout.write(` ${red('✖')}\n`);
        } else if (status === 'skip') {
          process.stdout.write(` ${dim('⊘')}\n`);
        }
      },
    });

    // Store evidence records
    evidenceStore.addRecords(result.records);

    // Tally
    for (const check of result.checks) {
      switch (check.status) {
        case 'PASS': totalPass++; break;
        case 'FAIL': totalFail++; break;
        default: totalSkip++; break;
      }
    }

    // Show details for failures
    for (const check of result.checks) {
      if (check.status === 'FAIL' && check.details) {
        console.log(`    ${dim('│')} ${red(check.kind)}: ${check.message}`);
        for (const line of check.details.split('\n').slice(0, 5)) {
          console.log(`    ${dim('│')}   ${dim(line)}`);
        }
      }
    }

    // Summary line per IU
    const iuPass = result.checks.filter(c => c.status === 'PASS').length;
    const iuFail = result.checks.filter(c => c.status === 'FAIL').length;
    const iuTime = result.checks.reduce((s, c) => s + c.duration_ms, 0);
    if (iuFail > 0) {
      console.log(`    ${red('✖')} ${iu.name}: ${iuPass} pass, ${iuFail} fail ${dim(`(${iuTime}ms)`)}`);
    } else {
      console.log(`    ${green('✔')} ${iu.name}: ${iuPass} pass ${dim(`(${iuTime}ms)`)}`);
    }
    console.log();
  }

  // Grand totals
  console.log(`  ${dim('─────────────────────────────')}`);
  if (totalFail === 0) {
    console.log(`  ${green('✔')} All evidence passed: ${green(String(totalPass))} pass${totalSkip ? `, ${dim(String(totalSkip))} skipped` : ''}`);
  } else {
    console.log(`  ${red('✖')} Evidence: ${green(String(totalPass))} pass, ${red(String(totalFail))} fail${totalSkip ? `, ${dim(String(totalSkip))} skipped` : ''}`);
  }
  console.log(`  ${dim('Results stored. Run `phoenix status` to see updated trust dashboard.')}`);
}

function cmdCascade(): void {
  const { phoenixDir } = requirePhoenixRoot();
  const ius = loadIUs(phoenixDir);
  const evidenceStore = new EvidenceStore(phoenixDir);
  const allEvidence = evidenceStore.getAll();
  const evals = evaluateAllPolicies(ius, allEvidence);
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

function cmdBot(args: string[]): void {
  if (args.length === 0) {
    // Show all bot commands
    const commands = getAllCommands();
    console.log(bold('🤖 Phoenix Bots'));
    console.log();
    for (const [bot, cmds] of Object.entries(commands)) {
      console.log(`  ${bold(bot)}: ${cmds.join(', ')}`);
    }
    console.log();
    console.log(dim('  Usage: phoenix bot "BotName: action arg=value"'));
    return;
  }

  const raw = args.join(' ');
  const parsed = parseCommand(raw);

  if ('error' in parsed) {
    console.error(red(`✖ ${parsed.error}`));
    process.exit(1);
  }

  const response = routeCommand(parsed);

  console.log(bold(`🤖 ${response.bot}`));
  console.log();
  console.log(`  ${response.message}`);

  if (response.mutating && response.confirm_id) {
    console.log();
    console.log(dim(`  Confirmation ID: ${response.confirm_id}`));
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

  const projectName = basename(projectRoot);
  const data = collectInspectData(
    projectName,
    machine.getState(),
    allClauses,
    canonNodes,
    ius,
    manifest,
    driftReport,
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

// ─── Sync Command ────────────────────────────────────────────────────────────

async function cmdSync(args: string[]): Promise<void> {
  const { projectRoot, phoenixDir } = requirePhoenixRoot();
  const dryRun = args.includes('--dry-run');
  const forceStubs = args.includes('--stubs');

  console.log(bold('🔄 Phoenix Sync'));
  console.log(`  ${dim('Detecting spec changes and regenerating only affected IUs')}`);
  console.log();

  const specStore = new SpecStore(phoenixDir);
  const canonStore = new CanonicalStore(phoenixDir);
  const specFiles = findSpecFiles(projectRoot);

  if (specFiles.length === 0) {
    console.log(yellow('  ⚠ No spec files found in spec/ directory.'));
    return;
  }

  // ─── Step 1: Diff all specs against stored state ───────────────────────────

  console.log(`  ${dim('Step 1:')} Detecting spec changes`);

  interface DocDiff {
    docId: string;
    filePath: string;
    diffs: ClauseDiff[];
    hasChanges: boolean;
    addedCount: number;
    removedCount: number;
    modifiedCount: number;
    isNew: boolean;
  }

  const docDiffs: DocDiff[] = [];
  let totalChangedClauses = 0;
  const changedClauseIds = new Set<string>();   // clause IDs that changed (before + after)
  const addedClauseAfterIds = new Set<string>(); // clause IDs that are brand new

  for (const file of specFiles) {
    const docId = relative(projectRoot, file);
    const storedClauses = specStore.getClauses(docId);
    const isNew = storedClauses.length === 0;

    const diffs = isNew ? [] : specStore.diffDocument(file, projectRoot);

    const added = diffs.filter(d => d.diff_type === DiffType.ADDED).length;
    const removed = diffs.filter(d => d.diff_type === DiffType.REMOVED).length;
    const modified = diffs.filter(d => d.diff_type === DiffType.MODIFIED).length;
    const hasChanges = isNew || added > 0 || removed > 0 || modified > 0;

    if (hasChanges) {
      // Track affected clause IDs for graph tracing
      for (const d of diffs) {
        if (d.diff_type === DiffType.MODIFIED || d.diff_type === DiffType.REMOVED) {
          if (d.clause_id_before) changedClauseIds.add(d.clause_id_before);
        }
        if (d.diff_type === DiffType.MODIFIED || d.diff_type === DiffType.ADDED) {
          if (d.clause_id_after) {
            changedClauseIds.add(d.clause_id_after);
            addedClauseAfterIds.add(d.clause_id_after);
          }
        }
      }
      totalChangedClauses += added + removed + modified;
    }

    docDiffs.push({ docId, filePath: file, diffs, hasChanges, addedCount: added, removedCount: removed, modifiedCount: modified, isNew });
  }

  const changedDocs = docDiffs.filter(d => d.hasChanges);

  if (changedDocs.length === 0) {
    console.log(`    ${green('✔')} No spec changes detected. Everything is up to date.`);
    return;
  }

  for (const doc of changedDocs) {
    if (doc.isNew) {
      console.log(`    ${green('+')} ${doc.docId} ${dim('(new spec)')}`);
    } else {
      const parts: string[] = [];
      if (doc.addedCount > 0) parts.push(green(`+${doc.addedCount}`));
      if (doc.removedCount > 0) parts.push(red(`-${doc.removedCount}`));
      if (doc.modifiedCount > 0) parts.push(yellow(`~${doc.modifiedCount}`));
      console.log(`    ${yellow('~')} ${doc.docId} ${dim('(')}${parts.join(dim(', '))}${dim(')')}`);
    }
  }
  console.log(`    ${dim(`${changedDocs.length} doc(s), ${totalChangedClauses} clause change(s)`)}`);
  console.log();

  // ─── Step 2: Trace impact through canonical graph ──────────────────────────

  console.log(`  ${dim('Step 2:')} Tracing impact through graphs`);

  const oldCanonNodes = canonStore.getAllNodes();
  const oldIUs = loadIUs(phoenixDir);

  // Find canon nodes sourced from changed clauses
  const affectedCanonIds = new Set<string>();
  for (const node of oldCanonNodes) {
    for (const clauseId of node.source_clause_ids) {
      if (changedClauseIds.has(clauseId)) {
        affectedCanonIds.add(node.canon_id);
        break;
      }
    }
  }

  // Find IUs sourced from affected canon nodes
  const affectedIUIds = new Set<string>();
  for (const iu of oldIUs) {
    for (const canonId of iu.source_canon_ids) {
      if (affectedCanonIds.has(canonId)) {
        affectedIUIds.add(iu.iu_id);
        break;
      }
    }
  }

  // Also trace IU dependencies (cascading)
  let changed = true;
  while (changed) {
    changed = false;
    for (const iu of oldIUs) {
      if (affectedIUIds.has(iu.iu_id)) continue;
      for (const dep of iu.dependencies) {
        if (affectedIUIds.has(dep)) {
          affectedIUIds.add(iu.iu_id);
          changed = true;
          break;
        }
      }
    }
  }

  // For new docs, all new IUs will be created — we'll detect them after re-planning
  const newDocIds = new Set(changedDocs.filter(d => d.isNew).map(d => d.docId));

  console.log(`    ${dim('Affected canonical nodes:')} ${affectedCanonIds.size > 0 ? yellow(String(affectedCanonIds.size)) : green('0')}`);
  console.log(`    ${dim('Affected IUs:')}             ${affectedIUIds.size > 0 ? yellow(String(affectedIUIds.size)) : green('0')}`);
  if (newDocIds.size > 0) {
    console.log(`    ${dim('New spec docs:')}            ${green(String(newDocIds.size))} ${dim('(will create new IUs)')}`);
  }
  console.log();

  if (dryRun) {
    console.log(cyan('  ── Dry run ──'));
    console.log();
    if (affectedIUIds.size > 0) {
      console.log(`  ${bold('IUs that would be regenerated:')}`);
      for (const iu of oldIUs) {
        if (affectedIUIds.has(iu.iu_id)) {
          console.log(`    ${yellow('⟳')} ${iu.name} ${dim(`(${iu.output_files.join(', ')})`)}`);
        }
      }
    }
    if (newDocIds.size > 0) {
      console.log(`  ${bold('New specs that would be fully processed:')}`);
      for (const docId of newDocIds) {
        console.log(`    ${green('+')} ${docId}`);
      }
    }
    console.log();
    console.log(dim('  Run without --dry-run to apply changes.'));
    return;
  }

  // ─── Step 3: Re-ingest changed specs ───────────────────────────────────────

  console.log(`  ${dim('Step 3:')} Re-ingesting changed specs`);

  for (const doc of changedDocs) {
    const result = specStore.ingestDocument(doc.filePath, projectRoot);
    console.log(`    ${green('✔')} ${doc.docId} → ${result.clauses.length} clauses`);
  }
  console.log();

  // ─── Step 4: Re-canonicalize (full — canon nodes are content-addressed) ────

  console.log(`  ${dim('Step 4:')} Re-canonicalization`);

  const allClauses: Clause[] = [];
  for (const specFile of specFiles) {
    const docId = relative(projectRoot, specFile);
    allClauses.push(...specStore.getClauses(docId));
  }

  const llm = forceStubs ? null : resolveProvider(phoenixDir);
  if (llm) {
    console.log(`    ${dim(`LLM: ${llm.name}/${llm.model}`)}`);
  }

  const newCanonNodes = await extractCanonicalNodesLLM(allClauses, llm);
  canonStore.saveNodes(newCanonNodes);

  // Compute warm hashes
  const warmHashes = computeWarmHashes(allClauses, newCanonNodes);
  const warmPath = join(phoenixDir, 'graphs', 'warm-hashes.json');
  const warmObj: Record<string, string> = {};
  for (const [k, v] of warmHashes) warmObj[k] = v;
  writeFileSync(warmPath, JSON.stringify(warmObj, null, 2), 'utf8');

  console.log(`    ${green('✔')} ${newCanonNodes.length} canonical nodes ${dim(`(was ${oldCanonNodes.length})`)}`);
  console.log();

  // ─── Step 5: Re-plan IUs ──────────────────────────────────────────────────

  console.log(`  ${dim('Step 5:')} Re-planning IUs`);

  const newIUs = planIUs(newCanonNodes, allClauses);
  saveIUs(phoenixDir, newIUs);

  // Determine which IUs to regenerate:
  // 1. IUs that existed before and were affected
  // 2. Brand new IUs (not in old set)
  const oldIUNames = new Set(oldIUs.map(iu => iu.name));
  const newIUNames = new Set(newIUs.map(iu => iu.name));

  // Match by name since IU IDs are content-addressed (change on any input change)
  const brandNewIUs = newIUs.filter(iu => !oldIUNames.has(iu.name));
  const removedIUNames = [...oldIUNames].filter(name => !newIUNames.has(name));

  // For existing IUs, check if their source canon nodes changed
  const iusToRegen: ImplementationUnit[] = [];
  for (const iu of newIUs) {
    if (!oldIUNames.has(iu.name)) {
      // Brand new IU — always regen
      iusToRegen.push(iu);
      continue;
    }
    // Check if any of its source canon IDs overlap with affected canon IDs,
    // OR if the IU's canon set itself changed (new canon nodes from changed clauses)
    const oldIU = oldIUs.find(o => o.name === iu.name);
    if (!oldIU) {
      iusToRegen.push(iu);
      continue;
    }

    // Did the canon sources change?
    const oldCanonSet = new Set(oldIU.source_canon_ids);
    const newCanonSet = new Set(iu.source_canon_ids);
    const canonChanged = iu.source_canon_ids.some(id => !oldCanonSet.has(id)) ||
                         oldIU.source_canon_ids.some(id => !newCanonSet.has(id));

    // Did the contract change? (different description, inputs, outputs, invariants)
    const contractChanged = JSON.stringify(oldIU.contract) !== JSON.stringify(iu.contract);

    if (canonChanged || contractChanged) {
      iusToRegen.push(iu);
    }
  }

  const unchangedCount = newIUs.length - iusToRegen.length;

  console.log(`    ${green('✔')} ${newIUs.length} IUs planned ${dim(`(was ${oldIUs.length})`)}`);
  if (brandNewIUs.length > 0) {
    console.log(`    ${green(`+ ${brandNewIUs.length} new IU(s)`)}`);
  }
  if (removedIUNames.length > 0) {
    console.log(`    ${red(`- ${removedIUNames.length} removed IU(s):`)} ${dim(removedIUNames.join(', '))}`);
  }
  console.log(`    ${yellow(`⟳ ${iusToRegen.length} IU(s) need regeneration`)}, ${green(`${unchangedCount} unchanged`)}`);
  console.log();

  if (iusToRegen.length === 0) {
    console.log(green('  ✔ No IUs need regeneration. Sync complete.'));
    return;
  }

  // ─── Step 6: Regenerate only affected IUs ──────────────────────────────────

  console.log(`  ${dim('Step 6:')} Regenerating ${iusToRegen.length} IU(s)`);

  const regenLLM = forceStubs ? null : resolveProvider(phoenixDir);
  if (regenLLM) {
    console.log(`    ${dim(`Provider: ${regenLLM.name}/${regenLLM.model}`)}`);
  } else {
    const { hint } = describeAvailability();
    console.log(`    ${dim('Mode: stubs')}${forceStubs ? '' : ` ${dim('—')} ${dim(hint)}`}`);
  }

  const regenCtx: RegenContext = {
    llm: regenLLM ?? undefined,
    canonNodes: newCanonNodes,
    allIUs: newIUs,
    projectRoot,
    onProgress: (iu, status, msg) => {
      if (status === 'start') process.stdout.write(`    ⏳ ${iu.name}…`);
      else if (status === 'done') process.stdout.write(` ${green('✔')}\n`);
      else if (status === 'error') process.stdout.write(` ${red('✖')} ${dim(msg || 'failed, using stub')}\n`);
    },
  };

  const manifestManager = new ManifestManager(phoenixDir);
  const results = await generateAll(iusToRegen, regenCtx);

  for (const result of results) {
    for (const [filePath, content] of result.files) {
      const fullPath = join(projectRoot, filePath);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, content, 'utf8');
    }
    manifestManager.recordIU(result.manifest);

    if (!regenLLM) {
      const iu = iusToRegen.find(i => i.iu_id === result.iu_id);
      console.log(`    ${green('✔')} ${iu?.name || result.iu_id.slice(0, 12)}`);
      for (const [filePath] of result.files) {
        console.log(`      → ${cyan(filePath)}`);
      }
    }
  }
  console.log();

  // ─── Step 7: Re-scaffold ──────────────────────────────────────────────────

  console.log(`  ${dim('Step 7:')} Updating scaffold`);
  const services = deriveServices(newIUs);
  const projectName = basename(projectRoot);
  const scaffold = generateScaffold(services, projectName);
  for (const [filePath, content] of scaffold.files) {
    const fullPath = join(projectRoot, filePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }
  for (const svc of services) {
    console.log(`    ${green('✔')} ${svc.name} → :${svc.port}`);
  }
  console.log();

  // ─── Step 8: Verify regenerated IUs ─────────────────────────────────────

  console.log(`  ${dim('Step 8:')} Verifying regenerated IUs`);

  const evidenceStore = new EvidenceStore(phoenixDir);
  const evidenceResults = runAllEvidence(iusToRegen, {
    projectRoot,
    onProgress: (u, check, status) => {
      if (status === 'start') process.stdout.write(`    ${dim('⏳')} ${u.name} · ${check}…`);
      else if (status === 'pass') process.stdout.write(` ${green('✔')}\n`);
      else if (status === 'fail') process.stdout.write(` ${red('✖')}\n`);
      else if (status === 'skip') process.stdout.write(` ${dim('⊘')}\n`);
    },
  });
  for (const r of evidenceResults) {
    evidenceStore.addRecords(r.records);
  }
  const evPass = evidenceResults.flatMap(r => r.checks).filter(c => c.status === 'PASS').length;
  const evFail = evidenceResults.flatMap(r => r.checks).filter(c => c.status === 'FAIL').length;
  console.log(`    ${evFail === 0 ? green('✔') : red('✖')} ${evPass} pass, ${evFail} fail`);
  console.log();

  // ─── Summary ──────────────────────────────────────────────────────────────

  console.log(green('  ✔ Sync complete.'));
  console.log(`    ${dim('Specs changed:')}   ${changedDocs.length}`);
  console.log(`    ${dim('IUs regenerated:')} ${iusToRegen.length}/${newIUs.length}`);
  console.log(`    ${dim('IUs unchanged:')}   ${unchangedCount}`);
  console.log(`    ${dim('Evidence:')}         ${green(String(evPass))} pass${evFail ? `, ${red(String(evFail))} fail` : ''}`);
  console.log();
  console.log(`    Run ${cyan('phoenix status')} to see the trust dashboard.`);
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
  ${cyan('sync')} [--dry-run]      Detect spec changes → regen only affected IUs
                         ${dim('--dry-run  Show what would change without applying')}
                         ${dim('--stubs    Force stub generation (skip LLM)')}

${bold('Spec Management:')}
  ${cyan('ingest')} [files...]     Ingest spec documents (default: all in spec/)
  ${cyan('diff')} [files...]       Show clause diffs vs stored state
  ${cyan('clauses')} [files...]    List stored clauses

${bold('Canonical Graph:')}
  ${cyan('canonicalize')}          Extract canonical nodes from ingested clauses
  ${cyan('canon')}                 Show the canonical graph

${bold('Implementation:')}
  ${cyan('plan')}                  Plan Implementation Units from canonical graph
  ${cyan('regen')} [--iu=<id>]    Regenerate code (all or specific IU)
                         ${dim('Uses LLM if ANTHROPIC_API_KEY or OPENAI_API_KEY is set')}
                         ${dim('--stubs  Force stub generation (skip LLM)')}

${bold('Verification:')}
  ${cyan('status')}                Trust dashboard — the primary UX
  ${cyan('verify')} [--iu=<id>]   Run evidence checks (typecheck, lint, boundary, tests)
                         ${dim('--only=typecheck,unit_tests   Run specific checks')}
                         ${dim('--skip=lint                   Skip specific checks')}
                         ${dim('--timeout=30000               Per-check timeout (ms)')}
  ${cyan('drift')}                 Check generated files for drift
  ${cyan('evaluate')} [--iu=<id>] Evaluate evidence against policy (read-only)
  ${cyan('cascade')}               Show cascade failure effects

${bold('Inspection:')}
  ${cyan('inspect')} [--port=N]    Interactive pipeline visualisation (opens browser)
  ${cyan('graph')}                 Show provenance graph summary
  ${cyan('bot')} "<command>"       Route a bot command (e.g., "SpecBot: help")

${bold('Meta:')}
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
      cmdInit();
      break;
    case 'bootstrap':
      await cmdBootstrap();
      break;
    case 'sync':
      await cmdSync(commandArgs);
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
    case 'canon':
      cmdCanon();
      break;
    case 'plan':
      cmdPlan();
      break;
    case 'regen':
    case 'regenerate':
      await cmdRegen(commandArgs);
      break;
    case 'drift':
      cmdDrift();
      break;
    case 'verify':
    case 'evidence':
      cmdVerify(commandArgs);
      break;
    case 'evaluate':
    case 'eval':
      cmdEvaluate(commandArgs);
      break;
    case 'cascade':
      cmdCascade();
      break;
    case 'inspect':
      await cmdInspect(commandArgs);
      break;
    case 'graph':
      cmdGraph();
      break;
    case 'bot':
      cmdBot(commandArgs);
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
