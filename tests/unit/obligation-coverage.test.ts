/**
 * The paraphrase corpus — the extractor-RECALL benchmark (P1).
 *
 * The obligation ledger (P0) guarantees a normative sentence is never SILENT: it is
 * captured as a checkable constraint or flagged unverified. This meta-eval stress-tests
 * that guarantee across natural rewordings of each of the 7 kinds — the way real specs
 * actually phrase the same rule. For EVERY phrasing the gate is:
 *
 *     captured-as-constraint (CORRECTLY)   OR   flagged-unverified      — NEVER silent.
 *
 * Two numbers are reported (the recall benchmark future work must move): how many
 * paraphrases were CAPTURED as the right constraint vs merely FLAGGED. Captured beats
 * flagged, but captured-correctly beats captured-at-all: a paraphrase captured with the
 * WRONG kind or value is a corpus FAILURE (a latent false green), gated to zero — we do
 * not chase capture by loosening parsers into false positives (the fault corpus holds
 * that line separately). SILENT is the cardinal sin and is gated to zero.
 */

import { describe, it, expect } from 'vitest';
import { CanonicalType } from '../../src/models/canonical.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';
import { mineEntityAttributes, extractConstraints } from '../../src/constraints/extract.js';
import { computeObligations } from '../../src/constraints/obligations.js';
import type { Assertion } from '../../src/constraints/model.js';

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
function def(statement: string): CanonicalNode {
  return { canon_id: 'p-' + (seq++), type: CanonicalType.DEFINITION, statement, source_clause_ids: ['cl'], linked_canon_ids: [], tags: [] } as unknown as CanonicalNode;
}
function canon(statement: string, tags: string[]): CanonicalNode {
  return { canon_id: 'p-' + (seq++), type: CanonicalType.CONSTRAINT, statement, source_clause_ids: ['cl'], linked_canon_ids: [], tags } as unknown as CanonicalNode;
}

interface KindCorpus {
  kind: string;
  entities: ImplementationUnit[];
  defs: CanonicalNode[];
  tags: string[];
  /** Correctness predicate: a captured assertion of this kind carries the right value. */
  correct: (a: Assertion) => boolean;
  phrasings: string[];
}

const sortEq = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

const CORPUS: KindCorpus[] = [
  {
    kind: 'bound',
    entities: [iu('habit')],
    defs: [def('a habit has a name and a color')],
    tags: ['name'],
    correct: a => a.kind === 'bound' && a.op === '<=' && a.value === 80,
    phrasings: [
      'a habit name must not exceed 80 characters',
      'a habit name must be at most 80 characters',
      'a habit name may be no more than 80 characters',
      'a habit name has a maximum of 80 characters',
      'a habit name can be up to 80 characters long',
      'a habit name cannot exceed 80 characters',
      'a habit name must be capped at 80 characters',
      'a habit name should not be longer than 80 characters',
      'a habit name must be limited to 80 characters',
      'a habit name longer than 80 characters is rejected',
      'a habit name of 80 characters or fewer is required',
      'a habit name must never run past 80 characters',
    ],
  },
  {
    kind: 'membership',
    entities: [iu('habit')],
    defs: [def('a habit has a name and a cadence')],
    tags: ['cadence'],
    correct: a => a.kind === 'membership' && sortEq(a.values, ['daily', 'weekly']),
    phrasings: [
      'a habit cadence must be one of daily, weekly',
      'a habit cadence must be one of: daily, weekly',
      'a habit cadence must be either daily or weekly',
      'a habit cadence is any of daily, weekly',
      'a habit cadence must be one of daily or weekly',
      'a habit cadence should be either daily or weekly',
      'a habit cadence must always be daily or weekly',
      'a habit cadence other than daily or weekly is rejected',
      'a habit cadence must be restricted to daily and weekly',
      'a habit cadence can only be daily or weekly',
      'a habit cadence outside daily and weekly must be refused',
    ],
  },
  {
    kind: 'pattern',
    entities: [iu('customer')],
    defs: [def('a customer has an email and a name')],
    tags: ['email'],
    correct: a => a.kind === 'pattern' && a.format === 'email',
    phrasings: [
      'a customer email must be a valid email address',
      'a customer email must be a valid email',
      'the customer email must match a valid email format',
      'a customer email must conform to an email address',
      'a customer email should be a well-formed email address',
      'the customer email must be a syntactically valid email',
      'a customer email that is bogus is rejected',
      'a customer email should never be a junk string',
      'a customer email cannot be malformed',
      'a customer email must always look like an email address',
    ],
  },
  {
    kind: 'uniqueness',
    entities: [iu('customer')],
    defs: [def('a customer has an email and a name')],
    tags: ['email'],
    correct: a => a.kind === 'uniqueness',
    phrasings: [
      'a customer email must be unique',
      'a customer email should be unique',
      'each customer email is unique',
      'customer emails must be uniquely identified',
      'a customer email is unique across accounts',
      'two customers cannot share an email',
      'duplicate customer emails are rejected',
      'customer emails shall not repeat',
      'the same customer email should never appear twice',
      'reject a second customer with an existing email',
    ],
  },
  {
    kind: 'reference',
    entities: [iu('transaction'), iu('account')],
    defs: [def('a transaction has an account and an amount')],
    tags: ['transaction', 'account'],
    correct: a => a.kind === 'reference' && a.target === 'account',
    phrasings: [
      'a transaction must reference an existing account',
      'a transaction must belong to an existing account',
      'a transaction refers to an existing account',
      'a transaction must point to an account',
      'reject a transaction for an account that does not exist',
      'a transaction must be tied to an existing account',
      'every transaction shall name a real account',
      'a transaction without a valid account is rejected',
      'a transaction must always attach to an account',
      'a transaction cannot exist without an account',
    ],
  },
  {
    kind: 'cardinality',
    entities: [iu('order')],
    defs: [def('an order has a total and line items')],
    tags: ['order', 'line', 'item'],
    correct: a => a.kind === 'cardinality' && a.min === 1 && a.max === undefined && a.relation === 'item',
    phrasings: [
      'an order must have at least one line item',
      'an order must contain at least 1 line item',
      'an order includes a minimum of one line item',
      'an order must hold no fewer than one line item',
      'an order must have one or more line items',
      'an order cannot be empty of line items',
      'an order without any line item is rejected',
      'an order must always include a line item',
      'every order requires at least one line item',
      'an order shall carry no fewer than one line item',
    ],
  },
  {
    kind: 'expr',
    entities: [iu('account')],
    defs: [def('an account has a balance')],
    tags: ['account', 'balance'],
    correct: a => a.kind === 'expr',
    phrasings: [
      'the system must reject a debit that would take an account balance below zero',
      'an account balance must never be negative',
      'an account balance must not go below zero',
      'a debit that would leave an account balance below zero must be rejected',
      'an account balance must always be non-negative',
      'the system must never let an account balance go negative',
      'an account balance can\'t dip under zero',
      'an account balance should not fall beneath zero',
      'if a debit is cleared then the account balance must not become negative',
      'an account balance must stay at or above zero',
    ],
  },
];

type Outcome = 'captured' | 'wrong' | 'flagged' | 'silent';

function classify(kc: KindCorpus, phrasing: string): Outcome {
  seq++; // fresh node ids
  const rule = canon(phrasing, kc.tags);
  const attrs = mineEntityAttributes(kc.entities, [...kc.defs, rule], []);
  const { constraints, defects } = extractConstraints([rule], attrs);
  const mine = constraints.filter(c => c.source.canon_id === rule.canon_id);
  if (mine.length > 0) {
    return mine.some(c => kc.correct(c.assertion)) ? 'captured' : 'wrong';
  }
  // Not captured — is it at least FLAGGED as an unverified obligation?
  const obligations = computeObligations([rule], [], constraints, defects, new Set());
  const o = obligations.find(x => x.statement === phrasing);
  return o && o.state === 'unverified' ? 'flagged' : 'silent';
}

describe('meta-eval: obligation coverage (paraphrase corpus — silent = 0 is the gate)', () => {
  const tally: Record<string, { captured: number; flagged: number; wrong: number; silent: number; total: number }> = {};

  for (const kc of CORPUS) {
    describe(`${kind_of(kc)} paraphrases`, () => {
      for (const phrasing of kc.phrasings) {
        it(`never silent: "${phrasing.slice(0, 46)}…"`, () => {
          const outcome = classify(kc, phrasing);
          const t = (tally[kc.kind] ??= { captured: 0, flagged: 0, wrong: 0, silent: 0, total: 0 });
          t.total++; t[outcome]++;
          // The cardinal sin: a normative rule the surface neither captures nor flags.
          expect(outcome, `SILENT paraphrase (neither captured nor flagged): "${phrasing}"`).not.toBe('silent');
          // Captured-correctly: a paraphrase captured with the wrong kind/value is a false green.
          expect(outcome, `WRONG capture (captured as the wrong kind/value): "${phrasing}"`).not.toBe('wrong');
        });
      }
    });
  }

  it('reports the recall split and gates silent = 0, wrong = 0 across all kinds', () => {
    let captured = 0, flagged = 0, wrong = 0, silent = 0, total = 0;
    const lines: string[] = [];
    for (const kc of CORPUS) {
      const t = tally[kc.kind];
      captured += t.captured; flagged += t.flagged; wrong += t.wrong; silent += t.silent; total += t.total;
      lines.push(`    ${kc.kind.padEnd(12)} captured ${t.captured}/${t.total}, flagged ${t.flagged}, wrong ${t.wrong}, silent ${t.silent}`);
    }
    const recall = total === 0 ? 0 : (captured / total) * 100;
    // eslint-disable-next-line no-console
    console.log(`  Obligation-coverage benchmark — ${total} paraphrases, captured ${captured} (${recall.toFixed(0)}%), flagged ${flagged}, wrong ${wrong}, silent ${silent}\n${lines.join('\n')}`);
    expect(silent, 'SILENT paraphrases must be zero (the P0 gate)').toBe(0);
    expect(wrong, 'WRONG captures must be zero (captured-correctly beats captured-at-all)').toBe(0);
    // Every paraphrase is accounted for as exactly one of captured/flagged.
    expect(captured + flagged, 'every paraphrase is captured or flagged').toBe(total);
  });
});

function kind_of(kc: KindCorpus): string { return kc.kind; }
