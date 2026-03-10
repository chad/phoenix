import { describe, it, expect } from 'vitest';
import { auditIU, auditAll } from '../../src/audit.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import type { EvaluationCoverage } from '../../src/models/evaluation.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

function makeIU(overrides: Partial<ImplementationUnit> = {}): ImplementationUnit {
  return {
    iu_id: 'iu-1',
    kind: 'module',
    name: 'TestModule',
    risk_tier: 'medium',
    contract: {
      description: 'Test module',
      inputs: ['input1'],
      outputs: ['output1'],
      invariants: ['must be consistent'],
    },
    source_canon_ids: ['c1', 'c2'],
    dependencies: [],
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

describe('Replacement Audit', () => {
  it('marks IU with no evaluations and weak boundaries as opaque', () => {
    const iu = makeIU({
      contract: { description: '', inputs: [], outputs: [], invariants: [] },
    });
    const result = auditIU({
      iu,
      allIUs: [iu],
      evalCoverage: makeCoverage(),
      negativeKnowledge: [],
    });
    expect(result.readiness).toBe('opaque');
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it('marks well-defined IU with full evaluations as evaluable or regenerable', () => {
    const iu = makeIU();
    const cov = makeCoverage({
      total_evaluations: 5,
      by_binding: { domain_rule: 1, boundary_contract: 2, constraint: 0, invariant: 1, failure_mode: 1 },
      by_origin: { specified: 3, characterization: 1, incident: 1, audit: 0 },
      canon_ids_covered: ['c1', 'c2'],
      canon_ids_uncovered: [],
      coverage_ratio: 1.0,
      gaps: [],
    });
    const result = auditIU({
      iu,
      allIUs: [iu],
      evalCoverage: cov,
      negativeKnowledge: [],
    });
    expect(['evaluable', 'regenerable']).toContain(result.readiness);
    expect(result.score).toBeGreaterThan(50);
  });

  it('penalizes wide blast radius', () => {
    const target = makeIU({ iu_id: 'iu-core', name: 'Core' });
    const dep1 = makeIU({ iu_id: 'iu-a', name: 'A', dependencies: ['iu-core'] });
    const dep2 = makeIU({ iu_id: 'iu-b', name: 'B', dependencies: ['iu-core'] });
    const dep3 = makeIU({ iu_id: 'iu-c', name: 'C', dependencies: ['iu-core'] });
    const dep4 = makeIU({ iu_id: 'iu-d', name: 'D', dependencies: ['iu-core'] });

    const result = auditIU({
      iu: target,
      allIUs: [target, dep1, dep2, dep3, dep4],
      evalCoverage: makeCoverage({ iu_id: 'iu-core' }),
      negativeKnowledge: [],
    });
    expect(result.blast_radius.score).toBeLessThan(50);
    expect(result.blockers.some(b => b.category === 'coupling')).toBe(true);
  });

  it('flags ratchet violation when mass grows', () => {
    const iu = makeIU();
    const result = auditIU({
      iu,
      allIUs: [iu],
      evalCoverage: makeCoverage(),
      negativeKnowledge: [],
      previousMass: 2, // was 2, now it's more (inputs + outputs + invariants + canon nodes = 5)
    });
    expect(result.conceptual_mass.detail).toContain('RATCHET');
    expect(result.blockers.some(b => b.category === 'mass')).toBe(true);
  });

  it('incorporates negative knowledge in recommendations', () => {
    const iu = makeIU();
    const result = auditIU({
      iu,
      allIUs: [iu],
      evalCoverage: makeCoverage(),
      negativeKnowledge: [{
        nk_id: 'nk-1',
        kind: 'incident_constraint',
        subject_id: 'iu-1',
        subject_type: 'iu',
        what_was_tried: 'Async auth flow',
        why_it_failed: 'Race condition on token refresh',
        constraint_for_future: 'Auth must be synchronous',
        recorded_at: new Date().toISOString(),
        active: true,
      }],
    });
    expect(result.recommendations.some(r => r.includes('incident constraint'))).toBe(true);
  });

  it('audits all IUs at once', () => {
    const ius = [makeIU({ iu_id: 'a', name: 'A' }), makeIU({ iu_id: 'b', name: 'B' })];
    const results = auditAll(
      ius,
      new Map([
        ['a', makeCoverage({ iu_id: 'a' })],
        ['b', makeCoverage({ iu_id: 'b' })],
      ]),
      new Map(),
      [],
      new Map(),
    );
    expect(results).toHaveLength(2);
  });
});
