/**
 * Schema-contract checker — the cross-module coherence net.
 *
 * Fixtures are VERBATIM the failures observed on generated projects: hoard's
 * `adventurer` vs `adventurers` split + `entries.status` phantom column + the
 * migration's own broken FK, and ledger's `account` vs `accounts`. Each was a
 * compile-green, constraint-green app that 500'd on its first request.
 */

import { describe, it, expect } from 'vitest';
import { parseSchema, checkModuleSchema } from '../../src/schema-contract.js';

const DDL = `
db.exec(\`
  CREATE TABLE IF NOT EXISTS adventurers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(name) <= 40),
    email TEXT NOT NULL UNIQUE,
    class TEXT NOT NULL DEFAULT 'fighter',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
\`);
db.exec(\`
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adventurer_id INTEGER NOT NULL REFERENCES adventurer(id),
    amount REAL NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('loot', 'purchase')),
    cleared INTEGER NOT NULL DEFAULT 0,
    date TEXT NOT NULL,
    note TEXT
  )
\`);
`;

describe('schema-contract: parseSchema', () => {
  it('parses tables and columns through CHECK/DEFAULT parens', () => {
    const s = parseSchema(DDL);
    expect([...s.tables.keys()].sort()).toEqual(['adventurers', 'entries']);
    expect([...s.tables.get('adventurers')!].sort()).toEqual(['class', 'created_at', 'email', 'id', 'name']);
    expect(s.tables.get('entries')!.has('cleared')).toBe(true);
    // constraint keywords are not columns
    expect(s.tables.get('entries')!.has('primary')).toBe(false);
  });
});

describe('schema-contract: checkModuleSchema (the hoard bugs, verbatim)', () => {
  const schema = parseSchema(DDL);

  it('catches the singular/plural table split (runtime: no such table)', () => {
    const src = `const rows = db.prepare('SELECT id, name FROM adventurer WHERE id = ?').get(id);`;
    const f = checkModuleSchema('m.ts', src, schema);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe('unknown-table');
    expect(f[0].suggestion).toBe('adventurers');
  });

  it('catches a phantom qualified column (runtime: no such column)', () => {
    const src = `const sql = "SELECT SUM(CASE WHEN entries.type = 'loot' AND entries.status = 'cleared' THEN entries.amount ELSE 0 END) FROM entries";`;
    const f = checkModuleSchema('m.ts', src, schema);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe('unknown-column');
    expect(f[0].ref).toBe('entries.status');
  });

  it("catches the migration's own broken FK (REFERENCES a nonexistent table)", () => {
    const f = checkModuleSchema('_migrations.ts', DDL, schema);
    expect(f.some(x => x.kind === 'broken-fk' && x.ref === 'adventurer' && x.suggestion === 'adventurers')).toBe(true);
  });

  it('catches an INSERT naming an unknown column', () => {
    const src = `db.prepare('INSERT INTO entries (adventurer_id, amount, status) VALUES (?, ?, ?)').run(a, b, c);`;
    const f = checkModuleSchema('m.ts', src, schema);
    expect(f.some(x => x.kind === 'unknown-column' && x.ref === 'entries.status')).toBe(true);
  });

  it('does NOT flag JavaScript property access that merely looks qualified', () => {
    const src = `
      const entries = await res.json();
      const total = entries.map(e => e.amount).reduce((a, b) => a + b, 0);
      const label = adventurers.length > 0 ? adventurers[0].name : 'none';
    `;
    expect(checkModuleSchema('m.ts', src, schema)).toHaveLength(0);
  });

  it('does NOT flag correct SQL (no false reds on a healthy module)', () => {
    const src = `
      const rows = db.prepare('SELECT entries.amount, entries.cleared FROM entries JOIN adventurers ON entries.adventurer_id = adventurers.id WHERE entries.type = ?').all(t);
      db.prepare('INSERT INTO entries (adventurer_id, amount, type, cleared, date) VALUES (?, ?, ?, ?, ?)').run(a, b, c, d, e);
    `;
    expect(checkModuleSchema('m.ts', src, schema)).toHaveLength(0);
  });

  it('stays silent for a completely foreign identifier (not provably ours)', () => {
    const src = `const x = db.prepare('SELECT * FROM sqlite_master WHERE type = ?').all('table');`;
    expect(checkModuleSchema('m.ts', src, schema)).toHaveLength(0);
  });
});
