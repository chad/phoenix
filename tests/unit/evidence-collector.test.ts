import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectLowTierEvidence, iuArtifactHash } from '../../src/evidence-collector.js';
import { evaluatePolicy } from '../../src/policy-engine.js';
import { EvidenceKind, EvidenceStatus } from '../../src/models/evidence.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';
import type { GeneratedManifest } from '../../src/models/manifest.js';
import { sha256 } from '../../src/semhash.js';

function iu(id: string, tier: string, file: string): ImplementationUnit {
  const required = tier === 'low'
    ? ['typecheck', 'lint', 'boundary_validation']
    : ['typecheck', 'lint', 'boundary_validation', 'unit_tests'];
  return {
    iu_id: id, kind: 'module', name: id, risk_tier: tier as any,
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: ['canon-1'], dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required }, output_files: [file],
  };
}

describe('collectLowTierEvidence', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'phoenix-ev-')); });
  function write(rel: string, content: string): string {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
    return content;
  }
  function manifestFor(id: string, rel: string, content: string): GeneratedManifest {
    return {
      iu_manifests: { [id]: { iu_id: id, iu_name: id, files: { [rel]: { path: rel, content_hash: sha256(content), size: content.length } }, regen_metadata: { model_id: 'stub', promptpack_hash: '', toolchain_version: 't', generated_at: '' } } },
      shared_files: {}, generated_at: 'now',
    };
  }

  it('records PASS typecheck/lint/boundary when project compiles and no boundary errors', () => {
    const content = write('src/a.ts', 'export const x = 1;');
    const unit = iu('iu-a', 'low', 'src/a.ts');
    const records = collectLowTierEvidence({
      ius: [unit], manifest: manifestFor('iu-a', 'src/a.ts', content), projectRoot: root,
      compileErrors: [], boundaryDiagnostics: [], now: () => '2026-01-01T00:00:00Z',
    });
    const kinds = records.filter(r => r.status === EvidenceStatus.PASS).map(r => r.kind).sort();
    expect(kinds).toEqual([EvidenceKind.BOUNDARY_VALIDATION, EvidenceKind.LINT, EvidenceKind.TYPECHECK]);
    // Every record binds the current artifact hash.
    expect(records.every(r => r.artifact_hash)).toBe(true);
  });

  it('records FAIL typecheck when the IU file has a compile error', () => {
    const content = write('src/a.ts', 'export const x: number = "bad";');
    const unit = iu('iu-a', 'low', 'src/a.ts');
    const records = collectLowTierEvidence({
      ius: [unit], manifest: manifestFor('iu-a', 'src/a.ts', content), projectRoot: root,
      compileErrors: [{ file: 'src/a.ts', line: 1, column: 1, code: 'TS2322', message: 'type', raw: '' }],
      boundaryDiagnostics: [],
    });
    const tc = records.find(r => r.kind === EvidenceKind.TYPECHECK);
    expect(tc?.status).toBe(EvidenceStatus.FAIL);
  });

  it('records FAIL boundary when an error-severity diagnostic targets the IU', () => {
    const content = write('src/a.ts', 'export const x = 1;');
    const unit = iu('iu-a', 'low', 'src/a.ts');
    const records = collectLowTierEvidence({
      ius: [unit], manifest: manifestFor('iu-a', 'src/a.ts', content), projectRoot: root,
      compileErrors: [],
      boundaryDiagnostics: [{ severity: 'error', category: 'dependency_violation', subject: 'iu-a', message: 'forbidden', iu_id: 'iu-a', recommended_actions: [] }],
    });
    expect(records.find(r => r.kind === EvidenceKind.BOUNDARY_VALIDATION)?.status).toBe(EvidenceStatus.FAIL);
  });

  it('skips IUs whose files are not on disk', () => {
    const unit = iu('iu-a', 'low', 'src/missing.ts');
    const records = collectLowTierEvidence({
      ius: [unit], manifest: { iu_manifests: {}, shared_files: {}, generated_at: '' }, projectRoot: root,
      compileErrors: [], boundaryDiagnostics: [],
    });
    expect(records).toHaveLength(0);
  });

  it('artifact hash changes when the file content changes (staleness driver)', () => {
    const c1 = write('src/a.ts', 'export const x = 1;');
    const unit = iu('iu-a', 'low', 'src/a.ts');
    const h1 = iuArtifactHash(unit, manifestFor('iu-a', 'src/a.ts', c1), root);
    const c2 = 'export const x = 2;';
    const h2 = iuArtifactHash(unit, manifestFor('iu-a', 'src/a.ts', c2), root);
    expect(h1).not.toBe(h2);
  });
});

describe('policy engine rejects stale evidence', () => {
  const unit = iu('iu-a', 'low', 'src/a.ts');
  const pass = (hash?: string) => ({
    evidence_id: 'e1', kind: EvidenceKind.TYPECHECK, status: EvidenceStatus.PASS,
    iu_id: 'iu-a', canon_ids: [], artifact_hash: hash, timestamp: '2026-01-01T00:00:00Z',
  });

  it('fresh evidence satisfies; stale evidence counts as missing', () => {
    const lowUnit = { ...unit, evidence_policy: { required: ['typecheck'] } };
    const fresh = evaluatePolicy(lowUnit, [
      { ...pass('HASH-NEW'), kind: EvidenceKind.TYPECHECK },
    ], { currentArtifactHash: new Map([['iu-a', 'HASH-NEW']]) });
    expect(fresh.verdict).toBe('PASS');

    const stale = evaluatePolicy(lowUnit, [
      { ...pass('HASH-OLD'), kind: EvidenceKind.TYPECHECK },
    ], { currentArtifactHash: new Map([['iu-a', 'HASH-NEW']]) });
    expect(stale.verdict).toBe('INCOMPLETE');
    expect(stale.stale).toContain('typecheck');
  });

  it('evidence without artifact_hash is grandfathered (not treated as stale)', () => {
    const lowUnit = { ...unit, evidence_policy: { required: ['typecheck'] } };
    const result = evaluatePolicy(lowUnit, [
      { ...pass(undefined), kind: EvidenceKind.TYPECHECK },
    ], { currentArtifactHash: new Map([['iu-a', 'HASH-NEW']]) });
    expect(result.verdict).toBe('PASS');
  });
});
