/**
 * The obligation ledger — no normative sentence is SILENTLY unverified (P0 gate).
 *
 * The deepest false green Phoenix could have is a system-level one: the spec makes a
 * promise ("balances can't dip below zero") that the extractor cannot parse, so it
 * produces no constraint, no diagnostic — nothing. `status` doesn't even know the
 * promise exists. This proves the accounting closes that gap: every normative sentence
 * is either TRACKED (a constraint / defect / eval) or FLAGGED unverified — never silent
 * — and, symmetrically, that a non-normative sentence raises nothing and a sentence
 * that DID produce a constraint is not spuriously flagged.
 */

import { describe, it, expect } from 'vitest';
import { CanonicalType } from '../../src/models/canonical.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';
import { mineEntityAttributes, extractConstraints } from '../../src/constraints/extract.js';
import { normativeMarker, isObligation, computeObligations } from '../../src/constraints/obligations.js';
import type { ClauseLike } from '../../src/constraints/obligations.js';

function iu(name: string): ImplementationUnit {
  return {
    iu_id: 'iu-' + name, kind: 'module', name, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: [], dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: [`src/generated/${name}/${name}.ts`],
  };
}
let seq = 0;
function canon(type: CanonicalType, statement: string, tags: string[] = []): CanonicalNode {
  return { canon_id: 'c-' + (seq++), type, statement, source_clause_ids: ['cl-' + seq], linked_canon_ids: [], tags } as unknown as CanonicalNode;
}

/** Run the whole extract → obligation-ledger path over a set of nodes (no evals). */
function ledger(entities: ImplementationUnit[], nodes: CanonicalNode[], clauses: ClauseLike[] = []) {
  const attrs = mineEntityAttributes(entities, nodes, []);
  const { constraints, defects } = extractConstraints(nodes, attrs);
  const obligations = computeObligations(nodes, clauses, constraints, defects, new Set());
  return { constraints, defects, obligations };
}

describe('obligation marker detector', () => {
  const positives = [
    ['must', 'a name must be present'],
    ['must not', 'a name must not exceed 80 characters'],
    ['never', 'a balance must never be negative'],
    ['cannot', 'a balance cannot go below zero'],
    ["can't", "an account balance can't dip under zero"],
    ['always', 'the total is always non-negative'],
    ['only', 'a kind is only checking or savings'],
    ['shall', 'the system shall reject overdrafts'],
    ['should', 'an email should be unique'],
    ['reject', 'reject a transaction for a missing account'],
    ['require', 'the system requires a name'],
    ['at least', 'provide at least one line item'],
    ['at most', 'at most three tags'],
    ['unique', 'the email must be unique'],
    ['valid', 'a valid email address'],
  ] as const;
  for (const [marker, text] of positives) {
    it(`flags "${text}" as normative (${marker})`, () => {
      expect(isObligation(text)).toBe(true);
      expect(normativeMarker(text)).toBeTruthy();
    });
  }

  const negatives = [
    'users like fast dashboards',
    'an account has a name and an email',
    'the dashboard reads accounts and transactions',
    'recording a transaction updates the balance immediately',
  ];
  for (const text of negatives) {
    it(`does NOT flag non-normative "${text}"`, () => {
      expect(isObligation(text)).toBe(false);
      expect(normativeMarker(text)).toBeNull();
    });
  }

  it('does not fire on markers embedded in larger words (validation / requirements-doc)', () => {
    expect(normativeMarker('run the validation harness')).toBeNull();
  });
});

describe('obligation ledger: never silent', () => {
  it('a sentence that DOES produce a constraint is tracked (verified), not flagged', () => {
    const defs = [canon(CanonicalType.DEFINITION, 'a habit has a name and a color')];
    const rule = canon(CanonicalType.CONSTRAINT, 'a habit name must not exceed 80 characters', ['name']);
    const { constraints, obligations } = ledger([iu('habit')], [...defs, rule]);
    expect(constraints.length).toBeGreaterThan(0);
    const o = obligations.find(x => x.statement === rule.statement);
    expect(o, 'the bounded sentence should appear in the ledger').toBeTruthy();
    expect(o!.state, 'a captured constraint means the obligation is verified').toBe('verified');
  });

  it('an UNPARSEABLE normative sentence is flagged unverified, not silent', () => {
    // "can't dip under zero" matches no constraint parser today (no "below zero" cue,
    // no numeric bound) — exactly the silent-loss case P0 exists to catch.
    const rule = canon(CanonicalType.CONSTRAINT, 'an account balance can\'t dip under zero', ['account', 'balance']);
    const { constraints, obligations } = ledger([iu('account')], [canon(CanonicalType.DEFINITION, 'an account has a balance'), rule]);
    expect(constraints.some(c => c.source.canon_id === rule.canon_id), 'must not have quietly parsed').toBe(false);
    const o = obligations.find(x => x.statement === rule.statement);
    expect(o, 'the unparseable obligation must surface').toBeTruthy();
    expect(o!.state).toBe('unverified');
  });

  it('a non-normative sentence yields NO obligation at all', () => {
    const node = canon(CanonicalType.CONTEXT, 'users like fast dashboards');
    const { obligations } = ledger([iu('dashboard')], [node]);
    expect(obligations.find(x => x.statement === node.statement)).toBeUndefined();
  });

  it('a binding defect counts as tracked (already a diagnostic, not silent)', () => {
    // "the line must not exceed 80" binds to no known entity.attribute → a defect.
    const defs = [canon(CanonicalType.DEFINITION, 'a habit has a name and a color')];
    const rule = canon(CanonicalType.CONSTRAINT, 'the line must not exceed 80 characters', ['line']);
    const { defects, obligations } = ledger([iu('habit')], [...defs, rule]);
    expect(defects.length).toBe(1);
    const o = obligations.find(x => x.statement === rule.statement);
    expect(o!.state, 'a defect is tracked coverage, not a silent loss').toBe('verified');
  });

  it('an eval-tracked node (pass/fail) is verified even with no structured constraint', () => {
    const rule = canon(CanonicalType.REQUIREMENT, 'the system must expose transactions as a programmatic interface', ['transaction']);
    const obligations = computeObligations([rule], [], [], [], new Set([rule.canon_id]));
    const o = obligations.find(x => x.statement === rule.statement);
    expect(o!.state).toBe('verified');
  });

  it('a normative clause that produced NO canonical node is caught by the recall net', () => {
    const clause: ClauseLike = { clause_id: 'orphan', normalized_text: 'a password must be at least 12 characters', source_doc_id: 'spec.md', source_line_range: [3, 3] };
    // No canon node references clause "orphan" → it was dropped before extraction.
    const obligations = computeObligations([], [clause], [], [], new Set());
    expect(obligations.length).toBe(1);
    expect(obligations[0].state).toBe('unverified');
    expect(obligations[0].doc).toBe('spec.md');
  });
});

describe('obligation ledger: no false unverified across the constraint corpus', () => {
  // Every kind's canonical rule DOES produce a constraint → must read verified.
  const cases: { entities: ImplementationUnit[]; defs: CanonicalNode[]; rule: CanonicalNode }[] = [
    { entities: [iu('habit')], defs: [canon(CanonicalType.DEFINITION, 'a habit has a name and a color')], rule: canon(CanonicalType.CONSTRAINT, 'a habit name must not exceed 80 characters', ['name']) },
    { entities: [iu('habit')], defs: [canon(CanonicalType.DEFINITION, 'a habit has a name and a cadence')], rule: canon(CanonicalType.CONSTRAINT, 'a habit cadence must be one of daily, weekly', ['cadence']) },
    { entities: [iu('customer')], defs: [canon(CanonicalType.DEFINITION, 'a customer has an email and a name')], rule: canon(CanonicalType.CONSTRAINT, 'a customer email must be a valid email address', ['email']) },
    { entities: [iu('customer')], defs: [canon(CanonicalType.DEFINITION, 'a customer has an email and a name')], rule: canon(CanonicalType.CONSTRAINT, 'a customer email must be unique', ['email']) },
    { entities: [iu('transaction'), iu('account')], defs: [canon(CanonicalType.DEFINITION, 'a transaction has an account and an amount')], rule: canon(CanonicalType.CONSTRAINT, 'a transaction must reference an existing account', ['transaction', 'account']) },
    { entities: [iu('order')], defs: [canon(CanonicalType.DEFINITION, 'an order has a total and line items')], rule: canon(CanonicalType.CONSTRAINT, 'an order must have at least one line item', ['order', 'line', 'item']) },
    { entities: [iu('account')], defs: [canon(CanonicalType.DEFINITION, 'an account has a balance')], rule: canon(CanonicalType.CONSTRAINT, 'the system must reject a debit that would take an account balance below zero', ['account', 'balance']) },
  ];
  for (const tc of cases) {
    it(`"${tc.rule.statement.slice(0, 40)}…" reads verified`, () => {
      const { obligations } = ledger(tc.entities, [...tc.defs, tc.rule]);
      const o = obligations.find(x => x.statement === tc.rule.statement);
      expect(o, 'the rule sentence is normative → must be in the ledger').toBeTruthy();
      expect(o!.state, 'a rule that extracts a constraint must NOT be flagged unverified').toBe('verified');
    });
  }
});
