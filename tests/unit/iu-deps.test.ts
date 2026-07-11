import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveRelativeImport, deriveIUDependencies, applyDerivedDependencies, buildFileToIUMap } from '../../src/iu-deps.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

function iu(id: string, file: string, deps: string[] = []): ImplementationUnit {
  return {
    iu_id: id, kind: 'module', name: id, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: [], dependencies: deps,
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: [file],
  };
}

describe('resolveRelativeImport', () => {
  const known = new Set(['src/generated/tasks.ts', 'src/generated/projects/projects.ts']);
  it('resolves .js specifier to .ts sibling', () => {
    expect(resolveRelativeImport('src/generated/projects/projects.ts', '../tasks.js', known)).toBe('src/generated/tasks.ts');
  });
  it('resolves extensionless specifier', () => {
    expect(resolveRelativeImport('src/generated/projects/projects.ts', '../tasks', known)).toBe('src/generated/tasks.ts');
  });
  it('returns null for non-relative and unknown', () => {
    expect(resolveRelativeImport('src/a.ts', 'hono', known)).toBeNull();
    expect(resolveRelativeImport('src/a.ts', './nope', known)).toBeNull();
  });
});

describe('deriveIUDependencies', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'phoenix-deps-')); });
  function write(rel: string, content: string) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }

  it('derives IU->IU edges from real relative imports', () => {
    const tasks = iu('iu-tasks', 'src/generated/tasks.ts');
    const projects = iu('iu-projects', 'src/generated/projects.ts');
    write('src/generated/tasks.ts', `import { getProject } from './projects.js';\nexport const x = 1;`);
    write('src/generated/projects.ts', `export const getProject = () => 1;`);
    const derived = deriveIUDependencies(root, [tasks, projects]);
    expect(derived.get('iu-tasks')).toEqual(['iu-projects']);
    expect(derived.get('iu-projects')).toEqual([]);
  });

  it('ignores package imports and self-imports', () => {
    const tasks = iu('iu-tasks', 'src/generated/tasks.ts');
    write('src/generated/tasks.ts', `import { Hono } from 'hono';\nimport { helper } from './tasks.js';`);
    const derived = deriveIUDependencies(root, [tasks]);
    expect(derived.get('iu-tasks')).toEqual([]);
  });

  it('derives IU->IU edges from HTTP calls to a sibling route (the web-UI case)', () => {
    const dashboard = iu('iu-dashboard', 'src/generated/dashboard/dashboard.ts');
    const habit = iu('iu-habit', 'src/generated/habit/habit.ts');
    // Dashboard consumes the habit module over HTTP — no import, only a fetch.
    write('src/generated/dashboard/dashboard.ts', `export async function load(){ const r = await fetch('/habit'); return r.json(); }`);
    write('src/generated/habit/habit.ts', `export const habit = 1;`);
    const derived = deriveIUDependencies(root, [dashboard, habit]);
    expect(derived.get('iu-dashboard')).toEqual(['iu-habit']);
    expect(derived.get('iu-habit')).toEqual([]);
  });

  it('applyDerivedDependencies reports only changed IUs', () => {
    const tasks = iu('iu-tasks', 'src/generated/tasks.ts', []);
    const changed = applyDerivedDependencies([tasks], new Map([['iu-tasks', ['iu-projects']]]));
    expect(changed).toHaveLength(1);
    expect(tasks.dependencies).toEqual(['iu-projects']);
    // Second apply with same value → no change.
    const changed2 = applyDerivedDependencies([tasks], new Map([['iu-tasks', ['iu-projects']]]));
    expect(changed2).toHaveLength(0);
  });
});

describe('buildFileToIUMap', () => {
  it('maps every output file to its IU with POSIX slashes', () => {
    const map = buildFileToIUMap([iu('a', 'src/a.ts'), iu('b', 'src/b.ts')]);
    expect(map.get('src/a.ts')).toBe('a');
    expect(map.get('src/b.ts')).toBe('b');
  });
});
