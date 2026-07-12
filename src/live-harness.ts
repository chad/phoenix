/**
 * The live application harness — the oracle's live path for modules that cannot be
 * executed in a sandbox because they import their world (a DB, an HTTP framework).
 *
 * `src/constraints/exec-runner.ts` PROVES aggregate invariants for SELF-CONTAINED
 * modules (pure functions over data) and earns `conforms` through a mutation gate. Its
 * honest limit: a real generated module `import`s `../../db.js` and `hono`, so it can
 * only be exercised by standing its dependencies up and driving it. This harness is the
 * big sibling that does exactly that — with the SAME gate philosophy:
 *
 *   1. Boot the app for real (a child process running the actual entrypoint) against an
 *      ISOLATED database (a fresh temp file per boot — never the project's `data/`).
 *   2. Drive it through its own HTTP surface: seed via its POST routes, read its
 *      aggregate/read routes, attack its write routes. Real requests, deterministic
 *      seeded inputs.
 *   3. EARN `behavioral-gated` conforms through the mutation gate: plant a bug in the
 *      governing module (strip the guard, flip the comparison, break the aggregate),
 *      re-boot, re-drive — every APPLICABLE mutant must FAIL the eval. An eval too weak
 *      to catch a planted bug certifies nothing → it degrades to `indeterminate`.
 *
 * Honesty discipline (matches the rest of the codebase): if the app cannot be booted,
 * or a live eval cannot be driven with confidence, the harness ABSTAINS (indeterminate
 * with the reason) rather than guessing a green. `behavioral-gated` is only ever emitted
 * for a baseline pass that survived a real, non-empty mutation gate.
 *
 * The boot is ALWAYS a real child process — there is no stubbed execution path. The only
 * thing that varies is WHICH command boots the app: `npx tsx src/server.ts` for a real
 * generated project, `node app.mjs` for the harness's own self-verification fixture.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Boot ─────────────────────────────────────────────────────────────────────

export interface BootSpec {
  /** Directory the command runs in (the generated project root). */
  projectRoot: string;
  /** argv of the boot command, e.g. ['npx','tsx','src/server.ts'] or ['node','app.mjs']. */
  command: readonly string[];
  /** Health route that returns 200 once the app is ready (default '/health'). */
  healthPath?: string;
  /** Milliseconds to wait for the first healthy response (default 10000). */
  readyTimeoutMs?: number;
  /** Extra env for the child (merged over process.env + the isolated DB_PATH + PORT). */
  env?: Record<string, string>;
}

export interface AppHandle {
  baseUrl: string;
  port: number;
  /** The isolated DB file this boot wrote to (temp — safe to discard). */
  dbPath: string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  stop(): Promise<void>;
}

/** Thrown when the app cannot be booted (→ an honest `indeterminate`, never a green). */
export class BootError extends Error {
  constructor(message: string, readonly stderr = '') { super(message); this.name = 'BootError'; }
}

/** Grab an ephemeral free TCP port from the OS (bind :0, read it, release). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, () => {
      const addr = s.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      s.close(() => (port ? resolve(port) : reject(new Error('no port'))));
    });
  });
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Boot the app as a child process on a free port with an isolated DB, and wait until
 * its health route answers 200. Throws BootError (with captured stderr) if it never
 * becomes healthy or exits early — the caller turns that into an honest abstention.
 */
export async function bootApp(spec: BootSpec): Promise<AppHandle> {
  const port = await freePort();
  const dbPath = join(mkdtempSync(join(tmpdir(), 'phx-live-db-')), 'app.db');
  const healthPath = spec.healthPath ?? '/health';
  const timeout = spec.readyTimeoutMs ?? 10_000;

  const child = spawn(spec.command[0], spec.command.slice(1), {
    cwd: spec.projectRoot,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', d => { stderr += d.toString(); });
  child.stdout?.on('data', () => { /* drain so the pipe never blocks the child */ });

  const state: { exited: { code: number | null } | null } = { exited: null };
  child.on('exit', code => { state.exited = { code }; });

  const baseUrl = `http://127.0.0.1:${port}`;
  const stop = async (): Promise<void> => {
    if (state.exited) return;
    child.kill('SIGKILL');
    for (let i = 0; i < 40 && !state.exited; i++) await sleep(25);
  };

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (state.exited) {
      await stop();
      throw new BootError(`app exited before becoming healthy (code ${state.exited.code})`, stderr);
    }
    try {
      const res = await fetch(baseUrl + healthPath, { signal: AbortSignal.timeout(1000) });
      if (res.status === 200) {
        return {
          baseUrl, port, dbPath,
          fetch: (path, init) => fetch(baseUrl + path, init),
          stop,
        };
      }
    } catch { /* not up yet */ }
    await sleep(80);
  }
  await stop();
  throw new BootError(`app did not become healthy within ${timeout}ms`, stderr);
}

// ─── Deterministic inputs ───────────────────────────────────────────────────

/** Fixed-seed LCG — deterministic non-negative ints in [0, max). Reproducible verdicts. */
function makeRng(seed = 0x5EED): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

// ─── Live evals (driving plans over the HTTP surface) ────────────────────────

export type LiveProbeStatus = 'pass' | 'fail' | 'indeterminate';
export interface LiveProbe { status: LiveProbeStatus; reason: string; }

/**
 * An aggregate-equality eval: seed entities via a POST route carrying a numeric field,
 * then read an aggregate route and assert it equals the sum of the values the app
 * ACCEPTED. "= sum of what was accepted" (not what was sent) keeps the eval honest even
 * when the app legitimately rejects some inputs.
 */
export interface AggregatePlan {
  kind: 'aggregate';
  seedRoute: string;         // e.g. '/account'
  seedField: string;         // body field summed, e.g. 'balance'
  extraBody?: Record<string, unknown>;
  aggregateRoute: string;    // e.g. '/dashboard'
  aggregateField: string;    // response field, e.g. 'total'
}

/**
 * A state-invariant eval ("a balance must never go below zero"): attack a write route
 * with a value that would break the invariant and assert the app REJECTS it (4xx) and
 * the read side still shows the invariant preserved.
 */
export interface StateNonNegPlan {
  kind: 'state-nonneg';
  writeRoute: string;        // POST that could drive the value negative
  field: string;             // the governed numeric field
  extraBody?: Record<string, unknown>;
  readRoute: string;         // route to confirm the invariant held
  readField: string;         // non-negative field in the read response
}

/** A temporal eval ("a date must not be in the future"): POST a future date, expect 400. */
export interface TemporalPlan {
  kind: 'temporal';
  writeRoute: string;
  dateField: string;
  extraBody?: Record<string, unknown>;
}

export type LivePlan = AggregatePlan | StateNonNegPlan | TemporalPlan;

async function jsonPost(app: AppHandle, path: string, body: unknown): Promise<Response> {
  return app.fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Drive one live plan against a booted app. Returns pass/fail/indeterminate. */
export async function driveLivePlan(app: AppHandle, plan: LivePlan): Promise<LiveProbe> {
  try {
    if (plan.kind === 'aggregate') return await driveAggregate(app, plan);
    if (plan.kind === 'state-nonneg') return await driveStateNonNeg(app, plan);
    return await driveTemporal(app, plan);
  } catch (e) {
    return { status: 'indeterminate', reason: `driving error: ${(e as Error).message}` };
  }
}

async function driveAggregate(app: AppHandle, plan: AggregatePlan): Promise<LiveProbe> {
  const rng = makeRng();
  let acceptedSum = 0;
  let accepted = 0;
  for (let i = 0; i < 12; i++) {
    const value = rng() % 1000; // deterministic non-negative values
    const res = await jsonPost(app, plan.seedRoute, { ...plan.extraBody, [plan.seedField]: value });
    if (res.status >= 200 && res.status < 300) { acceptedSum += value; accepted++; }
  }
  if (accepted === 0) return { status: 'indeterminate', reason: `seed route ${plan.seedRoute} accepted nothing` };
  const res = await app.fetch(plan.aggregateRoute);
  if (res.status !== 200) return { status: 'indeterminate', reason: `aggregate route ${plan.aggregateRoute} returned ${res.status}` };
  const body = await res.json() as Record<string, unknown>;
  const got = pickNumber(body, plan.aggregateField);
  if (got === undefined) return { status: 'indeterminate', reason: `no numeric "${plan.aggregateField}" in aggregate response` };
  return got === acceptedSum
    ? { status: 'pass', reason: `${plan.aggregateField}=${got} equals the sum of ${accepted} accepted ${plan.seedField}s` }
    : { status: 'fail', reason: `${plan.aggregateField}=${got} but the sum of accepted ${plan.seedField}s is ${acceptedSum}` };
}

async function driveStateNonNeg(app: AppHandle, plan: StateNonNegPlan): Promise<LiveProbe> {
  // The attack: write a value that would take the governed field below zero.
  const res = await jsonPost(app, plan.writeRoute, { ...plan.extraBody, [plan.field]: -999 });
  const rejected = res.status >= 400 && res.status < 500;
  // Confirm the invariant is preserved on the read side (no negative slipped through).
  const read = await app.fetch(plan.readRoute);
  let preserved = true;
  if (read.status === 200) {
    const body = await read.json();
    preserved = everyNumberSatisfies(body, plan.readField, v => v >= 0);
  }
  if (rejected && preserved) return { status: 'pass', reason: `overdraft attack on ${plan.writeRoute} rejected (${res.status}); ${plan.readField} stayed ≥ 0` };
  return { status: 'fail', reason: `overdraft attack on ${plan.writeRoute} ${rejected ? 'rejected' : `ACCEPTED (${res.status})`}; invariant ${preserved ? 'held' : 'BROKEN'} on read` };
}

async function driveTemporal(app: AppHandle, plan: TemporalPlan): Promise<LiveProbe> {
  const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const res = await jsonPost(app, plan.writeRoute, { ...plan.extraBody, [plan.dateField]: future });
  return res.status === 400
    ? { status: 'pass', reason: `future ${plan.dateField} (${future}) rejected with 400` }
    : { status: 'fail', reason: `future ${plan.dateField} (${future}) accepted with ${res.status} (expected 400)` };
}

function pickNumber(body: unknown, field: string): number | undefined {
  if (body && typeof body === 'object') {
    const v = (body as Record<string, unknown>)[field];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** Whether every occurrence of `field` (in an object or array of objects) satisfies `ok`. */
function everyNumberSatisfies(body: unknown, field: string, ok: (v: number) => boolean): boolean {
  const rows = Array.isArray(body) ? body : [body];
  for (const row of rows) {
    const v = pickNumber(row, field);
    if (v !== undefined && !ok(v)) return false;
  }
  return true;
}

// ─── The mutation gate ───────────────────────────────────────────────────────

/** A planted bug on a governing module's source: returns mutated source, or null when
 *  the pattern does not apply (so we never count a no-op as a killed mutant). */
export interface LiveMutation { name: string; apply: (src: string) => string | null; }

/** Strip the first guard line that rejects the invariant-breaking input (the canonical
 *  "delete the check" bug). Matches a line that both compares against 0 / a bound AND
 *  short-circuits (return/throw) — the shape of a rejecting guard. */
const stripNegativeGuard: LiveMutation = {
  name: 'strip-negative-guard',
  apply: (src) => {
    const lines = src.split('\n');
    const idx = lines.findIndex(l => /[<>]=?\s*0\b/.test(l) && /(return|throw)/.test(l));
    if (idx < 0) return null;
    lines.splice(idx, 1);
    return lines.join('\n');
  },
};

/** Flip the comparison in a rejecting guard (`< 0` → `>= 0`) so it rejects the wrong side. */
const flipComparison: LiveMutation = {
  name: 'flip-comparison',
  apply: (src) => {
    const m = src.replace(/([^<>=!])<\s*0\b/, '$1>= 0');
    return m === src ? null : m;
  },
};

/** Break an aggregate: SUM(...) → MAX(...) in a SQL string, or the reduce `+` → `-`. */
const breakAggregate: LiveMutation = {
  name: 'break-aggregate',
  apply: (src) => {
    let m = src.replace(/\bSUM\s*\(/i, 'MAX(');
    if (m !== src) return m;
    m = src.replace(/([\w)\]])\s*\+\s*([\w(.$])/, '$1 - $2');
    return m === src ? null : m;
  },
};

/** Strip a temporal (future/past) guard line. */
const stripTemporalGuard: LiveMutation = {
  name: 'strip-temporal-guard',
  apply: (src) => {
    const lines = src.split('\n');
    const idx = lines.findIndex(l => /future|past/i.test(l) && /(return|throw|400|refine|>|<)/.test(l));
    if (idx < 0) return null;
    lines.splice(idx, 1);
    return lines.join('\n');
  },
};

/** The mutations relevant to each eval kind (a strong gate has ≥ 2 applicable). */
function mutationsFor(kind: LivePlan['kind']): LiveMutation[] {
  if (kind === 'aggregate') return [breakAggregate];
  if (kind === 'state-nonneg') return [stripNegativeGuard, flipComparison];
  return [stripTemporalGuard];
}

export interface GatedLiveResult {
  status: LiveProbeStatus;
  /** True only when the baseline passed AND every applicable planted mutant was killed. */
  gated: boolean;
  method: 'behavioral-gated';
  reason: string;
  mutantsApplicable: number;
  mutantsKilled: number;
}

export interface GatedLiveInput {
  /** How to boot the app (same command used for baseline and every mutant re-boot). */
  bootSpec: BootSpec;
  /** The eval to drive. */
  plan: LivePlan;
  /** Repo-relative path (under projectRoot) of the module whose guard the gate mutates. */
  targetFile: string;
}

/**
 * Run a live eval and, if it passes, EARN `behavioral-gated` through the mutation gate.
 * For each applicable mutation of the target module: write the mutant, re-boot (fresh
 * DB), re-drive — the mutant MUST make the eval fail (or not boot). A surviving mutant
 * means the eval is too weak to certify anything → `indeterminate`. The original file is
 * always restored.
 */
export async function runGatedLiveEval(input: GatedLiveInput): Promise<GatedLiveResult> {
  const { bootSpec, plan, targetFile } = input;
  const full = join(bootSpec.projectRoot, targetFile);
  const wrap = (status: LiveProbeStatus, reason: string, gated: boolean, applicable = 0, killed = 0): GatedLiveResult =>
    ({ status, gated, method: 'behavioral-gated', reason, mutantsApplicable: applicable, mutantsKilled: killed });

  // 1) Baseline: boot the real app and drive the eval.
  let baseline: LiveProbe;
  {
    let app: AppHandle | null = null;
    try { app = await bootApp(bootSpec); }
    catch (e) {
      const be = e as BootError;
      return wrap('indeterminate', `could not boot the app: ${be.message}${be.stderr ? ` — ${be.stderr.trim().slice(-200)}` : ''}`, false);
    }
    try { baseline = await driveLivePlan(app, plan); }
    finally { await app.stop(); }
  }
  if (baseline.status !== 'pass') {
    // A failing/abstaining baseline is reported as-is (no gate — nothing to certify).
    return wrap(baseline.status, baseline.reason, false);
  }

  // 2) The mutation gate: plant each applicable bug, re-boot, require the eval to catch it.
  const original = readFileSync(full, 'utf8');
  let applicable = 0;
  let killed = 0;
  try {
    for (const mu of mutationsFor(plan.kind)) {
      const mutated = mu.apply(original);
      if (mutated === null || mutated === original) continue; // pattern didn't apply — not counted
      applicable++;
      writeFileSync(full, mutated, 'utf8');
      let app: AppHandle | null = null;
      try { app = await bootApp(bootSpec); }
      catch {
        // A mutant that won't even boot is a killed mutant (the bug broke the app).
        killed++;
        continue;
      }
      let probe: LiveProbe;
      try { probe = await driveLivePlan(app, plan); }
      finally { await app.stop(); }
      if (probe.status === 'pass') {
        return wrap('indeterminate',
          `mutation gate too weak: planted bug "${mu.name}" survived the live eval`, false, applicable, killed);
      }
      killed++; // fail or indeterminate → the bug was noticed
    }
  } finally {
    writeFileSync(full, original, 'utf8'); // always restore
  }

  if (applicable === 0) {
    return wrap('indeterminate', 'mutation gate did not apply: no killable bug could be planted in the target module', false, 0, 0);
  }
  return wrap('pass',
    `${baseline.reason}; mutation gate killed ${killed}/${applicable} planted bug(s)`, true, applicable, killed);
}

// ─── Self-verification fixture ───────────────────────────────────────────────

/**
 * The canonical minimal REAL app the harness verifies itself against — a genuine
 * `node:http` server backed by a genuine `node:sqlite` database (a module WITH external
 * dependencies and persistent state, exactly the shape exec-runner must refuse). It
 * carries all three governed invariants so a single fixture exercises every eval kind
 * and every mutation:
 *   - aggregate:  GET /dashboard total = SUM(balance)
 *   - state:      POST /account rejects a negative balance (the guard the gate strips)
 *   - temporal:   POST /txn rejects a future date
 * Hermetic (no npm install), so it runs inside `phoenix selftest` and the test suite.
 */
export function referenceApp(): string {
  return `import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.env.DB_PATH ?? ':memory:');
db.exec('CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, balance INTEGER NOT NULL DEFAULT 0)');
db.exec('CREATE TABLE IF NOT EXISTS txns (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL)');

async function readBody(req) { let s = ''; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; }

const server = createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    if (url === '/health') return send(200, { status: 'ok' });
    if (url === '/account' && req.method === 'POST') {
      const b = await readBody(req);
      const balance = Number(b.balance) || 0;
      if (balance < 0) return send(400, { error: 'balance must not be negative' });
      const info = db.prepare('INSERT INTO accounts (balance) VALUES (?)').run(balance);
      return send(201, { id: info.lastInsertRowid, balance });
    }
    if (url === '/dashboard') {
      const row = db.prepare('SELECT SUM(balance) AS total FROM accounts').get();
      return send(200, { total: row.total ?? 0 });
    }
    if (url === '/accounts') {
      return send(200, db.prepare('SELECT id, balance FROM accounts').all());
    }
    if (url === '/txn' && req.method === 'POST') {
      const b = await readBody(req);
      const date = String(b.date ?? '');
      if (date && date > new Date().toISOString().slice(0, 10)) return send(400, { error: 'date must not be in the future' });
      const info = db.prepare('INSERT INTO txns (date) VALUES (?)').run(date);
      return send(201, { id: info.lastInsertRowid, date });
    }
    return send(404, { error: 'not found' });
  } catch (e) { return send(500, { error: String(e) }); }
});
server.listen(parseInt(process.env.PORT || '3000', 10), () => console.error('ready'));
`;
}

/** The reference app's three live plans (aggregate + state + temporal), for self-verification. */
export function referencePlans(): { plan: LivePlan; label: string }[] {
  return [
    { label: 'aggregate', plan: { kind: 'aggregate', seedRoute: '/account', seedField: 'balance', aggregateRoute: '/dashboard', aggregateField: 'total' } },
    { label: 'state-nonneg', plan: { kind: 'state-nonneg', writeRoute: '/account', field: 'balance', readRoute: '/accounts', readField: 'balance' } },
    { label: 'temporal', plan: { kind: 'temporal', writeRoute: '/txn', dateField: 'date' } },
  ];
}
