import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pythonFastapi } from '../../src/architectures/python-fastapi.js';
import { resolveTarget } from '../../src/architectures/index.js';
import { splitSharedArtifacts, parseRegions } from '../../src/artifacts.js';
import type { RegenResult } from '../../src/regen.js';
import { sha256 } from '../../src/semhash.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';
import type { ImplementationUnit } from '../../src/models/iu.js';

const PY = resolveTarget('web-api/python-fastapi')!;

function iu(name: string): ImplementationUnit {
  return {
    iu_id: 'IU_' + name, kind: 'module', name, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: ['c1', 'c2'], dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: ['src/generated/issue/issue.py'],
  };
}

const PY_MODULE = `from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from src.db import db, register_migration

register_migration("issues", """
  CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
""")


class CreateIssue(BaseModel):
    title: str = Field(min_length=1)
    points: Optional[int] = None


router = APIRouter()


@router.get("/")
def list_issues():
    return [dict(r) for r in db.execute("SELECT * FROM issues").fetchall()]


@router.post("/{issue_id}")
def touch(issue_id: int):
    return {"id": issue_id}
`;

function makeResult(iu_id: string, path: string, content: string): RegenResult {
  return {
    iu_id, files: new Map([[path, content]]),
    manifest: {
      iu_id, iu_name: iu_id,
      files: { [path]: { path, content_hash: sha256(content), size: content.length } },
      regen_metadata: { model_id: 't', promptpack_hash: 'x', toolchain_version: 't', generated_at: 'now' },
    },
  };
}

describe('python-fastapi target', () => {
  it('resolves and targets .py files', () => {
    expect(PY.runtime.language).toBe('python');
    expect(PY.runtime.fileExtension).toBe('py');
    expect(PY.runtime.outputPathFor('sprint')).toBe('src/generated/sprint/sprint.py');
  });

  it('assemble appends _phoenix metadata and fixes SQLite double-quotes', () => {
    const input = `router = APIRouter()\nx = 'SELECT datetime("now")'`;
    const code = pythonFastapi.assemble(input, iu('Issue'));
    expect(code).toContain('_phoenix');
    expect(code).toContain('"iu_id": "IU_Issue"');
    expect(code).toContain("datetime('now')");
    expect(code).not.toContain('datetime("now")');
  });

  it('extractContract pulls Pydantic models and routes', () => {
    const c = pythonFastapi.extractContract(PY_MODULE)!;
    expect(c).toContain('class CreateIssue(BaseModel):');
    expect(c).toContain('points: Optional[int] = None');
    expect(c).toContain('@router.get("/")');
    expect(c).toContain('@router.post("/{issue_id}")');
    expect(c).not.toContain('from fastapi');
  });

  it('lifts register_migration into a #-commented shared aggregate (engine is generic)', () => {
    const r = makeResult('ISSUE', 'src/generated/issue/issue.py', PY_MODULE);
    const split = splitSharedArtifacts([r], PY);

    // Module no longer self-registers; db import pruned.
    const mod = r.files.get('src/generated/issue/issue.py')!;
    expect(mod).not.toContain('register_migration(');
    expect(mod).toContain('from src.db import db');

    // Shared file is Python, with #-prefixed region markers.
    const shared = split.files.get('src/generated/_migrations.py')!;
    expect(shared).toContain('from src.db import register_migration');
    expect(shared).toContain('# <<phx:region iu=ISSUE role=migration key=issues>>');
    expect(split.serverImports).toEqual(['src.generated._migrations']);

    // Prefix-agnostic region parser round-trips the python markers.
    const parsed = parseRegions(shared);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].content_hash).toBe(split.sharedFiles[0].regions[0].content_hash);
  });
});

describe('python-fastapi compile gate (python3 AST syntax check)', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'phoenix-py-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const write = (rel: string, content: string): void => {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  };

  it('returns [] for syntactically valid python', () => {
    write('src/generated/issue/issue.py', 'def f():\n    return 1\n');
    expect(pythonFastapi.compile(root)).toEqual([]);
  });

  it('reports a SyntaxError with file + line', () => {
    write('src/generated/issue/issue.py', 'def f(:\n    return 1\n');
    const errs = pythonFastapi.compile(root);
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].file).toContain('issue.py');
    expect(errs[0].code).toBe('PYSYNTAX');
  });
});
