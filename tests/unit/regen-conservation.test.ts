import { describe, it, expect } from 'vitest';
import { ddlFromMigrationsFile } from '../../src/schema-plan.js';
import { splitSharedArtifacts } from '../../src/artifacts.js';
import { declaredSurfaceForUnit, extractDeclaredRoutes, relativeTo } from '../../src/spec-interface.js';
import { resolveTarget } from '../../src/architectures/index.js';

describe('ddlFromMigrationsFile', () => {
  it('reads CREATE TABLE statements out of TS and Python aggregates, paren-balanced', () => {
    const ts = "registerMigration('q', `CREATE TABLE IF NOT EXISTS q (\n id INTEGER, at TEXT DEFAULT (datetime('now'))\n)`);";
    const py = 'register_migration("v", """CREATE TABLE IF NOT EXISTS v (a TEXT, PRIMARY KEY (a))""")';
    expect(ddlFromMigrationsFile(ts)).toContain("DEFAULT (datetime('now'))\n)");
    expect(ddlFromMigrationsFile(py)).toBe('CREATE TABLE IF NOT EXISTS v (a TEXT, PRIMARY KEY (a))');
    expect(ddlFromMigrationsFile('nothing here')).toBeUndefined();
  });
});

describe('splitSharedArtifacts — pinned schema wins a partial regen', () => {
  it('keeps the planned table over a regenerated module\'s own CREATE TABLE', () => {
    const target = resolveTarget('web-api/node-typescript')!;
    const moduleSrc = "import { db, registerMigration } from '../../db.js';\nregisterMigration('votes', `CREATE TABLE IF NOT EXISTS votes (id INTEGER)`);\nexport default 1;\n";
    const result = { iu_id: 'board', files: new Map([['src/generated/board/board.ts', moduleSrc]]), manifest: { files: {} } } as never;
    const pinned = [{ iu_id: 'schema-plan', role: 'migration', key: 'votes', body: "registerMigration('votes', `CREATE TABLE IF NOT EXISTS votes (question_id INTEGER, voter TEXT)`);", content_hash: '', start_line: 0, end_line: 0 }];
    const split = splitSharedArtifacts([result], target, { pinned });
    const agg = [...split.files.values()][0];
    expect(agg).toContain('voter TEXT');
    expect(agg).not.toContain('(id INTEGER)');
  });
});

describe('declaredSurfaceForUnit — interface-first planning', () => {
  const routes = extractDeclaredRoutes(['`GET /` page', '`POST /votes` vote', '`GET /board` board', '`POST /questions` ask', '`GET /health` ok']);
  const names = ['question', 'vote', 'board', 'web ui'];
  it('gives a unit the surface named for it, relative to its prefix', () => {
    const s = declaredSurfaceForUnit(routes, { name: 'vote', isUi: false }, names)!;
    expect(s.prefix).toBe('/votes');
    expect(s.own.map(r => r.path)).toEqual(['/votes']);
    expect(relativeTo(s.prefix, '/votes')).toBe('/');
    expect(s.others.some(r => r.path === '/health')).toBe(false);
  });
  it('gives the site root to the UI unit', () => {
    expect(declaredSurfaceForUnit(routes, { name: 'web ui', isUi: true }, names)!.own.map(r => r.path)).toEqual(['/']);
  });
  it('abstains when a surface has no confident owner', () => {
    expect(declaredSurfaceForUnit(routes, { name: 'storage', isUi: false }, ['storage', 'question', 'web ui'])).toBeNull();
  });
});

describe('asPythonRegions', () => {
  it('re-renders planned TS migration regions in Python syntax', async () => {
    const { planFromMigrations, asPythonRegions } = await import('../../src/schema-plan.js');
    const plan = planFromMigrations("registerMigration('votes', `CREATE TABLE IF NOT EXISTS votes (voter TEXT)`);")!;
    const py = asPythonRegions(plan);
    expect(py.regions[0].body).toBe('register_migration("votes", """CREATE TABLE IF NOT EXISTS votes (voter TEXT)""")');
    expect(py.ddl).toBe(plan.ddl);
  });
});
