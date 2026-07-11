/**
 * Differential migration harness — regex checkers vs AST checkers (P2 gate).
 *
 * Replacing the regex constraint checkers with AST ones is a load-bearing change to the
 * trust surface: a checker that flips a verdict silently is exactly the decay this
 * migration exists to end. So the AST path does not simply replace the regex path — it
 * is proven equivalent-or-better FIRST, by running BOTH implementations over:
 *
 *   (a) the entire constraint fault corpus — all 7 kinds × {conforming, faulted,
 *       false-green} — the same ground-truth samples the false-green gate uses;
 *   (b) every module of the real generated Ledger app against its extracted constraints
 *       (read-only), when ~/ledger is present.
 *
 * GATE: zero disagreements — EXCEPT where the AST checker is PROVABLY more correct, which
 * is recorded here as an explicit, ground-truthed exception (and mirrored by a new trap
 * in the fault corpus). A silent disagreement fails the migration.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { CanonicalType } from '../../src/models/canonical.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';
import { mineEntityAttributes, extractConstraints } from '../../src/constraints/extract.js';
import { checkConstraint } from '../../src/constraints/check.js';
import { checkConstraintAst } from '../../src/constraints/check-ast.js';
import type { StructuredConstraint } from '../../src/constraints/model.js';

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
function node(type: CanonicalType, statement: string, tags: string[] = []): CanonicalNode {
  return { canon_id: 'c-' + (seq++), type, statement, source_clause_ids: ['cl'], linked_canon_ids: [], tags } as unknown as CanonicalNode;
}

// ── (a) the fault corpus — the same ground truth as constraint-fault-corpus.test.ts ──
interface Case { kind: string; entities: ImplementationUnit[]; defs: CanonicalNode[]; rule: CanonicalNode; samples: string[]; }
const CORPUS: Case[] = [
  {
    kind: 'bound', entities: [iu('habit')],
    defs: [node(CanonicalType.DEFINITION, 'a habit has a name and a color')],
    rule: node(CanonicalType.CONSTRAINT, 'a habit name must not exceed 80 characters', ['name']),
    samples: [
      `const S = z.object({ name: z.string().min(1).max(80) });`,
      `const S = z.object({ name: z.string().min(1) });`,
      `const S = z.object({ name: z.string().min(1).max(100) });`,
    ],
  },
  {
    kind: 'membership', entities: [iu('habit')],
    defs: [node(CanonicalType.DEFINITION, 'a habit has a name and a cadence')],
    rule: node(CanonicalType.CONSTRAINT, 'a habit cadence must be one of daily, weekly', ['cadence']),
    samples: [
      `const S = z.object({ cadence: z.enum(['daily','weekly']) });`,
      `const S = z.object({ cadence: z.string() });`,
      `const S = z.object({ cadence: z.enum(['daily','monthly']) });`,
    ],
  },
  {
    kind: 'pattern', entities: [iu('customer')],
    defs: [node(CanonicalType.DEFINITION, 'a customer has an email and a name')],
    rule: node(CanonicalType.CONSTRAINT, 'a customer email must be a valid email address', ['email']),
    samples: [
      `const S = z.object({ email: z.string().email() });`,
      `const S = z.object({ email: z.string() });`,
      `const S = z.object({ name: z.string().email(), email: z.string() });`,
    ],
  },
  {
    kind: 'uniqueness', entities: [iu('customer')],
    defs: [node(CanonicalType.DEFINITION, 'a customer has an email and a name')],
    rule: node(CanonicalType.CONSTRAINT, 'a customer email must be unique', ['email']),
    samples: [
      `CREATE TABLE customers (id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT)`,
      `CREATE TABLE customers (id INTEGER PRIMARY KEY, email TEXT, name TEXT)`,
      `CREATE TABLE customers (id INTEGER PRIMARY KEY UNIQUE, email TEXT, name TEXT)`,
    ],
  },
  {
    kind: 'reference', entities: [iu('transaction'), iu('account')],
    defs: [node(CanonicalType.DEFINITION, 'a transaction has an account and an amount')],
    rule: node(CanonicalType.CONSTRAINT, 'a transaction must reference an existing account', ['transaction', 'account']),
    samples: [
      `if (!db.prepare("SELECT id FROM accounts WHERE id = ?").get(account_id)) return err(400);
        db.prepare("INSERT INTO transactions (account_id) VALUES (?)").run(account_id);`,
      `db.prepare("INSERT INTO transactions (account_id) VALUES (?)").run(account_id);`,
      `const rows = db.prepare("SELECT id FROM transactions WHERE account_id = ?").all(account_id);
        db.prepare("INSERT INTO transactions (account_id) VALUES (?)").run(account_id);`,
    ],
  },
  {
    kind: 'cardinality', entities: [iu('order')],
    defs: [node(CanonicalType.DEFINITION, 'an order has a total and line items')],
    rule: node(CanonicalType.CONSTRAINT, 'an order must have at least one line item', ['order', 'line', 'item']),
    samples: [
      `const S = z.object({ items: z.array(LineItem).min(1) });`,
      `const S = z.object({ items: z.array(LineItem) });`,
      `const MAX = 1; const S = z.object({ items: z.array(LineItem).max(1) });`,
    ],
  },
  {
    kind: 'expr', entities: [iu('account')],
    defs: [node(CanonicalType.DEFINITION, 'an account has a balance')],
    rule: node(CanonicalType.CONSTRAINT, 'the system must reject a debit that would take an account balance below zero', ['account', 'balance']),
    samples: [
      `function debit(a, amount){ if (a.balance - amount < 0) throw new Error('overdraft'); a.balance -= amount; }`,
      `function debit(a, amount){ /* account balance */ a.balance -= amount; return a; }`,
      `function debit(a, amount){ const conditions = []; if (conditions.length > 0) {} a.balance -= amount; }`,
    ],
  },
];

function constraintFor(tc: Case): StructuredConstraint {
  const attrs = mineEntityAttributes(tc.entities, [...tc.defs, tc.rule], []);
  const { constraints } = extractConstraints([tc.rule], attrs);
  const c = constraints.find(x => x.assertion.kind === tc.kind);
  if (!c) throw new Error(`corpus setup: ${tc.kind} not captured`);
  return c;
}

describe('differential: regex vs AST checkers over the fault corpus', () => {
  const disagreements: string[] = [];
  for (const tc of CORPUS) {
    it(`${tc.kind}: AST agrees with regex on all three samples`, () => {
      const c = constraintFor(tc);
      const labels = ['conforming', 'faulted', 'false-green'];
      tc.samples.forEach((sample, i) => {
        const regex = checkConstraint(c, sample).result;
        const ast = checkConstraintAst(c, sample).result;
        if (regex !== ast) disagreements.push(`${tc.kind}/${labels[i]}: regex=${regex} ast=${ast}`);
        expect(ast, `${tc.kind}/${labels[i]}: AST (${ast}) must equal regex (${regex})`).toBe(regex);
      });
    });
  }
  it('zero disagreements across the corpus', () => {
    expect(disagreements, `AST/regex disagreements:\n${disagreements.join('\n')}`).toEqual([]);
  });
});

// ── (b) the real Ledger app — every generated module against its constraints ──
const LEDGER = join(homedir(), 'ledger');

describe('differential: regex vs AST checkers over ~/ledger (read-only)', () => {
  const present = existsSync(join(LEDGER, '.phoenix', 'graphs', 'canonical.json'));
  const maybe = present ? it : it.skip;

  maybe('AST agrees with regex on every extracted Ledger constraint', () => {
    const graphDir = join(LEDGER, '.phoenix', 'graphs');
    const canonical = JSON.parse(readFileSync(join(graphDir, 'canonical.json'), 'utf8'));
    const canonNodes: CanonicalNode[] = Object.values(canonical.nodes ?? {});
    const ius: ImplementationUnit[] = JSON.parse(readFileSync(join(graphDir, 'ius.json'), 'utf8'));

    const attrs = mineEntityAttributes(ius, canonNodes, []);
    const { constraints } = extractConstraints(canonNodes, attrs);
    expect(constraints.length, 'ledger should extract constraints to differ over').toBeGreaterThan(0);

    // Source resolver: the SQL kinds read the migrations file too, so a reference/
    // uniqueness constraint gets the module + migrations concatenated (as status does
    // via per-IU sources — here we join every generated .ts so the SQL is visible).
    const iuByEntity = new Map<string, ImplementationUnit>();
    for (const u of ius) iuByEntity.set(u.name.toLowerCase().replace(/s$/, ''), u);
    const allSource = readAllGenerated(join(LEDGER, 'src', 'generated'));

    const disagreements: string[] = [];
    for (const c of constraints) {
      const u = iuByEntity.get(c.binding.entity) ?? ius.find(x => x.name.toLowerCase().includes(c.binding.entity));
      const modulePath = u ? join(LEDGER, u.output_files[0]) : '';
      const moduleSrc = modulePath && existsSync(modulePath) ? readFileSync(modulePath, 'utf8') : null;
      // For SQL-enforced kinds the module alone lacks the DDL; give both checkers the
      // same widened source so the comparison is apples-to-apples.
      const src = (c.assertion.kind === 'reference' || c.assertion.kind === 'uniqueness')
        ? (moduleSrc ?? '') + '\n' + allSource
        : moduleSrc;
      const regex = checkConstraint(c, src).result;
      const ast = checkConstraintAst(c, src).result;
      if (regex !== ast) {
        disagreements.push(`${c.binding.entity}.${c.binding.attribute} [${c.assertion.kind}]: regex=${regex} ast=${ast}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`  Ledger differential — ${constraints.length} constraints, ${disagreements.length} disagreement(s)`);
    expect(disagreements, `AST/regex disagreements on ledger:\n${disagreements.join('\n')}`).toEqual([]);
  });
});

function readAllGenerated(dir: string): string {
  if (!existsSync(dir)) return '';
  let out = '';
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out += readAllGenerated(p);
    else if (entry.name.endsWith('.ts')) out += readFileSync(p, 'utf8') + '\n';
  }
  return out;
}
