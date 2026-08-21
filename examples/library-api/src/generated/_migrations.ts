// AUTO-GENERATED shared artifact: database migrations aggregated across IUs.
// Each region below is OWNED by exactly one Implementation Unit. Editing inside a
// region is drift attributed to that IU; Phoenix regenerates the whole file.
import { registerMigration } from '../db.js';

// <<phx:region iu=schema-plan role=migration key=books>>
registerMigration('books', `CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  title TEXT NOT NULL,
  author TEXT,
  isbn TEXT,
  count INTEGER NOT NULL DEFAULT 0,
  copy INTEGER NOT NULL DEFAULT 1
)`);
// <</phx:region>>

// <<phx:region iu=schema-plan role=migration key=members>>
registerMigration('members', `CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL,
  email TEXT,
  date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  fourth TEXT,
  address TEXT,
  loan_id INTEGER REFERENCES loans(id)
)`);
// <</phx:region>>

// <<phx:region iu=schema-plan role=migration key=loans>>
registerMigration('loans', `CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  book_id INTEGER REFERENCES books(id),
  member_id INTEGER REFERENCES members(id),
  loan_date TEXT NOT NULL DEFAULT (datetime('now')),
  due_date TEXT,
  returned INTEGER NOT NULL DEFAULT 0
)`);
// <</phx:region>>

// <<phx:region iu=schema-plan role=migration key=summaries>>
registerMigration('summaries', `CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  member_id INTEGER REFERENCES members(id)
)`);
// <</phx:region>>

