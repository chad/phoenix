/**
 * E2E: spec-aware seeding turns the live oracle's abstention into REAL gated verdicts.
 *
 * The centerpiece of NIGHT-GOAL-5's P0: a genuine MULTI-ENTITY app with a foreign key
 * (`transactions.account_id → accounts.id`) — the exact shape the harness abstained on in
 * NIGHT-REPORT-4 (a create route needing a real parent + a multi-field body). With the
 * deterministic seeder we:
 *
 *   1. multi-entity golden → the aggregate (Σ amount) and temporal (no future date) evals
 *      SEED a parent account, thread its id into the child, and earn behavioral-gated
 *      conforms through the mutation gate — a real mutant-kill on a real FK app.
 *   2. guard-stripped variant → the live eval FAILS (the planted bug is caught by real
 *      execution against the seeded multi-entity app), never certified.
 *   3. unseedable variant (cyclic FK) → honest indeterminate (never a false green).
 *
 * No stub execution: every scenario boots a real child process and drives real HTTP.
 * Hermetic (Node built-ins), so it runs with no npm install.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runGatedLiveEval, referenceFkApp, referenceFkSchema, referenceFkPlans,
  type AppHandle, type PrepareResult,
} from '../../src/live-harness.js';
import { parseTableSchemas, seedForTarget, type SeedPlanInput } from '../../src/live-seed.js';

function project(appSource: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'phx-live-seed-'));
  writeFileSync(join(dir, 'app.mjs'), appSource, 'utf8');
  return dir;
}

/** Build the seeder input for the FK fixture: DDL → table schemas + a route map. */
function fkSeedInput(): SeedPlanInput {
  const tables = parseTableSchemas(referenceFkSchema());
  const routeFor = (table: string): string | null =>
    table === 'accounts' ? '/account' : table === 'transactions' ? '/transaction' : null;
  return { tables, constraints: [], routeFor };
}

/** A `prepare` closure that seeds the FK parent(s) for a target and skips the governed field. */
function prepareFor(targetTable: string, governedField: string) {
  const input = fkSeedInput();
  return async (app: AppHandle): Promise<PrepareResult> => {
    const r = await seedForTarget(app, input, targetTable, governedField);
    return r.ok ? { ok: true, seed: r.seed } : { ok: false, reason: r.reason };
  };
}

describe('e2e: spec-aware seeding (multi-entity FK → real gated verdicts)', () => {
  it('multi-entity golden: each FK-gated eval earns behavioral-gated conforms', async () => {
    const dir = project(referenceFkApp());
    for (const { label, plan, targetTable, governedField } of referenceFkPlans()) {
      const r = await runGatedLiveEval({
        bootSpec: { projectRoot: dir, command: ['node', 'app.mjs'], readyTimeoutMs: 12_000 },
        plan, targetFile: 'app.mjs', prepare: prepareFor(targetTable, governedField),
      });
      expect(r.status, `${label}: ${r.reason}`).toBe('pass');
      expect(r.gated, `${label} must be mutation-gated: ${r.reason}`).toBe(true);
      expect(r.method).toBe('behavioral-gated');
      expect(r.mutantsApplicable).toBeGreaterThan(0);
      expect(r.mutantsKilled).toBe(r.mutantsApplicable);
    }
  }, 120_000);

  it('without the seeder the same eval ABSTAINS (proving seeding is what closes the gap)', async () => {
    // No prepare → the naive body can't satisfy the FK/multi-field create contract, so the
    // control write is rejected and the harness abstains (the NIGHT-REPORT-4 behavior).
    const dir = project(referenceFkApp());
    const { plan, targetFile } = { plan: referenceFkPlans()[1].plan, targetFile: 'app.mjs' };
    const r = await runGatedLiveEval({
      bootSpec: { projectRoot: dir, command: ['node', 'app.mjs'], readyTimeoutMs: 12_000 },
      plan, targetFile,
    });
    expect(r.status).toBe('indeterminate');
    expect(r.gated).toBe(false);
  }, 60_000);

  it('guard-stripped multi-entity app: the temporal eval FAILS (mutant killed live)', async () => {
    // Delete the future-date guard — the seeded child write of a future date is now accepted.
    const broken = referenceFkApp().replace(/if \(date && date > todayStr\(\)\).*\n/, '');
    const dir = project(broken);
    const { plan, targetTable, governedField } = referenceFkPlans()[1];
    const r = await runGatedLiveEval({
      bootSpec: { projectRoot: dir, command: ['node', 'app.mjs'], readyTimeoutMs: 12_000 },
      plan, targetFile: 'app.mjs', prepare: prepareFor(targetTable, governedField),
    });
    expect(r.status, r.reason).toBe('fail');
    expect(r.gated).toBe(false);
  }, 60_000);

  it('unseedable variant (cyclic FK): honest indeterminate, never a false green', async () => {
    // A schema with a cycle a→b→a: neither table can be seeded parent-first, so the seeder
    // abstains and the harness reports indeterminate rather than driving an invalid body.
    const dir = project(referenceFkApp());
    const cyclicDdl = [
      'CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, txn_id INTEGER NOT NULL REFERENCES transactions(id))',
      'CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL REFERENCES accounts(id), amount INTEGER NOT NULL, date TEXT NOT NULL)',
    ].join('\n');
    const input: SeedPlanInput = {
      tables: parseTableSchemas(cyclicDdl), constraints: [],
      routeFor: (t) => t === 'accounts' ? '/account' : t === 'transactions' ? '/transaction' : null,
    };
    const prepare = async (app: AppHandle): Promise<PrepareResult> => {
      const r = await seedForTarget(app, input, 'transactions', 'date');
      return r.ok ? { ok: true, seed: r.seed } : { ok: false, reason: r.reason };
    };
    const r = await runGatedLiveEval({
      bootSpec: { projectRoot: dir, command: ['node', 'app.mjs'], readyTimeoutMs: 12_000 },
      plan: referenceFkPlans()[1].plan, targetFile: 'app.mjs', prepare,
    });
    expect(r.status).toBe('indeterminate');
    expect(r.gated).toBe(false);
    expect(r.reason).toMatch(/could not seed prerequisites/i);
  }, 60_000);
});
