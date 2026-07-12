/**
 * CI gate for the capability eval (Red/Green TDD at the eval layer).
 *
 * This is the enforcement side of `phoenix selftest`:
 *  - NO REGRESSIONS: a case declared green MUST pass. If a proven capability
 *    breaks, this fails the build — that is the whole point.
 *  - Reds are allowed to fail (they are the documented backlog) but are NOT
 *    silent: a promotion (a red that now passes) is surfaced loudly so someone
 *    flips it to green. We assert the promotion count is reported, not that it's
 *    zero — fixing a red should never *fail* CI, only prompt a follow-up.
 *  - Every red must carry a reason (enforced by the harness).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { runSuite } from '../../src/eval/harness.js';
import { CAPABILITY_SUITE } from '../../src/eval/suite.js';

describe('capability eval — the system\'s Red/Green trust surface', () => {
  // The suite is deterministic, and some cases now BOOT a real app (the live oracle).
  // Run it ONCE and share the scorecard across assertions — correct and far cheaper than
  // re-booting for every `it` (which also starves the concurrent e2e boots of CPU).
  let sc: Awaited<ReturnType<typeof runSuite>>;
  beforeAll(async () => { sc = await runSuite(CAPABILITY_SUITE); }, 120_000);

  it('has no regressions: every green-expected capability still passes', () => {
    const broken = sc.regressions.map(r => `${r.case.id}: ${r.detail}`);
    expect(broken, `REGRESSIONS (proven capabilities that broke):\n${broken.join('\n')}`).toEqual([]);
  });

  it('green-health is 100% (kept promises are all kept)', () => {
    expect(sc.greenHealth).toBe(1);
  });

  it('surfaces promotions loudly (reds that now pass — flip them to green)', () => {
    if (sc.promotions.length > 0) {
      // Not a failure — a nudge. Print so it's visible in CI output.
      console.log(`\n⭐ ${sc.promotions.length} PROMOTION(S) — change expect:'red'→'green' to lock these in:`);
      for (const p of sc.promotions) console.log(`   - ${p.case.id}`);
    }
    expect(Array.isArray(sc.promotions)).toBe(true);
  });

  it('every red documents its reason (the backlog explains itself)', () => {
    // runSuite throws if a red lacks a reason; reaching here means all reds are documented.
    const reds = sc.results.filter(r => r.case.expect === 'red');
    for (const r of reds) expect(r.case.redReason, `${r.case.id} missing redReason`).toBeTruthy();
    expect(reds.length).toBeGreaterThan(0); // an honest early-stage system HAS a backlog
  });

  it('scorecard totals are internally consistent', () => {
    expect(sc.green + sc.knownRed + sc.regressions.length + sc.promotions.length).toBe(sc.total);
  });
});
