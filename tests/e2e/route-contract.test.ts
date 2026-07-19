/**
 * E2E: the route-contract overlay turns the afterimage abstention into a seeded create.
 *
 * NIGHT-REPORT-5's afterimage cold-start ended in an honest abstention: the generated
 * create route demanded a tags CSV with ≥2 parts (a Zod `.refine` living only in the
 * module, never in the DDL or the constraint graph), and the seeder — blind to the
 * route contract — sent a single part and was rejected.
 *
 * This fixture reproduces that shape with a REAL booted app (Node built-ins, no npm
 * install): the app carries its Zod create-schema in source (what a generated module
 * looks like) and enforces the same rules in its hand-rolled handler.
 *
 *   1. WITHOUT the overlay → the synthesized body is rejected (400), the table is
 *      unseedable (the abstention, reproduced).
 *   2. WITH the overlay    → the seeder sends a 2-part CSV and a named-const enum
 *      member; the create succeeds and returns a real id.
 *
 * The overlay only ever makes seeding MORE valid — the app's acceptance rules are
 * untouched, and both runs drive the same real HTTP surface.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootApp } from '../../src/live-harness.js';
import {
  parseTableSchemas, seedTable, makeSeededRng, singularize,
  type SeedPlanInput, type SeedContext,
} from '../../src/live-seed.js';
import { parseRouteContract } from '../../src/route-contract.js';

/** The fixture app: a habits create route enforcing a CSV refine + a named-const enum —
 *  exactly the afterimage shape. The Zod schema text rides in a comment, as the parse
 *  target (the generated module would carry it as code; the reader scans source text). */
function habitApp(): string {
  return `import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.env.DB_PATH ?? ':memory:');
db.exec("CREATE TABLE IF NOT EXISTS habits (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, tags TEXT NOT NULL, priority TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))");

/*
const PRIORITIES = ['low', 'high'] as const;
const CreateHabitSchema = z.object({
  name: z.string().min(1),
  tags: z.string().refine(s => s.split(',').length >= 2),
  priority: z.enum(PRIORITIES),
});
*/

async function readBody(req) { let s = ''; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; }

const server = createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    if (url === '/health') return send(200, { status: 'ok' });
    if (url === '/habit' && req.method === 'POST') {
      const b = await readBody(req);
      const name = String(b.name ?? '');
      const tags = String(b.tags ?? '');
      const priority = String(b.priority ?? '');
      if (!name) return send(400, { error: 'name is required' });
      // The route contract: a CSV with at least 2 parts, and a declared priority.
      if (tags.split(',').length < 2) return send(400, { error: 'tags must have at least 2 parts' });
      if (!['low', 'high'].includes(priority)) return send(400, { error: 'priority must be one of low, high' });
      const info = db.prepare('INSERT INTO habits (name, tags, priority) VALUES (?, ?, ?)').run(name, tags, priority);
      return send(201, { id: info.lastInsertRowid, name, tags, priority });
    }
    return send(404, { error: 'not found' });
  } catch (e) { return send(500, { error: String(e) }); }
});
server.listen(parseInt(process.env.PORT || '3000', 10), () => console.error('ready'));
`;
}

const DDL = "CREATE TABLE IF NOT EXISTS habits (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, tags TEXT NOT NULL, priority TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))";

function input(withOverlay: boolean, moduleSource: string): SeedPlanInput {
  const tables = parseTableSchemas(DDL);
  return {
    tables, constraints: [],
    routeFor: (t) => (t === 'habits' ? '/habit' : null),
    contractFor: withOverlay
      ? (t) => (t === 'habits' ? parseRouteContract(moduleSource) : undefined)
      : undefined,
  };
}

async function trySeed(dir: string, inp: SeedPlanInput): Promise<{ id?: number; ctx: SeedContext }> {
  const app = await bootApp({ projectRoot: dir, command: ['node', 'app.mjs'], readyTimeoutMs: 12_000 });
  try {
    const ctx: SeedContext = { ids: new Map(), unseedable: [] };
    const id = await seedTable(app, 'habits', inp, new Map(), makeSeededRng(), ctx);
    return { id, ctx };
  } finally {
    await app.stop();
  }
}

describe('e2e: route-contract overlay (the afterimage abstention, closed)', () => {
  it('WITHOUT the overlay the seeder is rejected (the cold-start abstention, reproduced)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phx-route-contract-'));
    writeFileSync(join(dir, 'app.mjs'), habitApp(), 'utf8');
    const { id, ctx } = await trySeed(dir, input(false, habitApp()));
    expect(id).toBeUndefined();
    expect(ctx.unseedable.some(u => /rejected/.test(u.reason)), JSON.stringify(ctx.unseedable)).toBe(true);
  }, 60_000);

  it('WITH the overlay the same route accepts the synthesized body and returns a real id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phx-route-contract-'));
    writeFileSync(join(dir, 'app.mjs'), habitApp(), 'utf8');
    const { id, ctx } = await trySeed(dir, input(true, habitApp()));
    expect(ctx.unseedable, JSON.stringify(ctx.unseedable)).toEqual([]);
    expect(id, 'a real id from the live create route').toBeTypeOf('number');
  }, 60_000);

  it('the overlay reads its facts from the module source it is given (named consts resolved)', () => {
    const c = parseRouteContract(habitApp());
    expect(c.get('tags')?.csvMinParts).toBe(2);
    expect(c.get('priority')?.enumValues).toEqual(['low', 'high']);
    expect(c.get('name')?.optional).toBe(false);
    expect(singularize('habits')).toBe('habit');
  });
});

/** The afterimage match/ensemble shape: the DDL declares NO foreign keys, but the routes
 *  validate `<entity>_id` existence themselves — a route-level FK only the contract sees. */
/** The per-module create-schema texts (what each generated module file would carry) —
 *  parsed separately by the overlay, exactly like buildSeedPrepare reads each IU file. */
const PLAYER_SCHEMA_TEXT = 'const CreatePlayerSchema = z.object({ name: z.string().min(1) });';
function ensembleSchemaText(withMusicianIds: boolean): string {
  const musicianField = withMusicianIds ? '\n  musician_ids: z.array(z.number().int()).min(2),' : '';
  return `const CreateEnsembleSchema = z.object({
  player_id: z.number().int(),
  name: z.string().min(1).max(60),${musicianField}
});`;
}

function ensembleApp(opts: { withMusicianIds: boolean }): string {
  const musicianCheck = opts.withMusicianIds ? `
      const mids = b.musician_ids;
      if (!Array.isArray(mids) || mids.length < 2) return send(400, { error: 'an ensemble needs at least 2 musicians' });
      for (const pid of mids) {
        if (!db.prepare('SELECT id FROM players WHERE id = ?').get(pid)) return send(400, { error: 'Player ' + pid + ' not found' });
      }` : '';
  return `import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.env.DB_PATH ?? ':memory:');
db.exec("CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS ensembles (id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER NOT NULL, name TEXT NOT NULL)");

/*
${PLAYER_SCHEMA_TEXT}
${ensembleSchemaText(opts.withMusicianIds)}
*/

async function readBody(req) { let s = ''; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; }

const server = createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    if (url === '/health') return send(200, { status: 'ok' });
    if (url === '/player' && req.method === 'POST') {
      const b = await readBody(req);
      if (!String(b.name ?? '')) return send(400, { error: 'name is required' });
      const info = db.prepare('INSERT INTO players (name) VALUES (?)').run(String(b.name));
      return send(201, { id: info.lastInsertRowid });
    }
    if (url === '/ensemble' && req.method === 'POST') {
      const b = await readBody(req);
      if (!String(b.name ?? '')) return send(400, { error: 'name is required' });
      if (!db.prepare('SELECT id FROM players WHERE id = ?').get(Number(b.player_id))) return send(400, { error: 'Player not found' });${musicianCheck}
      const info = db.prepare('INSERT INTO ensembles (player_id, name) VALUES (?, ?)').run(Number(b.player_id), String(b.name));
      return send(201, { id: info.lastInsertRowid });
    }
    return send(404, { error: 'not found' });
  } catch (e) { return send(500, { error: String(e) }); }
});
server.listen(parseInt(process.env.PORT || '3000', 10), () => console.error('ready'));
`;
}

const ENSEMBLE_DDL = [
  "CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS ensembles (id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER NOT NULL, name TEXT NOT NULL)",
].join('\n');

function ensembleInput(withOverlay: boolean, withMusicianIds: boolean): SeedPlanInput {
  const tables = parseTableSchemas(ENSEMBLE_DDL);
  const perTable = withOverlay
    ? new Map([
        ['players', parseRouteContract(PLAYER_SCHEMA_TEXT)],
        ['ensembles', parseRouteContract(ensembleSchemaText(withMusicianIds))],
      ])
    : undefined;
  return {
    tables, constraints: [],
    routeFor: (t) => (t === 'players' ? '/player' : t === 'ensembles' ? '/ensemble' : null),
    contractFor: perTable ? (t) => perTable.get(t) : undefined,
  };
}

describe('e2e: route-level FKs the DDL never declares (the afterimage chain)', () => {
  it('WITHOUT the overlay the invented player_id is rejected (route-level FK invisible to the DDL)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phx-route-fk-'));
    const src = ensembleApp({ withMusicianIds: false });
    writeFileSync(join(dir, 'app.mjs'), src, 'utf8');
    const { id, ctx } = await trySeedEnsemble(dir, ensembleInput(false, false));
    expect(id).toBeUndefined();
    expect(ctx.unseedable.some(u => /rejected/.test(u.reason)), JSON.stringify(ctx.unseedable)).toBe(true);
  }, 60_000);

  it('WITH the overlay the FK hint seeds a real player first and the ensemble create succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phx-route-fk-'));
    const src = ensembleApp({ withMusicianIds: false });
    writeFileSync(join(dir, 'app.mjs'), src, 'utf8');
    const { id, ctx } = await trySeedEnsemble(dir, ensembleInput(true, false));
    expect(ctx.unseedable, JSON.stringify(ctx.unseedable)).toEqual([]);
    expect(id, 'ensemble id from the live route').toBeTypeOf('number');
  }, 60_000);

  it('the array-FK frontier abstains EARLY with a precise reason (never an invented id)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phx-route-fk-'));
    const src = ensembleApp({ withMusicianIds: true });
    writeFileSync(join(dir, 'app.mjs'), src, 'utf8');
    const { id, ctx } = await trySeedEnsemble(dir, ensembleInput(true, true));
    expect(id).toBeUndefined();
    const u = ctx.unseedable.find(u => /existing id/.test(u.reason));
    expect(u, JSON.stringify(ctx.unseedable)).toBeDefined();
    expect(u!.reason).toContain('musician_ids');
    expect(u!.reason).toContain('frontier');
  }, 60_000);
});

async function trySeedEnsemble(dir: string, inp: SeedPlanInput): Promise<{ id?: number; ctx: SeedContext }> {
  const app = await bootApp({ projectRoot: dir, command: ['node', 'app.mjs'], readyTimeoutMs: 12_000 });
  try {
    const ctx: SeedContext = { ids: new Map(), unseedable: [] };
    const id = await seedTable(app, 'ensembles', inp, new Map(), makeSeededRng(), ctx);
    return { id, ctx };
  } finally {
    await app.stop();
  }
}
