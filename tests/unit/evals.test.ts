import { describe, it, expect } from 'vitest';
import { deriveEvaluations, checkEvaluation } from '../../src/evals.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CanonicalType } from '../../src/models/canonical.js';

function canon(id: string, type: CanonicalType, statement: string): CanonicalNode {
  return { canon_id: id, type, statement, source_clause_ids: [], linked_canon_ids: [], tags: [] } as unknown as CanonicalNode;
}
function iu(canonIds: string[], outputs: string[] = []): ImplementationUnit {
  return {
    iu_id: 'iu-order', kind: 'module', name: 'order', risk_tier: 'high',
    contract: { description: '', inputs: [], outputs, invariants: [] },
    source_canon_ids: canonIds, dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: ['unit_tests', 'property_tests'] }, output_files: ['src/generated/order.ts'],
  };
}

const nodes = [
  canon('c-req', CanonicalType.REQUIREMENT, 'The system must allow users to create and cancel orders'),
  canon('c-inv', CanonicalType.INVARIANT, 'An order total must never be negative'),
  canon('c-con', CanonicalType.CONSTRAINT, 'An order must have at least one line item'),
];

describe('deriveEvaluations', () => {
  it('derives one eval per non-context node with the right binding', () => {
    const evals = deriveEvaluations(iu(['c-req', 'c-inv', 'c-con']), nodes, () => 'T');
    const byBinding = evals.map(e => e.binding).sort();
    expect(byBinding).toContain('domain_rule');   // requirement
    expect(byBinding).toContain('invariant');      // invariant
    expect(byBinding).toContain('failure_mode');   // constraint
    // Every eval binds to its canonical node and has given/when/then.
    for (const e of evals) {
      expect(e.canon_ids.length).toBeGreaterThan(0);
      expect(e.given && e.when && e.then).toBeTruthy();
      expect(e.origin).toBe('specified');
    }
  });

  it('adds a boundary_contract eval per declared contract output', () => {
    const evals = deriveEvaluations(iu(['c-req'], ['response']), nodes, () => 'T');
    expect(evals.some(e => e.binding === 'boundary_contract' && /response/.test(e.assertion))).toBe(true);
  });

  it('is deterministic — same inputs produce same eval ids', () => {
    const a = deriveEvaluations(iu(['c-inv']), nodes, () => 'T');
    const b = deriveEvaluations(iu(['c-inv']), nodes, () => 'T');
    expect(a.map(e => e.eval_id)).toEqual(b.map(e => e.eval_id));
  });
});

describe('checkEvaluation', () => {
  const canonById = new Map(nodes.map(n => [n.canon_id, n]));
  const evals = deriveEvaluations(iu(['c-req', 'c-inv', 'c-con']), nodes, () => 'T');
  const invEval = evals.find(e => e.binding === 'invariant')!;

  it('passes when the module references the constrained domain terms', () => {
    const src = 'export function createOrder(o){ if(o.total < 0) throw new Error("order total"); return o; }';
    expect(checkEvaluation(invEval, src, canonById).status).toBe('pass');
  });

  it('fails when the module dropped the domain term (regression the oracle must catch)', () => {
    const src = 'export function doThing(x){ return x + 1; }'; // no "order" / "total"
    expect(checkEvaluation(invEval, src, canonById).status).toBe('fail');
  });

  it('fails an unimplemented stub', () => {
    const src = 'export function f(){ throw new Error("stub: not implemented"); }';
    expect(checkEvaluation(invEval, src, canonById).status).toBe('fail');
  });
});
