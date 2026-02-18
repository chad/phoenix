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
import { extractCanonicalNodes } from './canonicalizer.js';
import { computeWarmHashes } from './warm-hasher.js';
import { classifyChanges } from './classifier.js';
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

// Phase E
import { runShadowPipeline } from './shadow-pipeline.js';

// Phase F
import { parseCommand, routeCommand, getAllCommands } from './bot-router.js';

// Scaffold
import { deriveServices, generateScaffold } from './scaffold.js';

// LLM
import { resolveProvider, describeAvailability } from './llm/resolve.js';

// Models
import type { Clause } from './models/clause.js';
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
  console.log(`  ${dim('Phase B:')} Canonicalization + warm context hashing`);

  // Collect all clauses
  const allClauses: Clause[] = [];
  for (const specFile of specFiles) {
    const docId = relative(projectRoot, specFile);
    allClauses.push(...specStore.getClauses(docId));
  }

  // Extract canonical nodes
  const canonNodes = extractCanonicalNodes(allClauses);
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

function cmdCanonicalize(): void {
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

  console.log(bold('📐 Canonicalization'));
  console.log();

  const canonNodes = extractCanonicalNodes(allClauses);
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

${bold('Implementation:')}
  ${cyan('plan')}                  Plan Implementation Units from canonical graph
  ${cyan('regen')} [--iu=<id>]    Regenerate code (all or specific IU)
                         ${dim('Uses LLM if ANTHROPIC_API_KEY or OPENAI_API_KEY is set')}
                         ${dim('--stubs  Force stub generation (skip LLM)')}

${bold('Verification:')}
  ${cyan('status')}                Trust dashboard — the primary UX
  ${cyan('drift')}                 Check generated files for drift
  ${cyan('evaluate')} [--iu=<id>] Evaluate evidence against policy
  ${cyan('cascade')}               Show cascade failure effects

${bold('Inspection:')}
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
      cmdCanonicalize();
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
    case 'evaluate':
    case 'eval':
      cmdEvaluate(commandArgs);
      break;
    case 'cascade':
      cmdCascade();
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
