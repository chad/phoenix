/**
 * Repair-convergence chaos suite (P3) — the loop's false-green = 0 gate.
 *
 * The repair loop consumes verifier findings and rewrites generated code. Yesterday's stall
 * (afterimage oscillating 5→3→…→2) taught the invariants this suite now LOCKS across many
 * fault-injected projects × scripted repairers:
 *
 *   1. TERMINATES — always returns within the round budget, never loops forever.
 *   2. NEVER INCREASES the finding count round over round (a worsening round is rolled back).
 *   3. SUSPENDS on unsatisfiable / conflicting / unroutable findings rather than thrashing.
 *   4. NEVER MUTATES THE VERIFIER — the frozen oracle gives the identical verdict before and
 *      after the loop; repair only ever changes generated module source.
 *
 * All scripted (no LLM): the real path is the same loop with the real generator injected.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { runRepairLoop, type RepairTarget, type Repairer } from '../../src/repair.js';
import type { RepairFinding } from '../../src/models/repair.js';
import { MIGRATIONS_TARGET } from '../../src/models/repair.js';
import { parseSchema, checkModuleSchema } from '../../src/schema-contract.js';

const MIG = 'src/generated/_migrations.ts';
const MOD = 'src/generated/mod/mod.ts';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function makeProject(ddl: string, modSource: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'phx-converge-'));
  mkdirSync(join(dir, 'src', 'generated', 'mod'), { recursive: true });
  writeFileSync(join(dir, MIG), ddl, 'utf8');
  writeFileSync(join(dir, MOD), modSource, 'utf8');
  return dir;
}

/** The FROZEN schema verifier as routable findings. Its behavior is the invariant we guard. */
function verifyProject(dir: string): RepairFinding[] {
  const schema = parseSchema(readFileSync(join(dir, MIG), 'utf8'));
  const src = existsSync(join(dir, MOD)) ? readFileSync(join(dir, MOD), 'utf8') : '';
  return checkModuleSchema(MOD, src, schema).map(f => ({
    category: 'schema', iu_id: 'iu-mod', file: MOD, subject: f.ref, message: f.detail,
    action: f.suggestion ? `use "${f.suggestion}"` : 'align with the schema',
  }));
}

function ctxFor(dir: string) {
  const targets: RepairTarget[] = [
    { id: 'iu-mod', file: MOD, iu: { iu_id: 'iu-mod', name: 'Mod', output_files: [MOD] } as never },
    { id: MIGRATIONS_TARGET, file: MIG },
  ];
  return {
    targets,
    verify: () => verifyProject(dir),
    readSource: (t: RepairTarget) => (existsSync(join(dir, t.file)) ? readFileSync(join(dir, t.file), 'utf8') : ''),
    writeSource: (t: RepairTarget, s: string) => writeFileSync(join(dir, t.file), s, 'utf8'),
    artifactHash: (t: RepairTarget) => sha(existsSync(join(dir, t.file)) ? readFileSync(join(dir, t.file), 'utf8') : ''),
  };
}

/** Apply each finding's suggested name (the well-behaved repairer). */
const suggestionRepairer: Repairer = (_t, findings, source) => {
  let out = source;
  for (const f of findings) {
    const m = f.action.match(/use "([a-z_]+)"/);
    if (m) out = out.replace(new RegExp(`\\b${m[1].replace(/s$/, '')}\\b`, 'g'), m[1]);
  }
  return out;
};

const TWO_TABLE = "registerMigration('accounts', `CREATE TABLE accounts (id INTEGER PRIMARY KEY)`);\nregisterMigration('entries', `CREATE TABLE entries (id INTEGER PRIMARY KEY)`);\n";

describe('e2e: repair-convergence chaos suite (false-green = 0)', () => {
  it('convergent project: reaches green, terminates, and never increased the count', async () => {
    const dir = makeProject(TWO_TABLE, "q(){ db.prepare('SELECT * FROM account').all(); db.prepare('SELECT * FROM entrie').all(); }");
    const result = await runRepairLoop({ ...ctxFor(dir), repairer: suggestionRepairer, maxRounds: 5 });
    expect(result.green).toBe(true);
    expect(result.stop).toBe('green');
    // Monotonic non-increase across every round.
    for (const r of result.rounds) expect(r.findingsAfter).toBeLessThanOrEqual(r.findingsBefore);
    expect(verifyProject(dir).length).toBe(0);
  });

  it('unfixable project: SUSPENDS (stalled), bounded, residual preserved (no infinite loop)', async () => {
    const dir = makeProject(TWO_TABLE, "q(){ db.prepare('SELECT * FROM account').all(); }");
    const before = verifyProject(dir).length;
    const noop: Repairer = (_t, _f, s) => s;
    const result = await runRepairLoop({ ...ctxFor(dir), repairer: noop, maxRounds: 5 });
    expect(result.green).toBe(false);
    expect(result.stop).toBe('stalled');
    expect(result.rounds.length).toBe(1);              // does not burn the budget
    expect(result.residual.length).toBe(before);
  });

  it('OSCILLATING repairer (fixes one, breaks the other): terminates and NEVER increases', async () => {
    // The repairer "fixes" the flagged table but rewrites the other correct ref into a
    // near-miss — the afterimage oscillation. The loop must roll back the worsening round
    // and stop, never growing the finding count, never looping forever.
    const dir = makeProject(TWO_TABLE, "q(){ db.prepare('SELECT * FROM account').all(); db.prepare('SELECT * FROM entries').all(); }");
    const oscillate: Repairer = (_t, findings, source) => {
      let out = source;
      for (const f of findings) { const m = f.action.match(/use "([a-z_]+)"/); if (m) out = out.replace(new RegExp(`\\b${m[1].replace(/s$/, '')}\\b`, 'g'), m[1]); }
      // Sabotage a currently-correct reference to surface a NEW finding next round.
      return out.replace(/\bentries\b/, 'entrie');
    };
    const result = await runRepairLoop({ ...ctxFor(dir), repairer: oscillate, maxRounds: 5 });
    // Terminated within budget and never let the count grow.
    expect(result.rounds.length).toBeLessThanOrEqual(5);
    for (const r of result.rounds) expect(r.findingsAfter).toBeLessThanOrEqual(r.findingsBefore);
    expect(['stalled', 'green', 'budget']).toContain(result.stop);
    // The on-disk verdict never worsened beyond where it started.
    expect(verifyProject(dir).length).toBeLessThanOrEqual(1);
  });

  it('unroutable findings (no owning target): SUSPENDS as unroutable, never silently drops', async () => {
    const dir = makeProject(TWO_TABLE, "q(){ db.prepare('SELECT * FROM account').all(); }");
    const ctx = ctxFor(dir);
    // A verify that returns a finding routing to a target that does not exist.
    const result = await runRepairLoop({
      ...ctx,
      verify: () => [{ category: 'constraint', subject: 'room.tension', message: 'unbound', action: 'fix the spec', iu_id: 'iu-ghost' }],
      repairer: suggestionRepairer, maxRounds: 5,
    });
    expect(result.stop).toBe('unroutable');
    expect(result.residual.length).toBe(1);            // surfaced, not dropped
  });

  it('the VERIFIER stays frozen: identical verdict on a canary before and after the loop', async () => {
    const dir = makeProject(TWO_TABLE, "q(){ db.prepare('SELECT * FROM account').all(); }");
    // A fixed canary input the loop must never be able to change the verdict of.
    const schema = parseSchema(readFileSync(join(dir, MIG), 'utf8'));
    const canary = "db.prepare('SELECT * FROM account').all();";
    const before = checkModuleSchema('canary.ts', canary, schema).length;
    await runRepairLoop({ ...ctxFor(dir), repairer: suggestionRepairer, maxRounds: 5 });
    const after = checkModuleSchema('canary.ts', canary, parseSchema(readFileSync(join(dir, MIG), 'utf8'))).length;
    expect(after).toBe(before);                        // the checker's behavior is unchanged
    expect(before).toBeGreaterThan(0);
  });

  it('property: across 24 randomized fault projects the loop always terminates and never increases', async () => {
    let s = 0xC0FFEE;
    const rand = (n: number) => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s % n; };
    const tables = ['accounts', 'entries', 'players', 'decks'];
    let terminated = 0, everIncreased = 0;
    for (let i = 0; i < 24; i++) {
      const ddl = tables.map(t => `registerMigration('${t}', \`CREATE TABLE ${t} (id INTEGER PRIMARY KEY)\`);`).join('\n');
      // A module with a random mix of correct and near-miss (singular) references.
      const refs = Array.from({ length: 1 + rand(4) }, () => {
        const t = tables[rand(tables.length)];
        const broken = rand(2) === 0;
        return `db.prepare('SELECT * FROM ${broken ? t.replace(/s$/, '') : t}').all();`;
      }).join(' ');
      const dir = makeProject(ddl, `q(){ ${refs} }`);
      // A random repairer: sometimes fixes, sometimes no-ops, sometimes oscillates.
      const mode = rand(3);
      const repairer: Repairer = (_t, findings, src) => {
        if (mode === 1) return src; // no-op
        let out = src;
        for (const f of findings) { const m = f.action.match(/use "([a-z_]+)"/); if (m) out = out.replace(new RegExp(`\\b${m[1].replace(/s$/, '')}\\b`, 'g'), m[1]); }
        if (mode === 2) out = out.replace(/\baccounts\b/, 'account'); // sabotage
        return out;
      };
      const result = await runRepairLoop({ ...ctxFor(dir), repairer, maxRounds: 4 });
      if (result.rounds.length <= 4) terminated++;
      if (result.rounds.some(r => r.findingsAfter > r.findingsBefore)) everIncreased++;
    }
    expect(terminated).toBe(24);
    expect(everIncreased).toBe(0);
  });
});
