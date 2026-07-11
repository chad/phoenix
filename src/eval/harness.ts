/**
 * Capability Eval Harness — Red/Green TDD at the eval layer.
 *
 * Phoenix's own thesis ("evaluations are the real codebase") turned back on
 * Phoenix. This is a living, honest map of what the system can and cannot do:
 *
 *   - a GREEN case asserts a capability that works; it LOCKS it against regression.
 *   - a RED case asserts a capability that is known-broken; it is EXPECTED to fail
 *     and documents the gap (the backlog). A red is never deleted — it is flipped to
 *     green when the code catches up.
 *
 * The runner compares each case's actual pass/fail to its declared expectation and
 * classifies the outcome. Two transitions are the signal:
 *   - GREEN → fail  = REGRESSION (a promise broke — hard CI failure).
 *   - RED   → pass  = PROMOTION (you fixed something — flip it to green).
 *
 * This gives the project a trust surface of its own, the way `phoenix status` is a
 * trust surface for a generated app: it never claims more than is true, and the
 * red set is an honest, diffable ledger of the distance still to travel.
 */

export type Expectation = 'green' | 'red';
export type Tier = 'unit' | 'integration' | 'e2e';

export interface CapabilityCase {
  /** Stable dotted id, e.g. 'invalidation.single-line-one-subtree'. */
  id: string;
  /** Capability bucket for the scorecard, e.g. 'selective-invalidation'. */
  capability: string;
  /** One line: what this proves. */
  description: string;
  /** green = must pass (locked); red = known-broken (expected to fail). */
  expect: Expectation;
  /** Required when expect==='red': why it's broken + what would fix it. */
  redReason?: string;
  tier: Tier;
  /** The check. Returns whether the capability held, plus human detail. */
  run: () => Promise<CaseOutcome> | CaseOutcome;
}

export interface CaseOutcome {
  passed: boolean;
  detail: string;
}

export type Classification =
  | 'green'        // expected green, passed — capability holds
  | 'known-red'    // expected red, failed — tracked gap, as documented
  | 'regression'   // expected green, FAILED — a promise broke (hard fail)
  | 'promotion';   // expected red, PASSED — fixed; flip it to green

export interface CaseResult {
  case: CapabilityCase;
  passed: boolean;
  detail: string;
  classification: Classification;
  error?: string;
}

export interface Scorecard {
  results: CaseResult[];
  total: number;
  green: number;
  knownRed: number;
  regressions: CaseResult[];
  promotions: CaseResult[];
  byCapability: Record<string, { green: number; total: number; red: number }>;
  /** Fraction of *green-expected* cases that pass (the health of kept promises). */
  greenHealth: number;
  /** Fraction of all cases currently passing (green + promotions). */
  passRate: number;
  generatedAt?: string;
}

function classify(expect: Expectation, passed: boolean): Classification {
  if (expect === 'green') return passed ? 'green' : 'regression';
  return passed ? 'promotion' : 'known-red';
}

/** Run one case, trapping throws as failures (a throw is a fail, never a crash). */
export async function runCase(c: CapabilityCase): Promise<CaseResult> {
  try {
    const outcome = await c.run();
    return { case: c, passed: outcome.passed, detail: outcome.detail, classification: classify(c.expect, outcome.passed) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { case: c, passed: false, detail: `threw: ${msg}`, classification: classify(c.expect, false), error: msg };
  }
}

export async function runSuite(cases: CapabilityCase[], now?: () => string): Promise<Scorecard> {
  // Guard the invariant that reds carry a reason (the ledger must explain itself).
  for (const c of cases) {
    if (c.expect === 'red' && !c.redReason) {
      throw new Error(`RED case "${c.id}" must declare a redReason (what's broken + what fixes it)`);
    }
  }
  const results: CaseResult[] = [];
  for (const c of cases) results.push(await runCase(c));

  const byCapability: Scorecard['byCapability'] = {};
  for (const r of results) {
    const b = (byCapability[r.case.capability] ??= { green: 0, total: 0, red: 0 });
    b.total++;
    if (r.case.expect === 'red') b.red++;
    if (r.classification === 'green' || r.classification === 'promotion') b.green++;
  }

  const greenExpected = results.filter(r => r.case.expect === 'green');
  const greenHealth = greenExpected.length === 0 ? 1 : greenExpected.filter(r => r.passed).length / greenExpected.length;
  const passing = results.filter(r => r.passed).length;

  return {
    results,
    total: results.length,
    green: results.filter(r => r.classification === 'green').length,
    knownRed: results.filter(r => r.classification === 'known-red').length,
    regressions: results.filter(r => r.classification === 'regression'),
    promotions: results.filter(r => r.classification === 'promotion'),
    byCapability,
    greenHealth,
    passRate: results.length === 0 ? 1 : passing / results.length,
    generatedAt: now?.(),
  };
}
