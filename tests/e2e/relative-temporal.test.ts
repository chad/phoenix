/**
 * E2E: the relative-temporal invariant, proven by advancing a clock in the live harness.
 *
 * "An account is archived 90 days after its last transaction" governs a state that flips at
 * an ELAPSED-TIME boundary — unprovable statically (checkConstraint abstains). The harness
 * sets a `NOW` env the app honors, seeds an aged record and a recent one, boots with NOW
 * past the boundary, and asserts the transition fired ONLY for the aged record — then
 * mutation-kills a boundary-stripped variant. behavioral-gated, real execution, hermetic.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runGatedRelativeTemporal, referenceClockApp,
  type AppHandle, type RelativeTemporalSeed, type RelativeTemporalPlan,
} from '../../src/live-harness.js';

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'phx-clock-'));
  writeFileSync(join(dir, 'app.mjs'), referenceClockApp(), 'utf8');
  return dir;
}

const PLAN: RelativeTemporalPlan = {
  seedRoute: '/transaction', dateField: 'date', readRoutePrefix: '/account/', stateField: 'archived', offsetDays: 90,
};

/** Seed an aged account (txn 2020-01-01) and a recent one (txn 2020-04-25); NOW=2020-05-01. */
async function seedAgedAndRecent(app: AppHandle): Promise<RelativeTemporalSeed | null> {
  const mkAccount = async (): Promise<number | null> => {
    const r = await app.fetch('/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"a"}' });
    if (r.status !== 201) return null;
    return (await r.json() as { id: number }).id;
  };
  const mkTxn = async (accountId: number, date: string): Promise<boolean> => {
    const r = await app.fetch('/transaction', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: accountId, date }) });
    return r.status === 201;
  };
  const agedId = await mkAccount();
  const recentId = await mkAccount();
  if (agedId == null || recentId == null) return null;
  if (!(await mkTxn(agedId, '2020-01-01'))) return null;
  if (!(await mkTxn(recentId, '2020-04-25'))) return null;
  return { agedId, recentId };
}

describe('e2e: relative-temporal invariant (injectable clock, mutation-gated)', () => {
  it('proves "archived 90 days after last transaction" by advancing NOW past the boundary', async () => {
    const dir = project();
    const r = await runGatedRelativeTemporal({
      bootSpec: { projectRoot: dir, command: ['node', 'app.mjs'], readyTimeoutMs: 12_000 },
      plan: PLAN, targetFile: 'app.mjs', now: '2020-05-01', seed: seedAgedAndRecent,
    });
    expect(r.status, r.reason).toBe('pass');
    expect(r.gated).toBe(true);
    expect(r.method).toBe('behavioral-gated');
    expect(r.mutantsApplicable).toBeGreaterThan(0);
    expect(r.mutantsKilled).toBe(r.mutantsApplicable);
  }, 60_000);

  it('a boundary-broken app FAILS the eval (the aged record never archives)', async () => {
    // Push the 90-day boundary out of reach — the aged account can never archive.
    const broken = referenceClockApp().replace(/elapsedDays >= 90/, 'elapsedDays >= 100000000');
    const dir = mkdtempSync(join(tmpdir(), 'phx-clock-b-'));
    writeFileSync(join(dir, 'app.mjs'), broken, 'utf8');
    const r = await runGatedRelativeTemporal({
      bootSpec: { projectRoot: dir, command: ['node', 'app.mjs'], readyTimeoutMs: 12_000 },
      plan: PLAN, targetFile: 'app.mjs', now: '2020-05-01', seed: seedAgedAndRecent,
    });
    expect(r.status).toBe('fail');
    expect(r.gated).toBe(false);
  }, 60_000);
});
