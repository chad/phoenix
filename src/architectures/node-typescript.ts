/**
 * Runtime Target: node-typescript
 *
 * Compiles web-api architecture to Node.js + TypeScript.
 * Stack: Hono (HTTP) + better-sqlite3 (DB) + Zod (validation)
 */

import type { RuntimeTarget } from '../models/architecture.js';

// ─── Module template (LLM fills in marked sections) ─────────────────────────

const MODULE_TEMPLATE = `import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────
/* __MIGRATIONS__ */

// ─── Validation schemas ─────────────────────────────────────────────────────
/* __SCHEMAS__ */

// ─── Routes ─────────────────────────────────────────────────────────────────
const router = new Hono();

/* __ROUTES__ */

export default router;

/* __PHOENIX_METADATA__ */
`;

// ─── Shared files ───────────────────────────────────────────────────────────

const DB_FILE = `import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH ?? 'data/app.db';

const dir = dirname(DB_PATH);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
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
`;

const APP_FILE = `import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';

const app = new Hono();

app.use('*', logger());
app.use('*', cors());

app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

app.onError((err, c) => {
  console.error('Unhandled error:', err.message, err.stack);
  return c.json({ error: err.message }, 500);
});

export function mount(path: string, router: Hono): void {
  app.route(path, router);
}

export { app };
`;

// ─── Prompt extension ───────────────────────────────────────────────────────

const PROMPT_EXTENSION = `
## Runtime: Node.js + TypeScript (Hono + better-sqlite3 + Zod)

You are filling in sections of a module template. The imports, router, and exports are already provided.
You MUST output ONLY the content for the marked sections, in this exact format:

\`\`\`
__MIGRATIONS__
registerMigration('tablename', \`
  CREATE TABLE IF NOT EXISTS tablename (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ...columns...
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
\`);

__SCHEMAS__
const CreateSchema = z.object({ ... });
const UpdateSchema = z.object({ ... });

__ROUTES__
router.get('/', (c) => { ... });
router.post('/', async (c) => { ... });
router.get('/:id', (c) => { ... });
router.patch('/:id', async (c) => { ... });
router.delete('/:id', (c) => { ... });
\`\`\`

### Rules
- Use better-sqlite3 synchronous API: db.prepare(sql).run(), .get(), .all()
- Use parameterized queries ALWAYS — never interpolate user input into SQL
- In SQL, use single quotes for string literals: datetime('now'). NEVER double quotes.
- ALWAYS use snake_case for column names and JSON response keys
- Nullable FK fields: z.number().int().nullable().optional()
- FK validation: if (fk_id != null) { check exists } (loose equality)
- LEFT JOIN to include related resource names (e.g., project_name)
- Query parameter filtering: build WHERE clause dynamically from c.req.query()
- Return created/updated resource after mutation
- 200=read, 201=create, 204=delete, 400=validation, 404=not found

### Web interface modules
- Return c.html() with a complete HTML document
- Use fetch('/resource-name') to call sibling API modules (no /api/ prefix)
- Include ALL CSS and JavaScript inline
`;

// ─── Code examples ──────────────────────────────────────────────────────────

const CODE_EXAMPLES = `
## Example: CRUD module sections for a "notes" resource

\`\`\`
__MIGRATIONS__
registerMigration('notes', \`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    category_id INTEGER REFERENCES categories(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
\`);

__SCHEMAS__
const CreateNoteSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().optional().default(''),
  category_id: z.number().int().nullable().optional(),
});

const UpdateNoteSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().optional(),
  category_id: z.number().int().nullable().optional(),
});

__ROUTES__
router.get('/', (c) => {
  let sql = 'SELECT notes.*, categories.name as category_name FROM notes LEFT JOIN categories ON notes.category_id = categories.id';
  const conditions: string[] = [];
  const params: unknown[] = [];
  const categoryId = c.req.query('category_id');
  if (categoryId !== undefined) { conditions.push('notes.category_id = ?'); params.push(Number(categoryId)); }
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY notes.created_at DESC';
  return c.json(db.prepare(sql).all(...params));
});

router.get('/:id', (c) => {
  const note = db.prepare('SELECT notes.*, categories.name as category_name FROM notes LEFT JOIN categories ON notes.category_id = categories.id WHERE notes.id = ?').get(c.req.param('id'));
  if (!note) return c.json({ error: 'Not found' }, 404);
  return c.json(note);
});

router.post('/', async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = CreateNoteSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  const { title, body: noteBody, category_id } = result.data;
  if (category_id != null) {
    if (!db.prepare('SELECT id FROM categories WHERE id = ?').get(category_id)) return c.json({ error: 'Category not found' }, 400);
  }
  const info = db.prepare('INSERT INTO notes (title, body, category_id) VALUES (?, ?, ?)').run(title, noteBody, category_id ?? null);
  const note = db.prepare('SELECT notes.*, categories.name as category_name FROM notes LEFT JOIN categories ON notes.category_id = categories.id WHERE notes.id = ?').get(info.lastInsertRowid);
  return c.json(note, 201);
});

router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM notes WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = UpdateNoteSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  const u = result.data;
  if (u.title !== undefined) db.prepare('UPDATE notes SET title = ? WHERE id = ?').run(u.title, id);
  if (u.body !== undefined) db.prepare('UPDATE notes SET body = ? WHERE id = ?').run(u.body, id);
  if (u.category_id !== undefined) db.prepare('UPDATE notes SET category_id = ? WHERE id = ?').run(u.category_id, id);
  return c.json(db.prepare('SELECT notes.*, categories.name as category_name FROM notes LEFT JOIN categories ON notes.category_id = categories.id WHERE notes.id = ?').get(id));
});

router.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM notes WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  return c.body(null, 204);
});
\`\`\`
`;

// ─── Export ─────────────────────────────────────────────────────────────────

export const nodeTypescript: RuntimeTarget = {
  name: 'node-typescript',
  description: 'Node.js + TypeScript — Hono, better-sqlite3, Zod',
  language: 'typescript',

  packages: {
    'hono': '^4.6.0',
    '@hono/node-server': '^1.13.0',
    'better-sqlite3': '^11.7.0',
    'zod': '^3.24.0',
  },

  devPackages: {
    'typescript': '^5.4.0',
    'vitest': '^2.0.0',
    '@types/node': '^22.0.0',
    '@types/better-sqlite3': '^7.6.0',
    'tsx': '^4.0.0',
  },

  moduleTemplate: MODULE_TEMPLATE,
  promptExtension: PROMPT_EXTENSION,
  codeExamples: CODE_EXAMPLES,

  sharedFiles: {
    'src/db.ts': DB_FILE,
    'src/app.ts': APP_FILE,
  },

  packageExtras: {
    scripts: {
      dev: 'tsx watch src/server.ts',
      start: 'tsx src/server.ts',
      build: 'tsc',
      test: 'vitest run',
    },
  },
};
