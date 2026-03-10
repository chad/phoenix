import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EvaluationStore } from '../../src/store/evaluation-store.js';
import type { Evaluation } from '../../src/models/evaluation.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

function makeIU(overrides: Partial<ImplementationUnit> = {}): ImplementationUnit {
  return {
    iu_id: 'iu-auth',
    kind: 'module',
    name: 'AuthModule',
    risk_tier: 'high',
    contract: {
      description: 'Handles authentication',
      inputs: ['credentials'],
      outputs: ['token', 'error'],
      invariants: ['expired tokens must be rejected'],
    },
    source_canon_ids: ['canon-1', 'canon-2', 'canon-3'],
    dependencies: [],
    boundary_policy: defaultBoundaryPolicy(),
    enforcement: defaultEnforcement(),
    evidence_policy: { required: ['unit_tests'] },
    output_files: ['auth.ts'],
    ...overrides,
  };
}

function makeEval(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    eval_id: 'eval-1',
    name: 'Auth rejects expired tokens',
    iu_id: 'iu-auth',
    binding: 'boundary_contract',
    origin: 'specified',
    assertion: 'Expired tokens receive 401',
    given: 'A token that expired 1 minute ago',
    when: 'The token is presented for authentication',
    then: 'The system returns a 401 Unauthorized response',
    canon_ids: ['canon-1'],
    conservation: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('EvaluationStore', () => {
  let dir: string;
  let store: EvaluationStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'phoenix-eval-'));
    store = new EvaluationStore(dir);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('starts empty', () => {
    expect(store.getAll()).toEqual([]);
  });

  it('adds and retrieves evaluations', () => {
    const ev = makeEval();
    store.add(ev);
    expect(store.getAll()).toHaveLength(1);
    expect(store.getByIU('iu-auth')).toHaveLength(1);
    expect(store.getByIU('iu-other')).toHaveLength(0);
  });

  it('replaces on duplicate eval_id', () => {
    store.add(makeEval({ eval_id: 'eval-1', name: 'v1' }));
    store.add(makeEval({ eval_id: 'eval-1', name: 'v2' }));
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0].name).toBe('v2');
  });

  it('removes evaluations', () => {
    store.add(makeEval());
    expect(store.remove('eval-1')).toBe(true);
    expect(store.getAll()).toHaveLength(0);
    expect(store.remove('nonexistent')).toBe(false);
  });

  it('filters conservation evaluations', () => {
    store.add(makeEval({ eval_id: 'e1', conservation: true }));
    store.add(makeEval({ eval_id: 'e2', conservation: false }));
    expect(store.getConservation()).toHaveLength(1);
  });

  it('computes coverage for an IU', () => {
    const iu = makeIU();
    store.add(makeEval({ eval_id: 'e1', binding: 'boundary_contract', canon_ids: ['canon-1'] }));
    store.add(makeEval({ eval_id: 'e2', binding: 'failure_mode', canon_ids: ['canon-2'] }));

    const cov = store.coverage(iu);
    expect(cov.total_evaluations).toBe(2);
    expect(cov.canon_ids_covered).toContain('canon-1');
    expect(cov.canon_ids_covered).toContain('canon-2');
    expect(cov.canon_ids_uncovered).toEqual(['canon-3']);
    expect(cov.coverage_ratio).toBeCloseTo(2 / 3);
    expect(cov.by_binding.boundary_contract).toBe(1);
    expect(cov.by_binding.failure_mode).toBe(1);
  });

  it('identifies coverage gaps', () => {
    const iu = makeIU();
    // No evaluations at all
    const cov = store.coverage(iu);
    expect(cov.gaps.length).toBeGreaterThan(0);
    const categories = cov.gaps.map(g => g.category);
    expect(categories).toContain('missing_boundary');
    expect(categories).toContain('missing_failure_mode');
    expect(categories).toContain('missing_invariant');
  });
});
