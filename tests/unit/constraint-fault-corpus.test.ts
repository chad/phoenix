/**
 * Fault-Injection Meta-Evaluation of the CONSTRAINT trust surface.
 *
 * Companion to status-fault-injection.test.ts. That harness proves status tells the
 * truth about STRUCTURAL faults (drift / missing / boundary / stale). This one proves
 * it about CONSTRAINT faults across the whole assertion algebra — bound, membership,
 * pattern, uniqueness, reference, cardinality, and expr/invariant.
 *
 * For each constraint we hold three code samples with KNOWN ground truth:
 *   - conforming : enforces the rule  → the checker must say `conforms`  (no false RED)
 *   - faulted    : drops/► the guard  → the checker must NOT say `conforms` (recall)
 *   - falseGreen : plausible-but-wrong → the checker must NOT say `conforms` (the sin)
 *
 * The load-bearing gate is FALSE-GREEN = 0: the checker must never certify code that
 * does not enforce the rule. Recall (faults caught) and false-red (conforming code
 * wrongly flagged) are also computed and gated. Ground truth is injected, so a false
 * green is unambiguous. Every `falseGreen` sample is a real trap the checker once
 * fell into (e.g. a stray `conditions.length > 0` reading as a balance guard).
 */

import { describe, it, expect } from 'vitest';
import { CanonicalType } from '../../src/models/canonical.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';
import { mineEntityAttributes, extractConstraints } from '../../src/constraints/extract.js';
// The corpus gates the PRODUCTION default checker. Since the AST migration (P2) that is
// checkConstraintAst — proven equivalent-or-better than the regex path by the differential
// harness, and strictly better on the comment-injection traps below.
import { checkConstraintAst as checkConstraint } from '../../src/constraints/check-ast.js';
import { checkProperty } from '../../src/evals.js';

function iu(name: string): ImplementationUnit {
  return {
    iu_id: 'iu-' + name, kind: 'module', name, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: [], dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: [`src/generated/${name}/${name}.ts`],
  };
}
function canon(type: CanonicalType, statement: string, tags: string[] = []): CanonicalNode {
  return { canon_id: 'c-' + Math.abs(hash(statement)), type, statement, source_clause_ids: ['cl'], linked_canon_ids: [], tags } as unknown as CanonicalNode;
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

interface Case {
  kind: string;
  entities: ImplementationUnit[];
  defs: CanonicalNode[];           // DEFINITION nodes to mine attributes from
  rule: CanonicalNode;             // the CONSTRAINT/INVARIANT/REQUIREMENT node
  conforming: string;              // code that enforces the rule
  faulted: string;                 // code that drops it (recall target)
  falseGreen: string;              // plausible-but-wrong code (must not read as conforms)
}

const CORPUS: Case[] = [
  {
    kind: 'bound',
    entities: [iu('habit')],
    defs: [canon(CanonicalType.DEFINITION, 'a habit has a name and a color')],
    rule: canon(CanonicalType.CONSTRAINT, 'a habit name must not exceed 80 characters', ['name']),
    conforming: `const S = z.object({ name: z.string().min(1).max(80) });`,
    faulted: `const S = z.object({ name: z.string().min(1) });`,
    falseGreen: `const S = z.object({ name: z.string().min(1).max(100) });`, // wrong value
  },
  {
    kind: 'membership',
    entities: [iu('habit')],
    defs: [canon(CanonicalType.DEFINITION, 'a habit has a name and a cadence')],
    rule: canon(CanonicalType.CONSTRAINT, 'a habit cadence must be one of daily, weekly', ['cadence']),
    conforming: `const S = z.object({ cadence: z.enum(['daily','weekly']) });`,
    faulted: `const S = z.object({ cadence: z.string() });`,
    falseGreen: `const S = z.object({ cadence: z.enum(['daily','monthly']) });`, // wrong value set
  },
  {
    kind: 'pattern',
    entities: [iu('customer')],
    defs: [canon(CanonicalType.DEFINITION, 'a customer has an email and a name')],
    rule: canon(CanonicalType.CONSTRAINT, 'a customer email must be a valid email address', ['email']),
    conforming: `const S = z.object({ email: z.string().email() });`,
    faulted: `const S = z.object({ email: z.string() });`,
    falseGreen: `const S = z.object({ name: z.string().email(), email: z.string() });`, // .email() on the WRONG field
  },
  {
    kind: 'uniqueness',
    entities: [iu('customer')],
    defs: [canon(CanonicalType.DEFINITION, 'a customer has an email and a name')],
    rule: canon(CanonicalType.CONSTRAINT, 'a customer email must be unique', ['email']),
    conforming: `CREATE TABLE customers (id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT)`,
    faulted: `CREATE TABLE customers (id INTEGER PRIMARY KEY, email TEXT, name TEXT)`,
    falseGreen: `CREATE TABLE customers (id INTEGER PRIMARY KEY UNIQUE, email TEXT, name TEXT)`, // UNIQUE on id, not email
  },
  {
    kind: 'reference',
    entities: [iu('transaction'), iu('account')],
    defs: [canon(CanonicalType.DEFINITION, 'a transaction has an account and an amount')],
    rule: canon(CanonicalType.CONSTRAINT, 'a transaction must reference an existing account', ['transaction', 'account']),
    conforming: `if (!db.prepare("SELECT id FROM accounts WHERE id = ?").get(account_id)) return c.json({error:'not found'},400);
      db.prepare("INSERT INTO transactions (account_id) VALUES (?)").run(account_id);`,
    faulted: `db.prepare("INSERT INTO transactions (account_id) VALUES (?)").run(account_id);`,
    falseGreen: `const rows = db.prepare("SELECT id FROM transactions WHERE account_id = ?").all(account_id); // reads, never verifies the account exists
      db.prepare("INSERT INTO transactions (account_id) VALUES (?)").run(account_id);`,
  },
  {
    kind: 'cardinality',
    entities: [iu('order')],
    defs: [canon(CanonicalType.DEFINITION, 'an order has a total and line items')],
    rule: canon(CanonicalType.CONSTRAINT, 'an order must have at least one line item', ['order', 'line', 'item']),
    conforming: `const S = z.object({ items: z.array(LineItem).min(1) });`,
    faulted: `const S = z.object({ items: z.array(LineItem) });`,
    falseGreen: `const MAX = 1; const S = z.object({ items: z.array(LineItem).max(1) });`, // a .max(1) is not a ≥1 floor
  },
  {
    kind: 'expr',
    entities: [iu('account')],
    defs: [canon(CanonicalType.DEFINITION, 'an account has a balance')],
    rule: canon(CanonicalType.CONSTRAINT, 'the system must reject a debit that would take an account balance below zero', ['account', 'balance']),
    conforming: `function debit(a, amount){ if (a.balance - amount < 0) throw new Error('overdraft'); a.balance -= amount; }`,
    faulted: `function debit(a, amount){ /* account balance */ a.balance -= amount; return a; }`,
    // The real trap this checker once fell into: an unrelated `> 0` reading as a balance guard.
    falseGreen: `function debit(a, amount){ const conditions = []; if (conditions.length > 0) { /* account balance */ } a.balance -= amount; }`,
  },
];

function constraintFor(tc: Case) {
  const attrs = mineEntityAttributes(tc.entities, [...tc.defs, tc.rule], []);
  const { constraints } = extractConstraints([tc.rule], attrs);
  const c = constraints.find(x => x.assertion.kind === tc.kind);
  return c;
}

describe('meta-eval: constraint fault-injection (false-green = 0 is the gate)', () => {
  const rows: { kind: string; captured: boolean; conforming: string; faulted: string; falseGreen: string }[] = [];

  for (const tc of CORPUS) {
    it(`${tc.kind}: captured, conforms on good code, caught on faulted + false-green`, () => {
      const c = constraintFor(tc);
      expect(c, `${tc.kind} constraint should be captured from "${tc.rule.statement}"`).toBeTruthy();

      const good = checkConstraint(c!, tc.conforming).result;
      const bad = checkConstraint(c!, tc.faulted).result;
      const trap = checkConstraint(c!, tc.falseGreen).result;

      rows.push({ kind: tc.kind, captured: true, conforming: good, faulted: bad, falseGreen: trap });

      // No false RED: conforming code must be certified.
      expect(good, `${tc.kind}: conforming code must read as conforms`).toBe('conforms');
      // Recall: the faulted code must NOT be certified.
      expect(bad, `${tc.kind}: faulted code must be caught (not conforms)`).not.toBe('conforms');
      // The cardinal sin: a plausible-but-wrong sample must NEVER read as conforms.
      expect(trap, `${tc.kind}: FALSE GREEN — plausible-but-wrong code certified`).not.toBe('conforms');
    });
  }

  it('the AST default catches comment-injection traps the regex path false-greened', () => {
    // Enforcement that appears only in a COMMENT is dead text — the field enforces
    // nothing. The regex checker read source as text and certified these (a false green);
    // the AST checker reads the real Zod chain and reports the enforcement absent. These
    // are the P2 "AST provably more correct" traps, locked here as regression guards.
    const boundTrap = checkConstraint(
      { constraint_id: 'x', binding: { entity: 'habit', attribute: 'name' },
        assertion: { kind: 'bound', op: '<=', value: 80, unit: 'chars' }, source: { statement: 's' } },
      `const S = z.object({ name: z.string().min(1) /* note: .max(80) enforced at the gateway */ });`,
    );
    expect(boundTrap.result, 'a .max in a comment must NOT certify the bound').not.toBe('conforms');
    const enumTrap = checkConstraint(
      { constraint_id: 'y', binding: { entity: 'habit', attribute: 'cadence' },
        assertion: { kind: 'membership', values: ['daily', 'weekly'] }, source: { statement: 's' } },
      `const S = z.object({ cadence: z.string() /* was z.enum(['daily','weekly']) */ });`,
    );
    expect(enumTrap.result, 'an enum in a comment must NOT certify membership').not.toBe('conforms');
  });

  it('the checkProperty regression: a stray `> 0` is NOT a non-negativity guard', () => {
    // The exact false-green found in the field: an unrelated length check must not
    // satisfy "balance must never go below zero".
    const stray = checkProperty(
      'the system must reject a debit that would take an account balance below zero',
      `function h(){ const conditions = []; if (conditions.length > 0) doThing(); account.balance -= amount; }`,
    );
    expect(stray.status, 'stray > 0 must not certify non-negativity').not.toBe('pass');
    // And a genuine co-located balance guard still passes.
    const real = checkProperty(
      'the system must reject a debit that would take an account balance below zero',
      `if (account.balance - amount < 0) throw new Error('overdraft');`,
    );
    expect(real.status).toBe('pass');
  });

  it('corpus recall = 100% and false-green rate = 0% (the bet holds)', () => {
    const faults = rows.length * 2; // faulted + falseGreen per kind
    const caught = rows.filter(r => r.faulted !== 'conforms').length + rows.filter(r => r.falseGreen !== 'conforms').length;
    const falseGreens = rows.filter(r => r.faulted === 'conforms').length + rows.filter(r => r.falseGreen === 'conforms').length;
    const falseReds = rows.filter(r => r.conforming !== 'conforms').length;
    const recall = faults === 0 ? 1 : caught / faults;
    // eslint-disable-next-line no-console
    console.log(`  Constraint meta-eval — kinds: ${rows.length}, recall: ${(recall * 100).toFixed(0)}%, false-green: ${falseGreens}, false-red: ${falseReds}`);
    expect(falseGreens, 'FALSE GREENS must be zero').toBe(0);
    expect(recall, 'recall must be 100%').toBe(1);
    expect(falseReds, 'false reds must be zero').toBe(0);
  });
});
