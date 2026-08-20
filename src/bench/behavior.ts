/**
 * The shared behavioural oracle — the one rung on which all three arms are comparable.
 *
 * Whoever wrote the code (Phoenix's pipeline, a single model call, or a model given one
 * sentence), the question asked of the result is identical: boot it for real, drive it
 * over HTTP, assert against the responses.
 *
 * Three outcomes, kept apart on purpose:
 *
 *   working    every assertion held
 *   disagreed  it booted and answered, and failed at least one assertion
 *   broke      a phase died — it never built, never booted, or stopped answering
 *
 * Reducing these to one number would merge "the generator produced nothing runnable"
 * with "the generator produced something subtly wrong", and those are different
 * findings with different fixes. The failed assertions are named in the record, so a
 * `disagreed` sample can be read rather than guessed at.
 *
 * The oracle never sees which arm produced the code, and imports nothing from the
 * pipeline. It gets a directory and a runtime contract.
 */

import { bootApp, BootError, type AppHandle } from '../live-harness.js';
import type { BenchCase, BenchCheck, JsonAssertion } from './case.js';

export type BehaviorOutcome = 'working' | 'disagreed' | 'broke';

export interface BehaviorResult {
  readonly outcome: BehaviorOutcome;
  /** Checks attempted. 0 when the app never booted. */
  readonly checks: number;
  readonly passed: number;
  /** Names of the checks that failed, verbatim from the case. */
  readonly failed: readonly string[];
  /** Why it broke, when it did. */
  readonly reason?: string;
  readonly elapsedMs: number;
}

// ─── Assertions ──────────────────────────────────────────────────────────────

/** Resolve a dotted path with `[n]` indexing against a decoded body. */
export function resolvePath(body: unknown, path: string): unknown {
  if (path === '' || path === '$') return body;
  let cur: unknown = body;
  for (const rawSeg of path.split('.')) {
    const m = /^([^[\]]*)((\[\d+\])*)$/.exec(rawSeg);
    if (!m) return undefined;
    const [, key, idx] = m;
    if (key) {
      if (cur === null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[key];
    }
    if (idx) {
      for (const g of idx.matchAll(/\[(\d+)\]/g)) {
        if (!Array.isArray(cur)) return undefined;
        cur = cur[Number(g[1])];
      }
    }
  }
  return cur;
}

/** Evaluate one assertion. Returns null on success, or a short reason on failure. */
export function checkAssertion(body: unknown, a: JsonAssertion): string | null {
  const actual = resolvePath(body, a.path);
  const show = (v: unknown): string => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s === undefined ? 'undefined' : s.length > 60 ? s.slice(0, 57) + '…' : s;
  };
  switch (a.op) {
    case 'equals':
      return JSON.stringify(actual) === JSON.stringify(a.value) ? null : `${a.path}: ${show(actual)} ≠ ${show(a.value)}`;
    case 'gte':
      return typeof actual === 'number' && actual >= Number(a.value) ? null : `${a.path}: ${show(actual)} not ≥ ${show(a.value)}`;
    case 'lte':
      return typeof actual === 'number' && actual <= Number(a.value) ? null : `${a.path}: ${show(actual)} not ≤ ${show(a.value)}`;
    case 'contains': {
      if (typeof actual === 'string') return actual.includes(String(a.value)) ? null : `${a.path}: ${show(actual)} lacks ${show(a.value)}`;
      if (Array.isArray(actual)) {
        const want = JSON.stringify(a.value);
        return actual.some(v => JSON.stringify(v) === want) ? null : `${a.path}: array lacks ${show(a.value)}`;
      }
      return `${a.path}: ${show(actual)} is not a string or array`;
    }
    case 'type': {
      const t = Array.isArray(actual) ? 'array' : actual === null ? 'null' : typeof actual;
      return t === a.value ? null : `${a.path}: type ${t} ≠ ${String(a.value)}`;
    }
    case 'notEmpty': {
      const empty = actual === undefined || actual === null || actual === ''
        || (Array.isArray(actual) && actual.length === 0);
      return empty ? `${a.path}: empty` : null;
    }
    case 'absent':
      return actual === undefined ? null : `${a.path}: present (${show(actual)})`;
    case 'oneOf': {
      const set = Array.isArray(a.value) ? a.value : [];
      return set.some(v => JSON.stringify(v) === JSON.stringify(actual)) ? null : `${a.path}: ${show(actual)} not one of ${show(set)}`;
    }
    default:
      return `unknown assertion op ${String((a as JsonAssertion).op)}`;
  }
}

/** Substitute `{name}` bindings saved by earlier checks. */
export function interpolate(s: string, vars: Record<string, unknown>): string {
  return s.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole);
}

function interpolateBody(body: unknown, vars: Record<string, unknown>): unknown {
  if (typeof body === 'string') return interpolate(body, vars);
  if (Array.isArray(body)) return body.map(v => interpolateBody(v, vars));
  if (body && typeof body === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) out[k] = interpolateBody(v, vars);
    return out;
  }
  return body;
}

// ─── Driving ─────────────────────────────────────────────────────────────────

/** Run the case's checks against an already-booted app. Never throws. */
export async function driveChecks(app: AppHandle, checks: readonly BenchCheck[]): Promise<{
  passed: number; failed: string[]; broke?: string;
}> {
  const vars: Record<string, unknown> = {};
  const failed: string[] = [];
  let passed = 0;

  for (const check of checks) {
    let res: Response;
    try {
      const path = interpolate(check.path, vars);
      const body = check.body === undefined ? undefined : interpolateBody(check.body, vars);
      res = await app.fetch(path, {
        method: check.method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      // The app stopped answering mid-suite: the run broke, it did not disagree.
      return { passed, failed, broke: `request failed at "${check.name}": ${(e as Error).message}` };
    }

    let decoded: unknown;
    const text = await res.text().catch(() => '');
    try { decoded = text ? JSON.parse(text) : undefined; } catch { decoded = text; }

    const reasons: string[] = [];
    if (check.status !== undefined) {
      const want = Array.isArray(check.status) ? check.status : [check.status];
      if (!want.includes(res.status)) reasons.push(`status ${res.status} ∉ ${JSON.stringify(want)}`);
    }
    for (const a of check.json ?? []) {
      const r = checkAssertion(decoded, a);
      if (r) reasons.push(r);
    }

    if (reasons.length === 0) {
      passed++;
      for (const [name, path] of Object.entries(check.save ?? {})) {
        vars[name] = resolvePath(decoded, path);
      }
    } else {
      failed.push(check.name);
    }
  }

  return { passed, failed };
}

/**
 * Boot a produced application and assert against it.
 *
 * `env` carries the workspace PATH so the sample can find its own toolchain; the DB is
 * isolated per boot by the live harness (a fresh temp file), so no sample can see
 * another's state.
 */
export async function runBehavior(
  projectRoot: string,
  bench: BenchCase,
  env: Record<string, string> = {},
): Promise<BehaviorResult> {
  const started = Date.now();
  let app: AppHandle;
  try {
    app = await bootApp({
      projectRoot,
      command: bench.runtime.command,
      healthPath: bench.runtime.healthPath,
      readyTimeoutMs: bench.runtime.readyTimeoutMs,
      env,
    });
  } catch (e) {
    const err = e as BootError;
    // Keep the lines a human would read. A raw tail of stderr is almost always four
    // frames of `at async …`, which says a process died and nothing about why.
    const stderr = (err.stderr ?? '')
      .split('\n')
      .map(l => l.trimEnd())
      .filter(l => l.trim() !== '' && !/^\s*at\s/.test(l) && !/^Node\.js v/.test(l))
      .slice(-4)
      .join(' | ')
      .slice(0, 400);
    return {
      outcome: 'broke',
      checks: 0,
      passed: 0,
      failed: [],
      reason: `${err.message}${stderr ? ` — ${stderr}` : ''}`,
      elapsedMs: Date.now() - started,
    };
  }

  try {
    const { passed, failed, broke } = await driveChecks(app, bench.checks);
    if (broke) {
      return { outcome: 'broke', checks: bench.checks.length, passed, failed, reason: broke, elapsedMs: Date.now() - started };
    }
    return {
      outcome: failed.length === 0 ? 'working' : 'disagreed',
      checks: bench.checks.length,
      passed,
      failed,
      elapsedMs: Date.now() - started,
    };
  } finally {
    await app.stop();
  }
}
