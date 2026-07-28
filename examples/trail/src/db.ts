import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH ?? 'data/app.db';

const dir = dirname(DB_PATH);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

// Wait for a contended lock instead of failing instantly. Set first so it covers the
// statements below and every later migration/write.
db.pragma('busy_timeout = 5000');

// Switching to WAL needs a brief EXCLUSIVE lock, and SQLite answers SQLITE_BUSY for a
// journal-mode change WITHOUT honouring busy_timeout. That fires whenever several
// processes open a COLD database at once — exactly what the generated test suite does,
// one worker per test file. WAL is a persistent property of the file, so it is enough for
// ONE process to win: read the mode first (a shared-lock read), and treat a lost race as
// success rather than crashing the process on import.
try {
  if (db.pragma('journal_mode', { simple: true }) !== 'wal') {
    db.pragma('journal_mode = WAL');
  }
} catch {
  // A concurrent opener is mid-switch. The file ends up in WAL either way.
}

db.pragma('foreign_keys = ON');

const migrations: Array<{ name: string; sql: string }> = [];

export function registerMigration(name: string, sql: string): void {
  migrations.push({ name, sql });
}

export function runMigrations(): void {
  for (const m of migrations) {
    db.exec(m.sql);
  }
}

export { db };
