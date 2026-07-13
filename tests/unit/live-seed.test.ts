/**
 * Unit: spec-aware seeding — the pure synthesis (schema parse, FK topology, value
 * inverse-of-the-algebra). The booting/gated half is proven in tests/e2e/live-seed.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  parseTableSchemas, topoSortTables, synthesizeColumnValue, synthesizeBody,
  makeSeededRng, type ColumnSchema,
} from '../../src/live-seed.js';
import type { StructuredConstraint } from '../../src/constraints/model.js';

const DDL = [
  "CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
  "CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL REFERENCES accounts(id), amount INTEGER NOT NULL, kind TEXT NOT NULL, date TEXT NOT NULL, memo TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
].join('\n');

const con = (entity: string, attribute: string, assertion: StructuredConstraint['assertion']): StructuredConstraint =>
  ({ constraint_id: `c-${entity}-${attribute}`, binding: { entity, attribute }, assertion, source: { statement: 's' } });

describe('live-seed: schema parse', () => {
  it('parses columns with type, not-null, default, pk, autoincrement, and FK target', () => {
    const [accounts, transactions] = parseTableSchemas(DDL);
    expect(accounts.name).toBe('accounts');
    const id = accounts.columns.find(c => c.name === 'id')!;
    expect(id.isPrimaryKey && id.isAutoincrement).toBe(true);
    const name = accounts.columns.find(c => c.name === 'name')!;
    expect(name.type).toBe('text');
    expect(name.notNull).toBe(true);
    const created = accounts.columns.find(c => c.name === 'created_at')!;
    expect(created.hasDefault).toBe(true);
    const fk = transactions.columns.find(c => c.name === 'account_id')!;
    expect(fk.fkTable).toBe('accounts');
    expect(fk.notNull).toBe(true);
  });

  it('recognizes a table-level FOREIGN KEY declaration', () => {
    const [t] = parseTableSchemas(
      'CREATE TABLE items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, FOREIGN KEY (order_id) REFERENCES orders(id))',
    );
    expect(t.columns.find(c => c.name === 'order_id')!.fkTable).toBe('orders');
  });
});

describe('live-seed: FK topology', () => {
  it('sorts parents before children', () => {
    const r = topoSortTables(parseTableSchemas(DDL));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.order.indexOf('accounts')).toBeLessThan(r.order.indexOf('transactions'));
  });

  it('detects a cycle (a→b→a) and names it, rather than guessing an order', () => {
    const ddl = [
      'CREATE TABLE a (id INTEGER PRIMARY KEY, b_id INTEGER REFERENCES b(id))',
      'CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(id))',
    ].join('\n');
    const r = topoSortTables(parseTableSchemas(ddl));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cycle.length).toBeGreaterThan(0);
  });

  it('ignores FKs to tables outside the given set (external / absent parent)', () => {
    const r = topoSortTables(parseTableSchemas(
      'CREATE TABLE t (id INTEGER PRIMARY KEY, ext_id INTEGER REFERENCES externals(id))',
    ));
    expect(r.ok).toBe(true);
  });
});

describe('live-seed: value synthesis is the inverse of the algebra', () => {
  const rng = makeSeededRng();
  const col = (over: Partial<ColumnSchema>): ColumnSchema =>
    ({ name: 'f', type: 'text', notNull: true, hasDefault: false, isPrimaryKey: false, isAutoincrement: false, ...over });

  it('membership → a declared member', () => {
    const v = synthesizeColumnValue(col({ name: 'kind' }), [con('t', 'kind', { kind: 'membership', values: ['credit', 'debit'] })], rng);
    expect(v).toBe('credit');
  });
  it('pattern email → a valid email; url → a url; date → a past date', () => {
    expect(synthesizeColumnValue(col({ name: 'email' }), [con('t', 'email', { kind: 'pattern', format: 'email' })], rng)).toMatch(/@/);
    expect(synthesizeColumnValue(col({ name: 'link' }), [con('t', 'link', { kind: 'pattern', format: 'url' })], rng)).toMatch(/^https:\/\//);
  });
  it('temporal not-future → a past date; bound(≤ chars) → a short string; bound(≤ numeric) → in-range', () => {
    expect(String(synthesizeColumnValue(col({ name: 'date' }), [con('t', 'date', { kind: 'temporal', mode: 'not-future' })], rng)))
      .toMatch(/^20\d\d-\d\d-\d\d$/);
    const short = synthesizeColumnValue(col({ name: 'name' }), [con('t', 'name', { kind: 'bound', op: '<=', value: 80, unit: 'chars' })], rng);
    expect(typeof short).toBe('string');
    expect((short as string).length).toBeLessThanOrEqual(80);
    const num = synthesizeColumnValue(col({ name: 'qty', type: 'integer' }), [con('t', 'qty', { kind: 'bound', op: '<=', value: 5 })], rng);
    expect(num as number).toBeLessThanOrEqual(5);
  });
  it('foreign key → the seeded parent id; unconstrained → a type-correct default', () => {
    expect(synthesizeColumnValue(col({ name: 'account_id', type: 'integer', fkTable: 'accounts' }), [], rng, 42)).toBe(42);
    expect(typeof synthesizeColumnValue(col({ name: 'amount', type: 'integer' }), [], rng)).toBe('number');
    expect(typeof synthesizeColumnValue(col({ name: 'note', type: 'text' }), [], rng)).toBe('string');
  });

  it('synthesizeBody omits server columns (id, created_at, defaulted) and the governed field', () => {
    const [, transactions] = parseTableSchemas(DDL);
    const byAttr = new Map([['kind', [con('transaction', 'kind', { kind: 'membership', values: ['credit', 'debit'] })]]]);
    const body = synthesizeBody(transactions, byAttr, makeSeededRng(), { skipField: 'amount', fkIds: { account_id: 7 } });
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('created_at');
    expect(body).not.toHaveProperty('memo');       // has DEFAULT → server owns it
    expect(body).not.toHaveProperty('amount');      // governed field, set by the driver
    expect(body.account_id).toBe(7);
    expect(body.kind).toBe('credit');
    expect(typeof body.date).toBe('string');
  });
});
