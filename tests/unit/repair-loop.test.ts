/**
 * Repair loop mechanics (P1) — proven WITHOUT an LLM via an injected, scripted repairer
 * over fault-injected projects. This is the night's centerpiece: the loop's routing,
 * re-verify, stop conditions, and journaling must be trustworthy independent of the
 * model. The real-LLM path is the SAME loop with the real generator injected.
 *
 * HARD RULE under test: the verifier is frozen. The scripted repairer only rewrites the
 * generated MODULE source; `verify` (the real schema-contract checker) is never touched,
 * and a defect the repairer refuses to fix survives as an honest, bounded residual.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { runRepairLoop, routeFindings } from '../../src/repair.js';
import type { RepairTarget, Repairer } from '../../src/repair.js';
import type { RepairFinding } from '../../src/models/repair.js';
import { MIGRATIONS_TARGET } from '../../src/models/repair.js';
import { parseSchema, checkModuleSchema } from '../../src/schema-contract.js';

const MIG = 'src/generated/_migrations.ts';
const TXN = 'src/generated/txn/txn.ts';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** A fault-injected project: accounts table (plural) but the txn module queries `account`. */
function makeProject(txnSource: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'phx-repair-'));
  mkdirSync(join(dir, 'src', 'generated', 'txn'), { recursive: true });
  writeFileSync(join(dir, MIG), "registerMigration('accounts', `CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, name TEXT)`);\n", 'utf8');
  writeFileSync(join(dir, TXN), txnSource, 'utf8');
  return dir;
}

/** The real schema verifier, turned into routable findings — the FROZEN oracle. */
function verifyProject(dir: string): RepairFinding[] {
  const schema = parseSchema(readFileSync(join(dir, MIG), 'utf8'));
  const findings: RepairFinding[] = [];
  const src = existsSync(join(dir, TXN)) ? readFileSync(join(dir, TXN), 'utf8') : '';
  for (const f of checkModuleSchema(TXN, src, schema)) {
    findings.push({ category: 'schema', iu_id: 'iu-txn', file: TXN, subject: f.ref, message: f.detail, action: f.suggestion ? `use "${f.suggestion}"` : 'align with the schema' });
  }
  return findings;
}

function targetsFor(dir: string): { targets: RepairTarget[]; readSource: (t: RepairTarget) => string; writeSource: (t: RepairTarget, s: string) => void; artifactHash: (t: RepairTarget) => string } {
  const targets: RepairTarget[] = [
    { id: 'iu-txn', file: TXN, iu: { iu_id: 'iu-txn', name: 'Transaction', output_files: [TXN] } as any },
    { id: MIGRATIONS_TARGET, file: MIG },
  ];
  const readSource = (t: RepairTarget) => (existsSync(join(dir, t.file)) ? readFileSync(join(dir, t.file), 'utf8') : '');
  const writeSource = (t: RepairTarget, s: string) => writeFileSync(join(dir, t.file), s, 'utf8');
  const artifactHash = (t: RepairTarget) => sha(readSource(t));
  return { targets, readSource, writeSource, artifactHash };
}

describe('repair loop (P1) — mechanics via a scripted repairer', () => {
  it('routes a schema finding to its owning IU, not the migrations artifact', () => {
    const dir = makeProject("export function q(id){ return db.prepare('SELECT * FROM account WHERE id = ?').get(id); }");
    const findings = verifyProject(dir);
    const { targets } = targetsFor(dir);
    const { byTarget, unroutable } = routeFindings(findings, targets);
    expect(findings.length).toBeGreaterThan(0);
    expect(byTarget.has('iu-txn')).toBe(true);
    expect(byTarget.has(MIGRATIONS_TARGET)).toBe(false);
    expect(unroutable.length).toBe(0);
  });

  it('a scripted repairer fixes the fault; loop reaches green in one round and journals it', async () => {
    const dir = makeProject("export function q(id){ return db.prepare('SELECT * FROM account WHERE id = ?').get(id); }");
    const { targets, readSource, writeSource, artifactHash } = targetsFor(dir);

    // Scripted repairer: apply the finding's suggested table name. It NEVER touches the
    // verifier — it edits module source only, exactly as the LLM path would.
    const scripted: Repairer = (_t, findings, source) => {
      let out = source;
      for (const f of findings) {
        const m = f.action.match(/use "([a-z_]+)"/);
        if (m) out = out.replace(/\baccount\b/g, m[1]);
      }
      return out;
    };

    const rounds: number[] = [];
    const result = await runRepairLoop({
      targets, readSource, writeSource, artifactHash,
      verify: () => verifyProject(dir),
      repairer: scripted,
      onRound: (r) => rounds.push(r.round),
    });

    expect(result.green).toBe(true);
    expect(result.stop).toBe('green');
    expect(result.rounds.length).toBe(1);
    expect(result.rounds[0].findingsBefore).toBeGreaterThan(0);
    expect(result.rounds[0].findingsAfter).toBe(0);
    expect(result.rounds[0].regenerated).toContain('iu-txn');
    // Provenance: the artifact hash actually changed (before ≠ after).
    const change = result.rounds[0].changes.find(c => c.id === 'iu-txn')!;
    expect(change.before).not.toBe(change.after);
    expect(rounds).toEqual([1]);
    // The verifier now passes on disk — the fix is real.
    expect(verifyProject(dir).length).toBe(0);
  });

  it('a repairer that cannot fix the defect terminates honestly (stalled, bounded, residual preserved)', async () => {
    const dir = makeProject("export function q(id){ return db.prepare('SELECT * FROM account WHERE id = ?').get(id); }");
    const { targets, readSource, writeSource, artifactHash } = targetsFor(dir);
    const before = verifyProject(dir).length;

    // A no-op repairer: returns the source unchanged (the model "genuinely couldn't").
    const noop: Repairer = (_t, _f, source) => source;
    const result = await runRepairLoop({
      targets, readSource, writeSource, artifactHash, maxRounds: 3,
      verify: () => verifyProject(dir),
      repairer: noop,
    });

    expect(result.green).toBe(false);
    expect(result.stop).toBe('stalled');       // no artifact changed and findings didn't drop
    expect(result.rounds.length).toBe(1);        // stalls immediately — does NOT burn the budget
    expect(result.residual.length).toBe(before); // the honest residual, unchanged
  });

  it('respects the round budget when a repairer makes partial-but-incomplete progress', async () => {
    // Two independent faults; the repairer only ever fixes ONE per round, so it needs
    // exactly two rounds — but we cap at 1 to prove the budget is honored.
    const dir = makeProject("export function q(id){ db.prepare('SELECT * FROM account').all(); db.prepare('DELETE FROM adventurer WHERE id=?').run(id); }");
    // Add an `adventurers` table so the second `adventurer` ref is also a near-miss fault.
    writeFileSync(join(dir, MIG), "registerMigration('accounts', `CREATE TABLE accounts (id INTEGER PRIMARY KEY)`);\nregisterMigration('adventurers', `CREATE TABLE adventurers (id INTEGER PRIMARY KEY)`);\n", 'utf8');
    const { targets, readSource, writeSource, artifactHash } = targetsFor(dir);
    expect(verifyProject(dir).length).toBe(2);

    let calls = 0;
    const oneAtATime: Repairer = (_t, findings, source) => {
      calls++;
      const f = findings[0];
      const m = f.action.match(/use "([a-z_]+)"/);
      if (!m) return source;
      const singular = m[1].replace(/s$/, '');
      return source.replace(new RegExp(`\\b${singular}\\b`, 'g'), m[1]);
    };
    const result = await runRepairLoop({
      targets, readSource, writeSource, artifactHash, maxRounds: 1,
      verify: () => verifyProject(dir),
      repairer: oneAtATime,
    });
    expect(result.stop).toBe('budget');
    expect(result.rounds.length).toBe(1);
    expect(result.green).toBe(false);
    expect(result.residual.length).toBe(1); // one fault fixed, one honestly remains
    expect(calls).toBe(1);
  });

  it('findings with no owning target are surfaced as unroutable, never silently dropped', () => {
    const orphan: RepairFinding[] = [{ category: 'constraint', subject: 'balance', message: 'unbound', action: 'fix the spec' }];
    const targets: RepairTarget[] = [{ id: 'iu-x', file: 'a.ts' }];
    const { byTarget, unroutable } = routeFindings(orphan, targets);
    expect(byTarget.size).toBe(0);
    expect(unroutable.length).toBe(1);
  });
});
