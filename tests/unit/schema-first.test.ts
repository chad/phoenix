/**
 * Schema-first generation (P0) — prevention of the drift → runtime-500 class.
 *
 * The shared schema is derived BEFORE module generation and injected into every module
 * prompt VERBATIM. These unit tests prove (a) the prompt carries the frozen DDL and the
 * "use these exact names" instruction, (b) a repair round carries the findings verbatim,
 * and (c) the plan is derived from entities/constraints alone — independent of any
 * generated module, which is what lets it run first. (The pipeline-ordering acceptance is
 * additionally proven end-to-end in tests/e2e/schema-first.test.ts.)
 */

import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../../src/llm/prompt.js';
import { deriveSchema, planFromMigrations } from '../../src/schema-plan.js';
import { CanonicalType } from '../../src/models/canonical.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';
import type { RepairFinding } from '../../src/models/repair.js';

function iu(name: string, canonIds: string[] = []): ImplementationUnit {
  return {
    iu_id: 'iu-' + name, kind: 'module', name, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: canonIds, dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: [`src/generated/${name}/${name}.ts`],
  };
}
function canon(type: CanonicalType, statement: string, id: string, tags: string[] = []): CanonicalNode {
  return { canon_id: id, type, statement, source_clause_ids: ['cl'], linked_canon_ids: [], tags } as unknown as CanonicalNode;
}

const DDL = "CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, name TEXT, balance INTEGER)";

describe('schema-first (P0) — prompt injection', () => {
  it('injects the frozen schema DDL verbatim with the exact-names instruction', () => {
    const prompt = buildPrompt(iu('transaction', ['c1']), [canon(CanonicalType.REQUIREMENT, 'record a transaction', 'c1')], undefined, undefined, undefined, undefined, { sharedSchema: DDL });
    expect(prompt).toContain('Shared database schema (FROZEN');
    expect(prompt).toContain('CREATE TABLE IF NOT EXISTS accounts');
    expect(prompt).toMatch(/exactly these table names and column names/i);
    expect(prompt).toMatch(/do NOT emit CREATE TABLE or registerMigration/i);
  });

  it('omits the schema section entirely when no schema is provided (no empty header)', () => {
    const prompt = buildPrompt(iu('transaction', ['c1']), [canon(CanonicalType.REQUIREMENT, 'record a transaction', 'c1')]);
    expect(prompt).not.toContain('Shared database schema (FROZEN');
  });

  it('a repair round carries the findings and recommended actions VERBATIM, ahead of the schema', () => {
    const findings: RepairFinding[] = [{
      category: 'schema', iu_id: 'iu-transaction', file: 'x.ts', subject: 'account',
      message: 'Schema contract: SQL references table "account" but the schema defines "accounts"',
      action: 'Align on one name: use "accounts"',
    }];
    const prompt = buildPrompt(iu('transaction', ['c1']), [canon(CanonicalType.REQUIREMENT, 'record a transaction', 'c1')], undefined, undefined, undefined, undefined, { sharedSchema: DDL, repairFindings: findings, currentSource: 'export const x = 1;' });
    expect(prompt).toContain('Repairs required');
    expect(prompt).toContain('references table "account" but the schema defines "accounts"');
    expect(prompt).toContain('Align on one name: use "accounts"');
    expect(prompt).toContain('export const x = 1;'); // current source included for reference
    // Repairs lead the prompt; the schema follows.
    expect(prompt.indexOf('Repairs required')).toBeLessThan(prompt.indexOf('Shared database schema'));
  });
});

describe('schema-first (P0) — deterministic derivation runs from entities alone', () => {
  it('derives one table per entity IU with FK columns from reference constraints', () => {
    const nodes = [
      canon(CanonicalType.DEFINITION, 'an account has a name and an email and a balance', 'd1'),
      canon(CanonicalType.CONSTRAINT, 'a transaction must reference an existing account', 'c1', ['transaction', 'account']),
    ];
    const plan = deriveSchema([iu('account', ['d1']), iu('transaction', ['c1'])], nodes, []);
    expect(plan).not.toBeNull();
    expect(plan!.tableCount).toBeGreaterThanOrEqual(2);
    // Plural, snake_case tables; the model reconciles through parseSchema.
    expect(plan!.model.tables.has('accounts')).toBe(true);
    expect(plan!.model.tables.has('transactions')).toBe(true);
    // The reference constraint became a FK column on transactions.
    expect(plan!.model.tables.get('transactions')!.has('account_id')).toBe(true);
    // Every region is owned by the synthetic schema-plan IU (not a real module).
    expect(plan!.regions.every(r => r.iu_id === 'schema-plan')).toBe(true);
  });

  it('parses registerMigration output (the LLM plan shape) into a reconciled model', () => {
    const text = "registerMigration('ensembles', `CREATE TABLE IF NOT EXISTS ensembles (id INTEGER PRIMARY KEY, name TEXT)`);\nnoise\nregisterMigration('matches', `CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY, ensemble_id INTEGER REFERENCES ensembles(id))`);";
    const plan = planFromMigrations(text);
    expect(plan).not.toBeNull();
    expect(plan!.tableCount).toBe(2);
    expect(plan!.model.tables.has('ensembles')).toBe(true);
    expect(plan!.model.tables.get('matches')!.has('ensemble_id')).toBe(true);
  });
});
