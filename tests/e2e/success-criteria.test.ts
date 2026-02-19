/**
 * End-to-End Integration Tests
 *
 * Tests the full Phoenix pipeline from init → bootstrap → status,
 * validating PRD Section 19 Success Criteria:
 *
 * 1. Delete generated code → full regen succeeds
 * 2. Clause change invalidates only dependent IU subtree
 * 3. Boundary linter catches undeclared coupling
 * 4. Drift detection blocks unlabeled edits
 * 5. D-rate within acceptable bounds
 * 6. Shadow pipeline upgrade produces classified diff
 * 7. Compaction preserves ancestry
 * 8. Freeq bots perform ingest/canon/plan/regen/status safely
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, rmSync, readdirSync, cpSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// Core pipeline imports
import { parseSpec } from '../../src/spec-parser.js';
import { diffClauses } from '../../src/diff.js';
import { extractCanonicalNodes } from '../../src/canonicalizer.js';
import { computeWarmHashes } from '../../src/warm-hasher.js';
import { classifyChanges } from '../../src/classifier.js';
import { planIUs } from '../../src/iu-planner.js';
import { generateIU, generateAll } from '../../src/regen.js';
import { ManifestManager } from '../../src/manifest.js';
import { detectDrift } from '../../src/drift.js';
import { extractDependencies } from '../../src/dep-extractor.js';
import { validateBoundary, detectBoundaryChanges } from '../../src/boundary-validator.js';
import { evaluatePolicy, evaluateAllPolicies } from '../../src/policy-engine.js';
import { computeCascade } from '../../src/cascade.js';
import { runShadowPipeline } from '../../src/shadow-pipeline.js';
import { runCompaction, identifyCandidates, shouldTriggerCompaction } from '../../src/compaction.js';
import { DRateTracker } from '../../src/d-rate.js';
import { BootstrapStateMachine } from '../../src/bootstrap.js';
import { parseCommand, routeCommand, getAllCommands } from '../../src/bot-router.js';
import { deriveServices, generateScaffold } from '../../src/scaffold.js';

// Stores
import { SpecStore } from '../../src/store/spec-store.js';
import { CanonicalStore } from '../../src/store/canonical-store.js';
import { EvidenceStore } from '../../src/store/evidence-store.js';

// Models
import { CanonicalType } from '../../src/models/canonical.js';
import { ChangeClass, BootstrapState, DRateLevel } from '../../src/models/classification.js';
import { DriftStatus } from '../../src/models/manifest.js';
import { EvidenceKind, EvidenceStatus } from '../../src/models/evidence.js';
import type { Clause } from '../../src/models/clause.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import type { BotCommand } from '../../src/models/bot.js';

const fixturesDir = join(import.meta.dirname, '..', 'fixtures');

/**
 * Helper: sets up a complete Phoenix project in a temp directory
 * with spec files, runs the full bootstrap pipeline, and returns all state.
 */
function bootstrapProject(specFiles: string[]) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'phoenix-e2e-'));
  const phoenixDir = join(projectRoot, '.phoenix');
  const specDir = join(projectRoot, 'spec');

  // Init
  mkdirSync(join(phoenixDir, 'store', 'objects'), { recursive: true });
  mkdirSync(join(phoenixDir, 'graphs'), { recursive: true });
  mkdirSync(join(phoenixDir, 'manifests'), { recursive: true });
  mkdirSync(specDir, { recursive: true });

  // Copy spec files
  for (const src of specFiles) {
    const dest = join(specDir, src.split('/').pop()!);
    cpSync(src, dest);
  }

  // Ingest
  const specStore = new SpecStore(phoenixDir);
  const allClauses: Clause[] = [];
  const specFilesList = readdirSync(specDir).filter(f => f.endsWith('.md')).map(f => join(specDir, f));
  for (const sf of specFilesList) {
    const result = specStore.ingestDocument(sf, projectRoot);
    allClauses.push(...result.clauses);
  }

  // Canonicalize
  const canonStore = new CanonicalStore(phoenixDir);
  const canonNodes = extractCanonicalNodes(allClauses);
  canonStore.saveNodes(canonNodes);

  // Warm hashes
  const warmHashes = computeWarmHashes(allClauses, canonNodes);

  // Plan IUs
  const ius = planIUs(canonNodes, allClauses);
  writeFileSync(join(phoenixDir, 'graphs', 'ius.json'), JSON.stringify(ius, null, 2));

  // Bootstrap state
  const machine = new BootstrapStateMachine();
  machine.markWarmPassComplete();
  writeFileSync(join(phoenixDir, 'state.json'), JSON.stringify(machine.toJSON(), null, 2));

  return {
    projectRoot,
    phoenixDir,
    specStore,
    canonStore,
    allClauses,
    canonNodes,
    warmHashes,
    ius,
    machine,
  };
}

/**
 * Helper: generate code and write to disk, returning manifest.
 */
async function generateAndWrite(
  projectRoot: string,
  phoenixDir: string,
  ius: ImplementationUnit[],
) {
  const manifestManager = new ManifestManager(phoenixDir);
  const results = await generateAll(ius);

  for (const result of results) {
    for (const [filePath, content] of result.files) {
      const fullPath = join(projectRoot, filePath);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, content, 'utf8');
    }
    manifestManager.recordIU(result.manifest);
  }

  return { results, manifestManager };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUCCESS CRITERIA TESTS (PRD §19)
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: Success Criteria §19.1 — Delete generated code → full regen succeeds', () => {
  it('regenerates all code from scratch after deletion', async () => {
    const ctx = bootstrapProject([
      join(fixturesDir, 'spec-auth-v1.md'),
      join(fixturesDir, 'spec-gateway.md'),
    ]);

    // Generate initial code
    const { results, manifestManager } = await generateAndWrite(
      ctx.projectRoot, ctx.phoenixDir, ctx.ius,
    );

    // Verify files exist
    for (const result of results) {
      for (const [filePath] of result.files) {
        expect(existsSync(join(ctx.projectRoot, filePath))).toBe(true);
      }
    }

    // Verify drift is clean
    const manifest1 = manifestManager.load();
    const report1 = detectDrift(manifest1, ctx.projectRoot);
    expect(report1.drifted_count).toBe(0);
    expect(report1.missing_count).toBe(0);

    // DELETE all generated code
    const genDir = join(ctx.projectRoot, 'src', 'generated');
    if (existsSync(genDir)) {
      rmSync(genDir, { recursive: true });
    }

    // Verify files are gone → drift detects missing
    const report2 = detectDrift(manifest1, ctx.projectRoot);
    expect(report2.missing_count).toBeGreaterThan(0);

    // REGENERATE from scratch
    const manifestManager2 = new ManifestManager(ctx.phoenixDir);
    const results2 = await generateAll(ctx.ius);
    for (const result of results2) {
      for (const [filePath, content] of result.files) {
        const fullPath = join(ctx.projectRoot, filePath);
        mkdirSync(join(fullPath, '..'), { recursive: true });
        writeFileSync(fullPath, content, 'utf8');
      }
      manifestManager2.recordIU(result.manifest);
    }

    // Verify regenerated files exist and are clean
    const report3 = detectDrift(manifestManager2.load(), ctx.projectRoot);
    expect(report3.drifted_count).toBe(0);
    expect(report3.missing_count).toBe(0);
    expect(report3.clean_count).toBeGreaterThan(0);
  });
});

describe('E2E: Success Criteria §19.2 — Clause change invalidates only dependent IU subtree', () => {
  it('changing one spec section only affects the corresponding IU', () => {
    const ctx = bootstrapProject([
      join(fixturesDir, 'spec-gateway.md'),
    ]);

    // Record original IU state
    const originalIUs = [...ctx.ius];
    expect(originalIUs.length).toBeGreaterThan(1);

    // Modify only the Rate Limiting section
    const specPath = join(ctx.projectRoot, 'spec', 'spec-gateway.md');
    const original = readFileSync(specPath, 'utf8');
    const modified = original.replace(
      '- All endpoints must be rate-limited to 100 requests per minute per client',
      '- All endpoints must be rate-limited to 200 requests per minute per client',
    );
    writeFileSync(specPath, modified, 'utf8');

    // Re-ingest
    const specStore2 = new SpecStore(ctx.phoenixDir);
    specStore2.ingestDocument(specPath, ctx.projectRoot);
    const docId = relative(ctx.projectRoot, specPath);
    const newClauses = specStore2.getClauses(docId);

    // Re-canonicalize
    const newCanon = extractCanonicalNodes(newClauses);

    // Re-plan
    const newIUs = planIUs(newCanon, newClauses);

    // Find which IUs actually changed (different canon_ids)
    const originalIUMap = new Map(originalIUs.map(iu => [iu.name, new Set(iu.source_canon_ids)]));
    const changedIUs: string[] = [];
    const unchangedIUs: string[] = [];

    for (const iu of newIUs) {
      const origCanonIds = originalIUMap.get(iu.name);
      if (!origCanonIds) {
        changedIUs.push(iu.name);
        continue;
      }
      const newCanonIds = new Set(iu.source_canon_ids);
      const same = origCanonIds.size === newCanonIds.size &&
        [...origCanonIds].every(id => newCanonIds.has(id));
      if (same) unchangedIUs.push(iu.name);
      else changedIUs.push(iu.name);
    }

    // Only rate-limiting related IU should change, not all of them
    expect(changedIUs.length).toBeGreaterThan(0);
    // With a multi-section spec, at least some IUs should be unchanged
    // (If the planner merges all into one IU, this is still valid but trivially true)
    if (newIUs.length > 1) {
      expect(unchangedIUs.length).toBeGreaterThan(0);
    }
  });
});

describe('E2E: Success Criteria §19.3 — Boundary linter catches undeclared coupling', () => {
  it('detects forbidden imports and undeclared side channels', async () => {
    const ctx = bootstrapProject([
      join(fixturesDir, 'spec-gateway.md'),
    ]);

    // Generate code
    await generateAndWrite(ctx.projectRoot, ctx.phoenixDir, ctx.ius);

    // Now inject bad code into a generated file
    const iu = ctx.ius[0];
    const filePath = iu.output_files[0];
    const fullPath = join(ctx.projectRoot, filePath);

    const badCode = `
import axios from 'axios';
import { adminSecret } from '../internal/admin.js';
const dbUrl = process.env.SECRET_DB_URL;
export function badHandler() { return axios.get(dbUrl!); }
export const _phoenix = { iu_id: '${iu.iu_id}', name: '${iu.name}', risk_tier: '${iu.risk_tier}', canon_ids: [0 as const] } as const;
`;
    writeFileSync(fullPath, badCode, 'utf8');

    // Set up forbidden boundary policy
    const iuWithPolicy = {
      ...iu,
      boundary_policy: {
        code: {
          allowed_ius: [],
          allowed_packages: [],
          forbidden_ius: [],
          forbidden_packages: ['axios'],
          forbidden_paths: ['../internal/**'],
        },
        side_channels: {
          databases: [], queues: [], caches: [],
          config: [], external_apis: [], files: [],
        },
      },
    };

    const source = readFileSync(fullPath, 'utf8');
    const depGraph = extractDependencies(source, filePath);
    const diagnostics = validateBoundary(depGraph, iuWithPolicy);

    // Should catch forbidden package, forbidden path, undeclared side channel
    expect(diagnostics.length).toBeGreaterThanOrEqual(2);
    const categories = diagnostics.map(d => d.category);
    expect(categories).toContain('dependency_violation');
  });
});

describe('E2E: Success Criteria §19.4 — Drift detection blocks unlabeled edits', () => {
  it('detects manual edits and reports drift', async () => {
    const ctx = bootstrapProject([
      join(fixturesDir, 'spec-auth-v1.md'),
    ]);

    const { manifestManager } = await generateAndWrite(
      ctx.projectRoot, ctx.phoenixDir, ctx.ius,
    );

    // Clean baseline
    const report1 = detectDrift(manifestManager.load(), ctx.projectRoot);
    expect(report1.drifted_count).toBe(0);

    // Make a manual edit to a generated file
    const firstIU = ctx.ius[0];
    const filePath = firstIU.output_files[0];
    const fullPath = join(ctx.projectRoot, filePath);
    const original = readFileSync(fullPath, 'utf8');
    writeFileSync(fullPath, '// MANUAL EDIT\n' + original, 'utf8');

    // Drift detection catches it
    const report2 = detectDrift(manifestManager.load(), ctx.projectRoot);
    expect(report2.drifted_count).toBe(1);
    expect(report2.summary).toContain('DRIFT DETECTED');

    // The drifted entry should point to the correct file
    const drifted = report2.entries.filter(e => e.status === DriftStatus.DRIFTED);
    expect(drifted.length).toBe(1);
    expect(drifted[0].file_path).toBe(filePath);
  });

  it('detects missing files as drift', async () => {
    const ctx = bootstrapProject([
      join(fixturesDir, 'spec-auth-v1.md'),
    ]);

    const { manifestManager } = await generateAndWrite(
      ctx.projectRoot, ctx.phoenixDir, ctx.ius,
    );

    // Delete a generated file
    const filePath = ctx.ius[0].output_files[0];
    const fullPath = join(ctx.projectRoot, filePath);
    rmSync(fullPath);

    const report = detectDrift(manifestManager.load(), ctx.projectRoot);
    expect(report.missing_count).toBe(1);
    const missing = report.entries.filter(e => e.status === DriftStatus.MISSING);
    expect(missing[0].file_path).toBe(filePath);
  });
});

describe('E2E: Success Criteria §19.5 — D-rate within acceptable bounds', () => {
  it('standard spec changes produce D-rate within target', () => {
    // v1 → v2 evolution
    const v1 = readFileSync(join(fixturesDir, 'spec-auth-v1.md'), 'utf8');
    const v2 = readFileSync(join(fixturesDir, 'spec-auth-v2.md'), 'utf8');

    const clauses1 = parseSpec(v1, 'spec/auth.md');
    const clauses2 = parseSpec(v2, 'spec/auth.md');
    const canon1 = extractCanonicalNodes(clauses1);
    const canon2 = extractCanonicalNodes(clauses2);
    const warm1 = computeWarmHashes(clauses1, canon1);
    const warm2 = computeWarmHashes(clauses2, canon2);
    const diffs = diffClauses(clauses1, clauses2);
    const classifications = classifyChanges(diffs, canon1, canon2, warm1, warm2);

    // Track D-rate
    const tracker = new DRateTracker(100);
    for (const c of classifications) {
      tracker.recordOne(c.change_class);
    }

    const status = tracker.getStatus();
    // D-rate should be ≤15% (ALARM threshold) for a well-structured spec change
    expect(status.rate).toBeLessThanOrEqual(0.15);
  });

  it('bootstrap state machine transitions correctly with good D-rate', () => {
    const machine = new BootstrapStateMachine();
    expect(machine.getState()).toBe(BootstrapState.BOOTSTRAP_COLD);
    expect(machine.shouldSuppressAlarms()).toBe(true);

    machine.markWarmPassComplete();
    expect(machine.getState()).toBe(BootstrapState.BOOTSTRAP_WARMING);
    expect(machine.shouldDowngradeSeverity()).toBe(true);

    // Good D-rate → transition to STEADY_STATE
    const tracker = new DRateTracker(50);
    for (let i = 0; i < 45; i++) tracker.recordOne(ChangeClass.B);
    for (let i = 0; i < 5; i++) tracker.recordOne(ChangeClass.A);

    machine.evaluateTransition(tracker.getStatus());
    expect(machine.getState()).toBe(BootstrapState.STEADY_STATE);
    expect(machine.shouldSuppressAlarms()).toBe(false);
    expect(machine.shouldDowngradeSeverity()).toBe(false);
  });
});

describe('E2E: Success Criteria §19.6 — Shadow pipeline upgrade produces classified diff', () => {
  it('classifies identical pipelines as SAFE', () => {
    const clauses = parseSpec(readFileSync(join(fixturesDir, 'spec-auth-v1.md'), 'utf8'), 'auth.md');
    const canon = extractCanonicalNodes(clauses);

    const oldP = { pipeline_id: 'v1', model_id: 'gpt-4', promptpack_version: '1.0', extraction_rules_version: '1', diff_policy_version: '1' };
    const newP = { pipeline_id: 'v2', model_id: 'gpt-4o', promptpack_version: '1.1', extraction_rules_version: '1', diff_policy_version: '1' };

    const result = runShadowPipeline(oldP, newP, canon, canon);
    expect(result.classification).toBe('SAFE');
    expect(result.metrics.node_change_pct).toBe(0);
    expect(result.metrics.orphan_nodes).toBe(0);
  });

  it('classifies major changes as COMPACTION_EVENT or REJECT', () => {
    const v1 = parseSpec(readFileSync(join(fixturesDir, 'spec-auth-v1.md'), 'utf8'), 'auth.md');
    const canonV1 = extractCanonicalNodes(v1);

    // Simulate a drastically different canonical graph from new pipeline
    const canonV2 = canonV1.slice(0, 1); // keep only first node

    const oldP = { pipeline_id: 'v1', model_id: 'gpt-4', promptpack_version: '1', extraction_rules_version: '1', diff_policy_version: '1' };
    const newP = { pipeline_id: 'v2', model_id: 'claude-4', promptpack_version: '2', extraction_rules_version: '2', diff_policy_version: '2' };

    const result = runShadowPipeline(oldP, newP, canonV1, canonV2);
    // Should not be SAFE since we lost most nodes
    expect(['COMPACTION_EVENT', 'REJECT']).toContain(result.classification);
    expect(result.metrics.node_change_pct).toBeGreaterThan(0);
  });
});

describe('E2E: Success Criteria §19.7 — Compaction preserves ancestry', () => {
  it('never deletes node headers, provenance edges, approvals, or signatures', () => {
    const objects = [
      // Should be preserved (critical types)
      { object_id: 'n1', object_type: 'node_header', age_days: 90, size_bytes: 100, preserve: true },
      { object_id: 'p1', object_type: 'provenance_edge', age_days: 90, size_bytes: 50, preserve: true },
      { object_id: 'a1', object_type: 'approval', age_days: 90, size_bytes: 200, preserve: true },
      { object_id: 's1', object_type: 'signature', age_days: 90, size_bytes: 300, preserve: true },
      // Should be compacted (old blobs)
      { object_id: 'b1', object_type: 'clause_body', age_days: 60, size_bytes: 5000, preserve: false },
      { object_id: 'b2', object_type: 'generated_blob', age_days: 60, size_bytes: 10000, preserve: false },
      // Should be kept (recent)
      { object_id: 'b3', object_type: 'clause_body', age_days: 10, size_bytes: 3000, preserve: false },
    ];

    const event = runCompaction(objects, 'size_threshold', 30);

    // Only old non-preserved blobs compacted
    expect(event.nodes_compacted).toBe(2); // b1 and b2
    expect(event.bytes_freed).toBe(15000);

    // All critical types preserved
    expect(event.preserved.node_headers).toBe(1);
    expect(event.preserved.provenance_edges).toBe(1);
    expect(event.preserved.approvals).toBe(1);
    expect(event.preserved.signatures).toBe(1);
  });
});

describe('E2E: Success Criteria §19.8 — Freeq bots perform operations safely', () => {
  it('SpecBot: ingest is mutating and requires confirmation', () => {
    const parsed = parseCommand('SpecBot: ingest spec/gateway.md');
    expect('error' in parsed).toBe(false);
    const cmd = parsed as BotCommand;
    expect(cmd.bot).toBe('SpecBot');
    expect(cmd.action).toBe('ingest');

    const resp = routeCommand(cmd);
    expect(resp.mutating).toBe(true);
    expect(resp.confirm_id).toBeTruthy();
    expect(resp.intent).toContain('spec/gateway.md');
  });

  it('ImplBot: regen is mutating', () => {
    const resp = routeCommand(parseCommand('ImplBot: regen iu=AuthIU') as BotCommand);
    expect(resp.mutating).toBe(true);
    expect(resp.confirm_id).toBeTruthy();
  });

  it('PolicyBot: status is read-only (no confirmation needed)', () => {
    const resp = routeCommand(parseCommand('PolicyBot: status') as BotCommand);
    expect(resp.mutating).toBe(false);
    expect(resp.confirm_id).toBeUndefined();
  });

  it('all bots expose help and commands', () => {
    const commands = getAllCommands();
    expect(Object.keys(commands).length).toBeGreaterThanOrEqual(3);

    for (const bot of ['SpecBot', 'ImplBot', 'PolicyBot']) {
      const helpResp = routeCommand({ bot: bot as any, action: 'help', args: {}, raw: `${bot}: help` });
      expect(helpResp.message).toBeTruthy();

      const cmdsResp = routeCommand({ bot: bot as any, action: 'commands', args: {}, raw: `${bot}: commands` });
      expect(cmdsResp.message).toBeTruthy();

      const verResp = routeCommand({ bot: bot as any, action: 'version', args: {}, raw: `${bot}: version` });
      expect(verResp.message).toBeTruthy();
    }
  });

  it('invalid bot commands produce errors', () => {
    const parsed = parseCommand('UnknownBot: do_stuff');
    expect('error' in parsed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-SPEC PROJECT E2E
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: Multi-Spec Project Lifecycle', () => {
  it('bootstraps a project with multiple spec files and produces correct service structure', async () => {
    const ctx = bootstrapProject([
      join(fixturesDir, 'spec-auth-v1.md'),
      join(fixturesDir, 'spec-gateway.md'),
      join(fixturesDir, 'spec-notifications.md'),
    ]);

    // Should have multiple IUs from different specs
    expect(ctx.ius.length).toBeGreaterThanOrEqual(3);

    // Each IU should have unique output files
    const allOutputFiles = ctx.ius.flatMap(iu => iu.output_files);
    expect(new Set(allOutputFiles).size).toBe(allOutputFiles.length);

    // Canon nodes should span all spec files
    expect(ctx.canonNodes.length).toBeGreaterThan(10);

    // Generate code
    const { results, manifestManager } = await generateAndWrite(
      ctx.projectRoot, ctx.phoenixDir, ctx.ius,
    );

    // All IUs should produce code
    expect(results.length).toBe(ctx.ius.length);
    for (const result of results) {
      expect(result.files.size).toBeGreaterThan(0);
    }

    // Drift should be clean
    const report = detectDrift(manifestManager.load(), ctx.projectRoot);
    expect(report.drifted_count).toBe(0);
    expect(report.missing_count).toBe(0);

    // Service scaffold
    const services = deriveServices(ctx.ius);
    expect(services.length).toBeGreaterThanOrEqual(2);

    const scaffold = generateScaffold(services, 'test-project');
    expect(scaffold.files.has('package.json')).toBe(true);
    expect(scaffold.files.has('tsconfig.json')).toBe(true);

    // Each service should have an index and server
    for (const svc of services) {
      expect(scaffold.files.has(`src/generated/${svc.dir}/index.ts`)).toBe(true);
      expect(scaffold.files.has(`src/generated/${svc.dir}/server.ts`)).toBe(true);
    }
  });

  it('handles spec evolution: add new spec, re-bootstrap, verify incremental', async () => {
    // Start with one spec
    const ctx = bootstrapProject([
      join(fixturesDir, 'spec-auth-v1.md'),
    ]);
    const initialIUCount = ctx.ius.length;

    await generateAndWrite(ctx.projectRoot, ctx.phoenixDir, ctx.ius);

    // Add a new spec
    cpSync(
      join(fixturesDir, 'spec-gateway.md'),
      join(ctx.projectRoot, 'spec', 'spec-gateway.md'),
    );

    // Re-ingest all
    const specStore2 = new SpecStore(ctx.phoenixDir);
    const newClauses: Clause[] = [];
    const specDir = join(ctx.projectRoot, 'spec');
    for (const f of readdirSync(specDir).filter(f => f.endsWith('.md'))) {
      const result = specStore2.ingestDocument(join(specDir, f), ctx.projectRoot);
      newClauses.push(...result.clauses);
    }

    // Re-canonicalize and plan
    const newCanon = extractCanonicalNodes(newClauses);
    const newIUs = planIUs(newCanon, newClauses);

    // Should have more IUs now
    expect(newIUs.length).toBeGreaterThan(initialIUCount);

    // Generate new code
    const manifestManager2 = new ManifestManager(ctx.phoenixDir);
    const results2 = await generateAll(newIUs);
    for (const result of results2) {
      for (const [filePath, content] of result.files) {
        const fullPath = join(ctx.projectRoot, filePath);
        mkdirSync(join(fullPath, '..'), { recursive: true });
        writeFileSync(fullPath, content, 'utf8');
      }
      manifestManager2.recordIU(result.manifest);
    }

    // Clean drift
    const report = detectDrift(manifestManager2.load(), ctx.projectRoot);
    expect(report.drifted_count).toBe(0);
  });
});

describe('E2E: Evidence & Cascade Pipeline', () => {
  it('full lifecycle: no evidence → incomplete → pass → fail → cascade block', async () => {
    const ctx = bootstrapProject([
      join(fixturesDir, 'spec-auth-v1.md'),
    ]);
    await generateAndWrite(ctx.projectRoot, ctx.phoenixDir, ctx.ius);

    const iu = ctx.ius[0];
    const evidenceStore = new EvidenceStore(ctx.phoenixDir);

    // Step 1: No evidence → INCOMPLETE
    const eval1 = evaluatePolicy(iu, []);
    expect(eval1.verdict).toBe('INCOMPLETE');
    expect(eval1.missing.length).toBeGreaterThan(0);

    // Step 2: Submit all required evidence → PASS
    const passingRecords = iu.evidence_policy.required.map((kind, i) => ({
      evidence_id: `ev-pass-${i}`,
      kind: kind as EvidenceKind,
      status: EvidenceStatus.PASS,
      iu_id: iu.iu_id,
      canon_ids: iu.source_canon_ids,
      timestamp: new Date().toISOString(),
    }));
    evidenceStore.addRecords(passingRecords);

    const eval2 = evaluatePolicy(iu, evidenceStore.getAll());
    expect(eval2.verdict).toBe('PASS');

    // Step 3: Submit a failing typecheck → FAIL
    evidenceStore.addRecord({
      evidence_id: 'ev-fail',
      kind: EvidenceKind.TYPECHECK,
      status: EvidenceStatus.FAIL,
      iu_id: iu.iu_id,
      canon_ids: [],
      message: 'TS2345: Argument not assignable',
      timestamp: new Date(Date.now() + 1000).toISOString(),
    });

    const eval3 = evaluatePolicy(iu, evidenceStore.getAll());
    expect(eval3.verdict).toBe('FAIL');
    expect(eval3.failed).toContain('typecheck');

    // Step 4: Cascade should block this IU
    const allEvals = evaluateAllPolicies(ctx.ius, evidenceStore.getAll());
    const cascadeEvents = computeCascade(allEvals, ctx.ius);
    expect(cascadeEvents.length).toBeGreaterThan(0);

    const blockActions = cascadeEvents.flatMap(e => e.actions).filter(a => a.action === 'BLOCK');
    expect(blockActions.length).toBeGreaterThan(0);
  });
});

describe('E2E: Provenance Traceability', () => {
  it('traces from spec line → clause → canon node → IU → generated file', async () => {
    const ctx = bootstrapProject([
      join(fixturesDir, 'spec-auth-v1.md'),
    ]);
    const { results } = await generateAndWrite(ctx.projectRoot, ctx.phoenixDir, ctx.ius);

    // Pick a requirement from the spec
    const authRequirement = ctx.canonNodes.find(n =>
      n.statement.toLowerCase().includes('authenticate') && n.type === CanonicalType.REQUIREMENT,
    );
    expect(authRequirement).toBeDefined();

    // Trace to source clause
    expect(authRequirement!.source_clause_ids.length).toBeGreaterThan(0);
    const sourceClauseId = authRequirement!.source_clause_ids[0];
    const sourceClause = ctx.allClauses.find(c => c.clause_id === sourceClauseId);
    expect(sourceClause).toBeDefined();
    expect(sourceClause!.source_doc_id).toContain('auth');

    // Trace to IU
    const containingIU = ctx.ius.find(iu =>
      iu.source_canon_ids.includes(authRequirement!.canon_id),
    );
    expect(containingIU).toBeDefined();

    // Trace to generated file
    expect(containingIU!.output_files.length).toBeGreaterThan(0);
    const outputFile = containingIU!.output_files[0];
    const fullPath = join(ctx.projectRoot, outputFile);
    expect(existsSync(fullPath)).toBe(true);

    // Generated file should contain Phoenix traceability metadata
    const content = readFileSync(fullPath, 'utf8');
    expect(content).toContain('_phoenix');
    expect(content).toContain(containingIU!.iu_id);
  });
});
