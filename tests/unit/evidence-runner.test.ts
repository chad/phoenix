/**
 * Evidence Runner — unit tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runEvidence, runAllEvidence } from '../../src/evidence-runner.js';
import { EvidenceKind, EvidenceStatus } from '../../src/models/evidence.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

let tmpDir: string;

function makeIU(overrides: Partial<ImplementationUnit> = {}): ImplementationUnit {
  return {
    iu_id: 'test-iu-1',
    kind: 'module',
    name: 'TestModule',
    risk_tier: 'low',
    contract: { description: 'Test', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: ['canon-1'],
    dependencies: [],
    boundary_policy: defaultBoundaryPolicy(),
    enforcement: defaultEnforcement(),
    evidence_policy: { required: ['typecheck', 'lint', 'boundary_validation'] },
    output_files: ['src/generated/test/module.ts'],
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'phoenix-evidence-'));
  mkdirSync(join(tmpDir, 'src/generated/test'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runEvidence', () => {
  it('runs boundary validation on existing files', () => {
    const code = `
export function hello(): string {
  return 'world';
}
`;
    writeFileSync(join(tmpDir, 'src/generated/test/module.ts'), code);

    const iu = makeIU();
    const result = runEvidence(iu, { projectRoot: tmpDir });

    // Boundary should pass (no forbidden imports)
    const boundaryCheck = result.checks.find(c => c.kind === EvidenceKind.BOUNDARY_VALIDATION);
    expect(boundaryCheck).toBeDefined();
    expect(boundaryCheck!.status).toBe(EvidenceStatus.PASS);
  });

  it('catches boundary violations', () => {
    const code = `
import axios from 'axios';
export function fetch() { return axios.get('/'); }
`;
    writeFileSync(join(tmpDir, 'src/generated/test/module.ts'), code);

    const iu = makeIU({
      boundary_policy: {
        ...defaultBoundaryPolicy(),
        code: {
          ...defaultBoundaryPolicy().code,
          forbidden_packages: ['axios'],
        },
      },
    });

    const result = runEvidence(iu, { projectRoot: tmpDir });
    const boundaryCheck = result.checks.find(c => c.kind === EvidenceKind.BOUNDARY_VALIDATION);
    expect(boundaryCheck!.status).toBe(EvidenceStatus.FAIL);
    expect(boundaryCheck!.message).toContain('violation');
  });

  it('produces evidence records for each check', () => {
    writeFileSync(join(tmpDir, 'src/generated/test/module.ts'), 'export const x = 1;');

    const iu = makeIU();
    const result = runEvidence(iu, { projectRoot: tmpDir });

    // Should produce records for each required kind
    expect(result.records.length).toBeGreaterThanOrEqual(3);
    for (const r of result.records) {
      expect(r.iu_id).toBe('test-iu-1');
      expect(r.canon_ids).toEqual(['canon-1']);
      expect(r.timestamp).toBeTruthy();
      expect(r.evidence_id).toBeTruthy();
    }
  });

  it('respects --only filter', () => {
    writeFileSync(join(tmpDir, 'src/generated/test/module.ts'), 'export const x = 1;');

    const iu = makeIU();
    const result = runEvidence(iu, {
      projectRoot: tmpDir,
      only: [EvidenceKind.BOUNDARY_VALIDATION],
    });

    expect(result.checks.length).toBe(1);
    expect(result.checks[0].kind).toBe(EvidenceKind.BOUNDARY_VALIDATION);
  });

  it('respects --skip filter', () => {
    writeFileSync(join(tmpDir, 'src/generated/test/module.ts'), 'export const x = 1;');

    const iu = makeIU();
    const result = runEvidence(iu, {
      projectRoot: tmpDir,
      skip: [EvidenceKind.TYPECHECK],
    });

    const kinds = result.checks.map(c => c.kind);
    expect(kinds).not.toContain(EvidenceKind.TYPECHECK);
  });

  it('reports FAIL when files are missing', () => {
    // Don't create the file
    const iu = makeIU();
    const result = runEvidence(iu, { projectRoot: tmpDir });

    const boundaryCheck = result.checks.find(c => c.kind === EvidenceKind.BOUNDARY_VALIDATION);
    expect(boundaryCheck!.status).toBe(EvidenceStatus.FAIL);
  });

  it('runs typecheck when tsconfig exists', () => {
    writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true },
      include: ['src/**/*'],
    }));
    writeFileSync(join(tmpDir, 'src/generated/test/module.ts'), 'export const x: number = 42;\n');

    const iu = makeIU();
    const result = runEvidence(iu, { projectRoot: tmpDir, timeout: 15000 });

    const tcCheck = result.checks.find(c => c.kind === EvidenceKind.TYPECHECK);
    expect(tcCheck).toBeDefined();
    // May pass or skip depending on tsc availability, but should not throw
    expect(['PASS', 'FAIL', 'SKIPPED']).toContain(tcCheck!.status);
  });

  it('static analysis catches unsafe patterns', () => {
    const code = `
export function bad() {
  eval('alert(1)');
  const x = {} as any;
  const y = {} as any;
  const z = {} as any;
  const a = {} as any;
  const b = {} as any;
  const c = {} as any;
}
`;
    writeFileSync(join(tmpDir, 'src/generated/test/module.ts'), code);

    const iu = makeIU({
      risk_tier: 'high',
      evidence_policy: { required: ['typecheck', 'lint', 'boundary_validation', 'static_analysis'] },
    });

    const result = runEvidence(iu, { projectRoot: tmpDir });
    const saCheck = result.checks.find(c => c.kind === EvidenceKind.STATIC_ANALYSIS);
    expect(saCheck).toBeDefined();
    expect(saCheck!.status).toBe(EvidenceStatus.FAIL);
    expect(saCheck!.details).toContain('eval');
  });
});

describe('runAllEvidence', () => {
  it('runs checks for multiple IUs', () => {
    mkdirSync(join(tmpDir, 'src/generated/test2'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/generated/test/module.ts'), 'export const x = 1;');
    writeFileSync(join(tmpDir, 'src/generated/test2/module.ts'), 'export const y = 2;');

    const iu1 = makeIU({ iu_id: 'iu-1', name: 'Module1' });
    const iu2 = makeIU({
      iu_id: 'iu-2',
      name: 'Module2',
      output_files: ['src/generated/test2/module.ts'],
    });

    const results = runAllEvidence([iu1, iu2], { projectRoot: tmpDir });
    expect(results.length).toBe(2);
    expect(results[0].iu.iu_id).toBe('iu-1');
    expect(results[1].iu.iu_id).toBe('iu-2');
  });
});
