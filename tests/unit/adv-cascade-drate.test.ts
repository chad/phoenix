import { describe, it, expect } from 'vitest';
import { computeCascade } from '../../src/cascade.js';
import { DRateTracker } from '../../src/d-rate.js';
import { ChangeClass } from '../../src/models/classification.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

function iu(id: string, deps: string[]): ImplementationUnit {
  return {
    iu_id: id, kind: 'module', name: id, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: [], dependencies: deps,
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: [],
  };
}

describe('adversarial: cascade', () => {
  it('#5 a failure propagates TRANSITIVELY (X fails → Y and Z re-validate)', () => {
    const ius = [iu('X', []), iu('Y', ['X']), iu('Z', ['Y'])];
    const events = computeCascade([{ iu_id: 'X', iu_name: 'X', verdict: 'FAIL', failed: ['typecheck'] } as never], ius);
    const affected = events[0].affected_iu_ids;
    expect(affected).toContain('Y');
    expect(affected).toContain('Z');
  });

  it('#21 duplicate dependency entries do not duplicate dependents', () => {
    const ius = [iu('X', []), iu('Y', ['X', 'X'])];
    const events = computeCascade([{ iu_id: 'X', iu_name: 'X', verdict: 'FAIL', failed: ['typecheck'] } as never], ius);
    expect(events[0].affected_iu_ids).toEqual(['Y']);
  });
});

describe('adversarial: d-rate', () => {
  it('#6 a non-positive windowSize is rejected (does not silently mask the rate)', () => {
    expect(() => new DRateTracker(0)).toThrow();
    expect(() => new DRateTracker(-5)).toThrow();
    // a valid window records correctly
    const t = new DRateTracker(10);
    t.record([{ change_class: ChangeClass.D } as never, { change_class: ChangeClass.A } as never]);
    expect(t.getStatus().total_count).toBe(2);
  });
});
