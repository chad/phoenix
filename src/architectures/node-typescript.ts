/**
 * Runtime Target: node-typescript
 *
 * Compiles web-api architecture to Node.js + TypeScript.
 * Stack: Hono (HTTP) + better-sqlite3 (DB) + Zod (validation)
 */

import { execSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type {
  RuntimeTarget, CompileError, AggregateRole, AggregateRecognition, ServiceDescriptor,
} from '../models/architecture.js';
import type { ImplementationUnit } from '../models/iu.js';
import { cleanCodeResponse, validateInlineScripts, fixSqliteQuotes } from '../codegen-util.js';
import { nodeScaffold } from '../scaffold.js';
import { WEB_API_RUNTIME, WEB_API_TYPES, NODE_TS_DEV_PACKAGES } from '../toolchain.js';

const TSC_LINE = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/;

/** Parse `tsc --noEmit` output into structured compile errors. */
export function parseTscOutput(output: string): CompileError[] {
  const errors: CompileError[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = line.replace(/\r$/, '').match(TSC_LINE);
    if (m) errors.push({ file: m[1].trim(), line: +m[2], col: +m[3], code: m[4], message: m[5].trim(), raw: line.trim() });
  }
  return errors;
}

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
`;

const APP_FILE = `import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';

const app = new Hono();

app.use('*', logger());
app.use('*', cors());

app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

// Browsers auto-request /favicon.ico; answer 204 so it isn't a console 404.
app.get('/favicon.ico', (c) => c.body(null, 204));

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

// ─── Per-module generation guide (injected into the user prompt) ────────────

const MODULE_GUIDE = [
  '## MANDATORY: Your module MUST start with these exact imports',
  '```',
  `import { Hono } from 'hono';`,
  `import { db, registerMigration } from '../../db.js';`,
  `import { z } from 'zod';`,
  '```',
  'Do NOT import Database from better-sqlite3. Do NOT create new Database(). Use the db import above.',
  '',
  '## Schema conventions',
  '- In create/update schemas, optional string and number fields must accept null as well as undefined: use `.nullable().optional()`. Clients send null for cleared fields, so a field that is only `.optional()` will reject valid requests.',
  '- Use snake_case for all field and column names, and keep field names identical between the create schema, the update schema, the DB columns, and the JSON you return.',
  '- For an enumerated set of NUMBERS (e.g. allowed point values 1,2,3,5,8,13), use `z.union([z.literal(1), z.literal(2), ...])` or `z.number().refine(v => [1,2,3,5,8,13].includes(v))`. NEVER use `z.enum([...])` with numbers — `z.enum` accepts string literals only and will not compile.',
  "- Call SQL functions like `datetime('now')` directly inside the SQL string (e.g. `SET completed_at = datetime('now')`). NEVER pass them as a bound `?` parameter — that stores the literal text \"datetime('now')\" instead of a timestamp.",
  '- Narrow nullable values INLINE at each use. TypeScript does NOT carry a narrowing through a stored boolean: `const over = sprint.capacity != null && pts > sprint.capacity; const by = over ? pts - sprint.capacity : 0;` FAILS (`sprint.capacity` is still possibly undefined on the second line). Instead capture the value once: `const cap = sprint.capacity ?? null; const by = cap != null && pts > cap ? pts - cap : 0;`',
  '',
  '## Browser code (only if this module returns an HTML page via c.html(`...`))',
  'The HTML you emit is executed by a real browser, so it must be valid JS/HTML — not merely a valid TypeScript string (TypeScript will not catch errors inside the page).',
  '- Do NOT build inline event handlers (onclick="…") with string concatenation; nested quotes break and blank the page. Instead render elements with data-* attributes (data-id, data-status, …) and attach behaviour with addEventListener after inserting the HTML.',
  '- Keep client-side state field names identical to the API contract (e.g. point_estimate, labels as an array).',
].join('\n');

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

// ─── Codegen hooks (the TS/Hono/Zod/SQLite specifics live here, not in the engine) ──

const MINIMAL_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2022', module: 'Node16', moduleResolution: 'Node16',
    strict: true, esModuleInterop: true, skipLibCheck: true, outDir: 'dist', rootDir: 'src',
  },
  include: ['src'],
}, null, 2);

/** Compile the whole project with tsc; ensure a tsconfig exists during pre-scaffold generation. */
function tscCompile(projectRoot: string): CompileError[] {
  const tsconfigPath = join(projectRoot, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) writeFileSync(tsconfigPath, MINIMAL_TSCONFIG, 'utf8');
  try {
    execSync('npx tsc --noEmit 2>&1', { cwd: projectRoot, stdio: 'pipe', timeout: 120_000 });
    return [];
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const raw = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
    const errors = parseTscOutput(raw);
    // tsc failed but produced no parseable TS errors — a broken toolchain (e.g. the
    // fake npx 'tsc' package when node_modules is missing) must be a loud failure,
    // never an empty (green) list. "Compiles" earned by a missing compiler is the
    // same false green this whole system exists to kill.
    if (errors.length === 0) {
      return [{ file: '(toolchain)', line: 0, col: 0, code: 'TSC-EXEC', message: raw.trim().split('\n')[0] ?? 'tsc failed with no parseable output', raw: raw.slice(0, 200) }];
    }
    return errors;
  }
}

/** Repair raw LLM output into a structurally-valid Hono module: fixed imports, single
 *  router, default export, _phoenix metadata, and SQL double→single quote fixes. */
function assembleFromTemplate(llmResponse: string, iu: ImplementationUnit): string {
  let code = cleanCodeResponse(llmResponse);

  const templateLines = MODULE_TEMPLATE.split('\n');
  const headerEnd = templateLines.findIndex(l => l.includes('__MIGRATIONS__'));
  const templateHeader = templateLines.slice(0, Math.max(headerEnd, 0)).join('\n');

  const codeLines = code.split('\n');
  // Strip ONLY the boilerplate framework imports the template header re-supplies —
  // match the whole module specifier, not a substring (so a user import path that
  // merely contains 'zod'/'hono'/'db.js' is preserved).
  const FRAMEWORK_IMPORT = /from\s*['"](hono(\/.*)?|zod|better-sqlite3|(\.\.?\/)+db\.js)['"]/;
  const bodyLines = codeLines.filter(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('import ') && FRAMEWORK_IMPORT.test(trimmed)) return false;
    return true;
  });
  let body = bodyLines.join('\n').trim();

  // Keep the first `const router = new Hono()` and drop any later one, regardless of
  // line layout (handles two decls on one line, or one split across lines).
  let routerSeen = 0;
  body = body.replace(/const\s+router\s*=\s*new Hono\(\)\s*;?/g, m => (routerSeen++ ? '' : m));

  body = body.replace(/(^|\n)\s*export\s+default\s+router\s*;?/g, '\n');
  body = body.replace(/\/\*\*[^]*?_phoenix[^]*?\*\/\s*export\s+const\s+_phoenix\s*=\s*\{[^}]*\}\s*as\s+const\s*;?\s*/g, '');
  body = body.replace(/export\s+const\s+_phoenix\s*=\s*\{[^}]*\}\s*as\s+const\s*;?\s*/g, '');
  body = body.replace(/\/\*\* @internal Phoenix VCS traceability[^]*?\*\/\s*/g, '');

  // The template unconditionally appends `export default router;`, so the body MUST
  // declare `router` — gate on the actual declaration, not on any `new Hono()`.
  if (!/const\s+router\s*=\s*new Hono\(\)/.test(body)) {
    body = 'const router = new Hono();\n\n' + body;
  }

  const phoenixMeta = `/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '${iu.iu_id}',
  name: '${iu.name}',
  risk_tier: '${iu.risk_tier}',
  canon_ids: [${iu.source_canon_ids.map(id => JSON.stringify(id)).join(', ')}] as const,
} as const;`;

  body = fixSqliteQuotes(body);

  return `${templateHeader}\n\n${body}\n\nexport default router;\n\n${phoenixMeta}\n`;
}

/** Minimal valid Hono router stub when generation fails. */
function archStub(iu: ImplementationUnit): string {
  return `import { Hono } from 'hono';

const router = new Hono();

router.get('/', (c) => c.json({ stub: true, module: '${iu.name}', message: 'Not yet implemented' }));

export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '${iu.iu_id}',
  name: '${iu.name}',
  risk_tier: '${iu.risk_tier}',
  canon_ids: [${iu.source_canon_ids.map(id => JSON.stringify(id)).join(', ')}] as const,
} as const;
`;
}

/** Extract a module's Zod schemas + Hono routes so consumer IUs match the contract. */
function extractTsContract(code: string): string | null {
  const parts: string[] = [];
  const schemaRe = /const\s+\w+\s*=\s*z\.object\(\{[\s\S]*?\}\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = schemaRe.exec(code))) parts.push(m[0]);

  const routes: string[] = [];
  const seen = new Set<string>();
  for (const line of code.split('\n')) {
    const r = line.match(/router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/);
    if (r) {
      const sig = `router.${r[1]}('${r[2]}')`;
      if (!seen.has(sig)) { seen.add(sig); routes.push(sig); }
    }
  }
  if (routes.length) parts.push('// routes:\n' + routes.join('\n'));

  let text = parts.join('\n\n');
  if (!text) return null;
  if (text.length > 2500) text = text.slice(0, 2500) + '\n// …(truncated)';
  return text;
}

// ── Migration aggregate (better-sqlite3 registerMigration) ──

const MIGRATIONS_FILE = 'src/generated/_migrations.ts';
const MIGRATION_RE = /registerMigration\(\s*(['"])(.*?)\1\s*,\s*`([\s\S]*?)`\s*\)\s*;?/g;

const migrationRole: AggregateRole = {
  role: 'migration',
  filePath: MIGRATIONS_FILE,
  commentPrefix: '//',
  importSpecifier: './generated/_migrations.js',
  fileHeader: [
    '// AUTO-GENERATED shared artifact: database migrations aggregated across IUs.',
    '// Each region below is OWNED by exactly one Implementation Unit. Editing inside a',
    '// region is drift attributed to that IU; Phoenix regenerates the whole file.',
    "import { registerMigration } from '../db.js';",
    '',
  ].join('\n'),

  recognize(content: string): AggregateRecognition {
    const lines = content.split('\n');
    const removed = new Set<number>();
    const contributions: AggregateRecognition['contributions'] = [];

    const lineStart: number[] = [];
    let off = 0;
    for (const l of lines) { lineStart.push(off); off += l.length + 1; }
    const lineAt = (charIdx: number): number => {
      let i = lineStart.length - 1;
      while (i > 0 && lineStart[i] > charIdx) i--;
      return i;
    };

    let m: RegExpExecArray | null;
    MIGRATION_RE.lastIndex = 0;
    while ((m = MIGRATION_RE.exec(content))) {
      const table = m[2];
      contributions.push({ key: table, body: `registerMigration('${table}', \`${m[3]}\`);` });
      const startLine = lineAt(m.index);
      const endLine = lineAt(m.index + m[0].length - 1);
      for (let i = startLine; i <= endLine; i++) removed.add(i);
    }
    for (let i = 0; i < lines.length; i++) {
      // Drop only the template's decorative section-header comment, not real code or
      // comments that merely mention the phrase.
      if (/^\s*\/\/\s*[─\-= ]*Database migrations[─\-= ]*\s*$/.test(lines[i])) removed.add(i);
    }
    // collapse a blank line left immediately after a removed block
    for (let i = 1; i < lines.length; i++) {
      if (!removed.has(i) && removed.has(i - 1) && lines[i].trim() === '') removed.add(i);
    }

    let strippedCode = lines.filter((_, i) => !removed.has(i)).join('\n');
    strippedCode = pruneRegisterMigrationImport(strippedCode);

    return { strippedCode, removed: [...removed], contributions };
  },
};

/** When a module no longer calls registerMigration, drop it from the db import. */
function pruneRegisterMigrationImport(content: string): string {
  if (content.includes('registerMigration(')) return content;
  return content.replace(
    /import\s*\{([^}]*)\}\s*from\s*(['"][^'"]*db\.js['"]);?/g,
    (_full, inner: string, from: string) => {
      const names = inner.split(',').map(s => s.trim()).filter(Boolean).filter(n => n !== 'registerMigration');
      if (names.length === 0) return '';
      return `import { ${names.join(', ')} } from ${from};`;
    },
  );
}

// ─── Export ─────────────────────────────────────────────────────────────────

export const nodeTypescript: RuntimeTarget = {
  name: 'node-typescript',
  description: 'Node.js + TypeScript — Hono, better-sqlite3, Zod',
  language: 'typescript',
  fileExtension: 'ts',

  // Versions come from src/toolchain.ts — one canonical pin, gated by
  // tests/unit/toolchain.test.ts so literals cannot creep back in here.
  packages: { ...WEB_API_RUNTIME },

  devPackages: { ...NODE_TS_DEV_PACKAGES, ...WEB_API_TYPES },

  moduleTemplate: MODULE_TEMPLATE,
  promptExtension: PROMPT_EXTENSION,
  moduleGuide: MODULE_GUIDE,
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

  // ── Codegen hooks ──
  outputPathFor: (slug: string): string => `src/generated/${slug}/${slug}.ts`,
  assemble: assembleFromTemplate,
  stub: archStub,
  extractContract: extractTsContract,
  compile: tscCompile,
  ownsGeneratedFile: (path: string): boolean =>
    path.startsWith('src/generated/') && !path.endsWith('_migrations.ts'),
  validateSource: validateInlineScripts,
  aggregates: [migrationRole],
  scaffold: (services: ServiceDescriptor[], projectName: string, sharedImports: string[]): Map<string, string> =>
    nodeScaffold(services, projectName, nodeTypescript, sharedImports).files,

  // Write package.json + npm install before generation so tsc can resolve the
  // framework's type declarations during the per-IU typecheck-retry loop.
  prepareProject(projectRoot: string): void {
    const pkg = {
      name: basename(projectRoot), version: '0.1.0', type: 'module',
      dependencies: nodeTypescript.packages, devDependencies: nodeTypescript.devPackages,
    };
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    try {
      execSync('npm install --silent 2>/dev/null', { cwd: projectRoot, stdio: 'pipe', timeout: 60_000 });
    } catch { /* best effort */ }
  },
};
