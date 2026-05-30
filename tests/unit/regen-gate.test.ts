import { describe, it, expect } from 'vitest';
import { gateIU, massOfIU } from '../../src/regen-gate.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';
import type { EvaluationCoverage } from '../../src/models/evaluation.js';
import { failedGenerationKnowledge } from '../../src/models/negative-knowledge.js';
import type { NegativeKnowledge } from '../../src/models/negative-knowledge.js';

function makeIU(overrides: Partial<ImplementationUnit> = {}): ImplementationUnit {
  return {
    iu_id: 'iu-1',
    kind: 'module',
    name: 'TestModule',
    risk_tier: 'medium',
    contract: {
      description: 'Test module',
      inputs: ['a', 'b'],
      outputs: ['c'],
      invariants: ['must hold'],
    },
    source_canon_ids: ['c1', 'c2'],
    dependencies: ['iu-x'],
    boundary_policy: defaultBoundaryPolicy(),
    enforcement: defaultEnforcement(),
    evidence_policy: { required: ['unit_tests'] },
    output_files: ['test.ts'],
    ...overrides,
  };
}

function makeCoverage(overrides: Partial<EvaluationCoverage> = {}): EvaluationCoverage {
  return {
    iu_id: 'iu-1',
    iu_name: 'TestModule',
    total_evaluations: 0,
    by_binding: { domain_rule: 0, boundary_contract: 0, constraint: 0, invariant: 0, failure_mode: 0 },
    by_origin: { specified: 0, characterization: 0, incident: 0, audit: 0 },
    canon_ids_covered: [],
    canon_ids_uncovered: ['c1', 'c2'],
    coverage_ratio: 0,
    conservation_count: 0,
    gaps: [],
    ...overrides,
  };
}

describe('massOfIU', () => {
  it('sums contract concepts, deps, side channels, canon nodes, files', () => {
    const iu = makeIU();
    // contract 2+1+1 + deps 1 + side 0 + canon 2 = 7
    expect(massOfIU(iu)).toBe(7);
  });

  it('counts side channels into mass', () => {
    const bp = defaultBoundaryPolicy();
    bp.side_channels.databases = ['main'];
    bp.side_channels.caches = ['redis'];
    const iu = makeIU({ boundary_policy: bp });
    expect(massOfIU(iu)).toBe(9); // previous 7 + 2 side channels
  });
});

describe('gateIU (warn-first)', () => {
  it('accepts even with error blockers in warn mode', () => {
    const verdict = gateIU({
      iu: makeIU({ contract: { description: '', inputs: [], outputs: [], invariants: [] } }),
      allIUs: [makeIU()],
      evalCoverage: makeCoverage(),
      negativeKnowledge: [],
      mode: 'warn',
    });
    expect(verdict.accepted).toBe(true);
    expect(verdict.blockers.some(b => b.severity === 'error')).toBe(true);
  });

  it('refuses error blockers in block mode', () => {
    const verdict = gateIU({
      iu: makeIU({ contract: { description: '', inputs: [], outputs: [], invariants: [] } }),
      allIUs: [makeIU()],
      evalCoverage: makeCoverage(),
      negativeKnowledge: [],
      mode: 'block',
    });
    expect(verdict.accepted).toBe(false);
  });

  it('reports no mass delta when there is no previous cycle', () => {
    const verdict = gateIU({
      iu: makeIU(),
      allIUs: [makeIU()],
      evalCoverage: makeCoverage(),
      negativeKnowledge: [],
    });
    expect(verdict.mass_delta).toBeUndefined();
    expect(verdict.ratchet_violation).toBe(false);
  });

  it('flags a ratchet violation when mass grows across cycles', () => {
    const iu = makeIU(); // mass 7
    const verdict = gateIU({
      iu,
      allIUs: [iu],
      evalCoverage: makeCoverage(),
      negativeKnowledge: [],
      previousMass: 5,
    });
    expect(verdict.mass).toBe(7);
    expect(verdict.mass_delta).toBe(2);
    expect(verdict.ratchet_violation).toBe(true);
  });

  it('does not flag a ratchet violation when mass shrinks or holds', () => {
    const iu = makeIU(); // mass 7
    const verdict = gateIU({
      iu,
      allIUs: [iu],
      evalCoverage: makeCoverage(),
      negativeKnowledge: [],
      previousMass: 7,
    });
    expect(verdict.ratchet_violation).toBe(false);
  });
});

describe('failedGenerationKnowledge', () => {
  it('builds a deterministic id from iu + promptpack so repeats dedup', () => {
    const base = {
      iu_id: 'iu-1',
      model_id: 'anthropic/claude',
      promptpack_hash: 'abcdef1234567890',
      reason: 'typecheck failed',
      recorded_at: '2026-01-01T00:00:00.000Z',
    };
    const a = failedGenerationKnowledge(base);
    const b = failedGenerationKnowledge({ ...base, reason: 'different reason' });
    expect(a.nk_id).toBe('failgen:iu-1:abcdef12');
    expect(b.nk_id).toBe(a.nk_id); // same signature → same id → store updates in place
  });

  it('records a failed_generation kind bound to the IU', () => {
    const nk: NegativeKnowledge = failedGenerationKnowledge({
      iu_id: 'iu-auth',
      model_id: 'm',
      promptpack_hash: 'deadbeefcafe',
      reason: 'threw',
      recorded_at: '2026-01-01T00:00:00.000Z',
    });
    expect(nk.kind).toBe('failed_generation');
    expect(nk.subject_id).toBe('iu-auth');
    expect(nk.subject_type).toBe('iu');
    expect(nk.active).toBe(true);
  });
});
