/**
 * Runtime Target: python-fastapi
 *
 * Compiles the web-api architecture to Python: FastAPI (HTTP) + Pydantic (validation)
 * + stdlib sqlite3 (DB). Proves the regenerative thesis — the SAME canonical graph and
 * IUs compile to a different language with zero engine changes; only this target module
 * differs from node-typescript.
 *
 * Layout: src/generated/<slug>/<slug>.py (a package, one APIRouter per IU); shared
 * src/db.py; src/main.py mounts the routers. Compile gate = a python3 AST syntax check
 * (Python's real compile step), with HTTP-level evals as the deeper behavioural net.
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  RuntimeTarget, CompileError, AggregateRole, AggregateRecognition, ServiceDescriptor,
} from '../models/architecture.js';
import type { ImplementationUnit } from '../models/iu.js';
import { cleanCodeResponse, validateInlineScripts, fixSqliteQuotes } from '../codegen-util.js';

// ─── Shared files ───────────────────────────────────────────────────────────

const DB_FILE = `import os
import sqlite3

DB_PATH = os.environ.get("DB_PATH", "data/app.db")
os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)

db = sqlite3.connect(DB_PATH, check_same_thread=False)
db.row_factory = sqlite3.Row
db.execute("PRAGMA journal_mode = WAL")
db.execute("PRAGMA foreign_keys = ON")

_migrations: list[tuple[str, str]] = []


def register_migration(name: str, sql: str) -> None:
    _migrations.append((name, sql))


def run_migrations() -> None:
    for _name, sql in _migrations:
        db.executescript(sql)
    db.commit()
`;

// ─── Module template (reference shape for the prompt) ───────────────────────

const MODULE_TEMPLATE = `from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse  # only for HTML page modules
from pydantic import BaseModel, Field
from typing import Optional
from src.db import db, register_migration

# ── Database migrations ──
register_migration("tablename", """
  CREATE TABLE IF NOT EXISTS tablename (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
""")

# ── Validation schemas ──
class CreateThing(BaseModel):
    name: str = Field(min_length=1, max_length=200)

# ── Routes ──
router = APIRouter()

@router.get("/")
def list_things():
    return [dict(r) for r in db.execute("SELECT * FROM tablename ORDER BY created_at DESC").fetchall()]
`;

// ─── Per-module generation guide (user prompt) ──────────────────────────────

const MODULE_GUIDE = [
  '## MANDATORY: a module is a Python file that defines `router = APIRouter()`',
  'Start with the imports you need, exactly in this style:',
  '```python',
  'from fastapi import APIRouter, HTTPException',
  'from fastapi.responses import HTMLResponse   # ONLY if this module returns an HTML page',
  'from pydantic import BaseModel, Field',
  'from typing import Optional',
  'from src.db import db, register_migration',
  '```',
  'Do NOT call sqlite3.connect or open your own database — always use the shared `db`.',
  'Use ONLY the standard library plus fastapi and pydantic — NO third-party packages (no httpx, requests, aiohttp, sqlalchemy, …). To read another entity\'s data, query the shared `db` DIRECTLY (a JOIN or a second query). Backend modules MUST NOT make HTTP calls to sibling modules — they share one database.',
  '',
  '## Conventions',
  '- Register schema migrations with `register_migration("table", """ CREATE TABLE IF NOT EXISTS ... """)`.',
  '- Validate request bodies with Pydantic models (BaseModel). Optional fields: `Optional[int] = None`.',
  '- Numeric fields are numbers, not strings: point estimates, counts, capacities → `int` (e.g. `point_estimate: Optional[int] = None`). For a fixed numeric set (1,2,3,5,8,13) use `Literal[1,2,3,5,8,13]`. NEVER type a number as `str`.',
  '- Use parameterized SQL ALWAYS: `db.execute("... WHERE id = ?", (id,))`. NEVER f-string user input into SQL.',
  '- In SQL, use single quotes for string literals: `datetime(\'now\')`. NEVER double quotes (SQLite reads "x" as a column name).',
  '- Use snake_case for all column names and JSON keys; keep names identical across the create model, update model, DB columns, and returned JSON.',
  '- Return plain dicts/lists — `dict(row)` for a sqlite3.Row. FastAPI serializes them to JSON.',
  '- For not-found / validation, `raise HTTPException(status_code=404, detail="...")` (or 400).',
  '- Decorate routes with `@router.get("/")`, `@router.post("/")`, `@router.get("/{id}")`, `@router.patch("/{id}")`, `@router.delete("/{id}")` — paths RELATIVE to the router (it is mounted with a prefix).',
  '- Call sibling APIs by absolute HTTP path (e.g. fetch("/issue") from the browser); do not import sibling modules.',
  '',
  '## Web page modules (only if this module returns an HTML page)',
  'Return `HTMLResponse(content=...)` with a complete HTML document; include ALL CSS and JS inline.',
  'The inline JS runs in a real browser and must be valid JS. Do NOT build inline on* handlers (onclick="…") by string concatenation — render elements with data-* attributes and attach behaviour with addEventListener after inserting the HTML.',
].join('\n');

// ─── Prompt extension (system prompt) ───────────────────────────────────────

const PROMPT_EXTENSION = `
## Runtime: Python + FastAPI (Pydantic + stdlib sqlite3)
You generate ONE Python module that defines a FastAPI \`router = APIRouter()\`. The
module is mounted by the app with a path prefix, so route paths are relative. Use the
shared \`db\` (a sqlite3.Connection with row_factory=Row) and \`register_migration\`.
Output ONLY the Python module — no markdown fences, no prose.`;

// ─── Code examples ──────────────────────────────────────────────────────────

const CODE_EXAMPLES = `
## Example: a "notes" CRUD module

\`\`\`python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from src.db import db, register_migration

register_migration("notes", """
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
""")


class CreateNote(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: Optional[str] = ""


class UpdateNote(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    body: Optional[str] = None


router = APIRouter()


@router.get("/")
def list_notes():
    rows = db.execute("SELECT * FROM notes ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


@router.post("/", status_code=201)
def create_note(payload: CreateNote):
    cur = db.execute("INSERT INTO notes (title, body) VALUES (?, ?)", (payload.title, payload.body))
    db.commit()
    row = db.execute("SELECT * FROM notes WHERE id = ?", (cur.lastrowid,)).fetchone()
    return dict(row)


@router.get("/{note_id}")
def get_note(note_id: int):
    row = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    return dict(row)


@router.patch("/{note_id}")
def update_note(note_id: int, payload: UpdateNote):
    if db.execute("SELECT id FROM notes WHERE id = ?", (note_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="Not found")
    if payload.title is not None:
        db.execute("UPDATE notes SET title = ? WHERE id = ?", (payload.title, note_id))
    if payload.body is not None:
        db.execute("UPDATE notes SET body = ? WHERE id = ?", (payload.body, note_id))
    db.commit()
    return dict(db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone())


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: int):
    if db.execute("SELECT id FROM notes WHERE id = ?", (note_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="Not found")
    db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    db.commit()
\`\`\`
`;

// ─── Codegen hooks ──────────────────────────────────────────────────────────

/** Append the _phoenix provenance metadata and run shared SQLite-quote fixes. */
function assemblePy(llmResponse: string, iu: ImplementationUnit): string {
  let code = fixSqliteQuotes(cleanCodeResponse(llmResponse));

  // Ensure a router exists (the app mounts `router`).
  if (!/\brouter\s*=\s*APIRouter\(/.test(code)) {
    code = 'from fastapi import APIRouter\nrouter = APIRouter()\n\n' + code;
  }
  // Provenance metadata.
  if (!/\b_phoenix\s*=/.test(code)) {
    code = code.replace(/\s*$/, '\n') + `\n# @internal Phoenix VCS traceability — do not remove.
_phoenix = {
    "iu_id": "${iu.iu_id}",
    "name": "${iu.name.replace(/"/g, '\\"')}",
    "risk_tier": "${iu.risk_tier}",
    "canon_ids": ${iu.source_canon_ids.length},
}
`;
  }
  return code;
}

function stubPy(iu: ImplementationUnit): string {
  return `from fastapi import APIRouter

router = APIRouter()


@router.get("/")
def _stub():
    return {"stub": True, "module": "${iu.name.replace(/"/g, '\\"')}", "message": "Not yet implemented"}


# @internal Phoenix VCS traceability — do not remove.
_phoenix = {
    "iu_id": "${iu.iu_id}",
    "name": "${iu.name.replace(/"/g, '\\"')}",
    "risk_tier": "${iu.risk_tier}",
    "canon_ids": ${iu.source_canon_ids.length},
}
`;
}

/** Extract Pydantic models + FastAPI routes so consumer IUs match the contract. */
function extractPyContract(code: string): string | null {
  const lines = code.split('\n');
  const parts: string[] = [];

  // Pydantic model blocks: from `class X(BaseModel):` until the next top-level line.
  for (let i = 0; i < lines.length; i++) {
    if (/^class\s+\w+\(.*BaseModel.*\)\s*:/.test(lines[i])) {
      const block = [lines[i]];
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === '' || /^\s/.test(lines[j]))) {
        block.push(lines[j]);
        j++;
      }
      parts.push(block.join('\n').trimEnd());
      i = j - 1;
    }
  }

  const routes: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const r = line.match(/@router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/);
    if (r) {
      const sig = `@router.${r[1]}("${r[2]}")`;
      if (!seen.has(sig)) { seen.add(sig); routes.push(sig); }
    }
  }
  if (routes.length) parts.push('# routes:\n' + routes.join('\n'));

  let text = parts.join('\n\n');
  if (!text) return null;
  if (text.length > 2500) text = text.slice(0, 2500) + '\n# …(truncated)';
  return text;
}

const PY_CHECKER = `import ast, glob, sys
errs = 0
for f in sorted(glob.glob('src/**/*.py', recursive=True)):
    try:
        ast.parse(open(f, encoding='utf-8').read(), filename=f)
    except SyntaxError as e:
        print(f"{f}({e.lineno or 0},{e.offset or 0}): error PYSYNTAX: {e.msg}")
        errs += 1
sys.exit(1 if errs else 0)
`;
const PY_ERR_RE = /^(.+?)\((\d+),(\d+)\): error (\S+): (.*)$/;

/** Compile = Python's real build step: byte-parse every module (AST), report SyntaxErrors. */
function pyCompile(projectRoot: string): CompileError[] {
  const checker = join(tmpdir(), 'phoenix-pycheck.py');
  writeFileSync(checker, PY_CHECKER, 'utf8');
  try {
    execSync(`python3 ${JSON.stringify(checker)}`, { cwd: projectRoot, stdio: 'pipe', timeout: 60_000 });
    return [];
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const out = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
    const errors: CompileError[] = [];
    for (const line of out.split('\n')) {
      const m = line.match(PY_ERR_RE);
      if (m) errors.push({ file: m[1].trim(), line: +m[2], col: +m[3], code: m[4], message: m[5].trim(), raw: line.trim() });
    }
    // The checker itself failed to run (e.g. python3 missing) — surface, don't claim clean.
    if (errors.length === 0 && out.trim()) {
      const first = out.trim().split('\n')[0];
      errors.push({ file: 'src', line: 0, col: 0, code: 'PYCHECK', message: first, raw: first });
    }
    return errors;
  }
}

// Third-party packages the model tends to reach for but that aren't available and
// signal a design error (a backend module HTTP-calling siblings or using an ORM
// instead of the shared sqlite db). Catching these at the source gate turns a
// runtime ImportError crash into a fixable generation error.
const FORBIDDEN_IMPORTS = new Set([
  'httpx', 'requests', 'aiohttp', 'urllib3', 'httplib2',
  'sqlalchemy', 'sqlmodel', 'databases', 'psycopg2', 'pymysql', 'asyncpg', 'aiosqlite',
]);

/** Source gate: inline-<script> validation PLUS a forbidden-import check (Python can't
 *  catch a missing module until import time; the syntax gate won't see it). */
function pythonValidateSource(code: string): string | null {
  const inline = validateInlineScripts(code);
  if (inline) return inline;
  for (const line of code.split('\n')) {
    const m = line.match(/^\s*(?:import|from)\s+([a-zA-Z0-9_]+)/);
    if (m && FORBIDDEN_IMPORTS.has(m[1])) {
      return `Module imports the unavailable third-party package "${m[1]}". Use ONLY the standard library plus fastapi and pydantic. `
        + 'To read another entity\'s data, query the shared `db` directly (JOIN or a second query) — backend modules must NOT make HTTP calls to sibling modules.';
    }
  }
  return null;
}

// ─── Migration aggregate ────────────────────────────────────────────────────

const MIGRATIONS_FILE = 'src/generated/_migrations.py';
// register_migration("table", """ ... """)  — triple-quoted SQL.
const MIGRATION_RE = /register_migration\(\s*(['"])(.*?)\1\s*,\s*("""|''')([\s\S]*?)\3\s*\)/g;

const migrationRole: AggregateRole = {
  role: 'migration',
  filePath: MIGRATIONS_FILE,
  commentPrefix: '#',
  importSpecifier: 'src.generated._migrations',
  fileHeader: [
    '# AUTO-GENERATED shared artifact: database migrations aggregated across IUs.',
    '# Each region below is OWNED by exactly one Implementation Unit. Editing inside a',
    '# region is drift attributed to that IU; Phoenix regenerates the whole file.',
    'from src.db import register_migration',
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
      const q = m[3];
      contributions.push({ key: table, body: `register_migration("${table}", ${q}${m[4]}${q})` });
      const startLine = lineAt(m.index);
      const endLine = lineAt(m.index + m[0].length - 1);
      for (let i = startLine; i <= endLine; i++) removed.add(i);
    }
    for (let i = 0; i < lines.length; i++) {
      if (/Database migrations/.test(lines[i])) removed.add(i);
    }
    for (let i = 1; i < lines.length; i++) {
      if (!removed.has(i) && removed.has(i - 1) && lines[i].trim() === '') removed.add(i);
    }

    let strippedCode = lines.filter((_, i) => !removed.has(i)).join('\n');
    strippedCode = pruneMigrationImport(strippedCode);
    return { strippedCode, removed: [...removed], contributions };
  },
};

/** When a module no longer calls register_migration, drop it from the db import. */
function pruneMigrationImport(content: string): string {
  if (content.includes('register_migration(')) return content;
  return content.replace(
    /from\s+src\.db\s+import\s+([^\n]+)/g,
    (_full, names: string) => {
      const kept = names.split(',').map(s => s.trim()).filter(Boolean).filter(n => n !== 'register_migration');
      if (kept.length === 0) return '';
      return `from src.db import ${kept.join(', ')}`;
    },
  );
}

// ─── Scaffold ───────────────────────────────────────────────────────────────

const WEB_RE = /\b(web|ui|frontend|interface|page|dashboard|board)\b/;

function pythonScaffold(services: ServiceDescriptor[], projectName: string, sharedImports: string[]): Map<string, string> {
  const files = new Map<string, string>();

  files.set('src/db.py', DB_FILE);
  files.set('src/__init__.py', '');
  files.set('src/generated/__init__.py', '');

  const imports: string[] = [];
  const mounts: string[] = [];
  for (const svc of services) {
    files.set(`src/generated/${svc.dir}/__init__.py`, '');
    for (const mod of svc.modules) {
      const modName = mod.replace(/\.py$/, '');
      const alias = `${modName.replace(/-/g, '_')}_router`;
      imports.push(`from src.generated.${svc.dir}.${modName} import router as ${alias}`);
      // Normalize separators so web-detection works on snake_case dirs (board_ui).
      const isWeb = WEB_RE.test(`${svc.name} ${svc.dir}`.replace(/[_-]/g, ' ').toLowerCase());
      // URL prefixes use hyphens (web convention; matches sibling contract mount paths);
      // the Python package dir uses underscores.
      const prefix = isWeb ? '' : '/' + svc.dir.replace(/_/g, '-');
      mounts.push(`app.include_router(${alias}, prefix="${prefix}")`);
    }
  }

  const main = [
    'from fastapi import FastAPI',
    'from fastapi.responses import JSONResponse',
    'from src.db import run_migrations',
    '',
    '# Shared aggregate artifacts (register migrations on import)',
    ...sharedImports.map(s => `import ${s}  # noqa: F401`),
    '',
    '# Generated route modules',
    ...imports,
    '',
    'app = FastAPI(title="' + projectName + '")',
    '',
    '@app.get("/health")',
    'def health():',
    '    return {"status": "ok"}',
    '',
    '# Mount routes',
    ...mounts,
    '',
    '# Create tables from the registered migrations.',
    'run_migrations()',
    '',
  ].join('\n');
  files.set('src/main.py', main);

  files.set('requirements.txt', ['fastapi==0.115.*', 'uvicorn[standard]==0.32.*', 'pydantic==2.*', ''].join('\n'));
  files.set('README.md', [
    `# ${projectName}`,
    '',
    'Generated by Phoenix VCS — Python / FastAPI backend.',
    '',
    '```bash',
    'python3 -m venv .venv && . .venv/bin/activate',
    'pip install -r requirements.txt',
    'uvicorn src.main:app --port 3000',
    '```',
    '',
  ].join('\n'));

  return files;
}

// ─── Export ─────────────────────────────────────────────────────────────────

export const pythonFastapi: RuntimeTarget = {
  name: 'python-fastapi',
  description: 'Python — FastAPI, Pydantic, stdlib sqlite3',
  language: 'python',
  fileExtension: 'py',

  packages: {
    'fastapi': '0.115.*',
    'uvicorn[standard]': '0.32.*',
    'pydantic': '2.*',
  },
  devPackages: {},

  moduleTemplate: MODULE_TEMPLATE,
  promptExtension: PROMPT_EXTENSION,
  moduleGuide: MODULE_GUIDE,
  codeExamples: CODE_EXAMPLES,

  sharedFiles: {
    'src/db.py': DB_FILE,
  },
  packageExtras: {},

  // Python package/module names must be valid identifiers — no hyphens. Underscore the
  // kebab slug for the dir + file; URL prefixes keep hyphens (see pythonScaffold).
  outputPathFor: (slug: string): string => {
    const s = slug.replace(/-/g, '_');
    return `src/generated/${s}/${s}.py`;
  },
  assemble: assemblePy,
  stub: stubPy,
  extractContract: extractPyContract,
  compile: pyCompile,
  ownsGeneratedFile: (path: string): boolean =>
    path.startsWith('src/generated/') && path.endsWith('.py')
    && !path.endsWith('_migrations.py') && !path.endsWith('__init__.py'),
  validateSource: pythonValidateSource,
  aggregates: [migrationRole],
  scaffold: pythonScaffold,
};
