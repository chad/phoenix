import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolvePath, checkAssertion, interpolate, runBehavior } from '../../src/bench/behavior.js';
import type { BenchCase, BenchCheck } from '../../src/bench/case.js';

describe('assertion primitives', () => {
  it('resolves dotted paths and array indices', () => {
    const body = { a: { b: [{ c: 7 }] }, list: [1, 2, 3] };
    expect(resolvePath(body, 'a.b[0].c')).toBe(7);
    expect(resolvePath(body, 'list.length')).toBe(3);
    expect(resolvePath(body, '[0]')).toBeUndefined();
    expect(resolvePath(body, '')).toBe(body);
    expect(resolvePath(body, 'nope.deeper')).toBeUndefined();
  });

  it('distinguishes JSON false from 0 — the SQLite boolean trap', () => {
    expect(checkAssertion({ completed: false }, { path: 'completed', op: 'equals', value: false })).toBeNull();
    expect(checkAssertion({ completed: 0 }, { path: 'completed', op: 'equals', value: false })).toMatch(/completed/);
  });

  it('reports a reason rather than a boolean, so a failure can be read', () => {
    const r = checkAssertion({ total: 1 }, { path: 'total', op: 'equals', value: 2 });
    expect(r).toContain('total');
    expect(r).toContain('2');
  });

  it('notEmpty rejects missing, empty string and empty array', () => {
    for (const v of [undefined, null, '', []]) {
      expect(checkAssertion({ x: v }, { path: 'x', op: 'notEmpty' })).not.toBeNull();
    }
    expect(checkAssertion({ x: 'a' }, { path: 'x', op: 'notEmpty' })).toBeNull();
  });

  it('interpolates saved bindings into later paths', () => {
    expect(interpolate('/tasks/{id}', { id: 12 })).toBe('/tasks/12');
    expect(interpolate('/tasks/{missing}', {})).toBe('/tasks/{missing}');
  });
});

// ─── The oracle against real, booted processes ───────────────────────────────

function appDir(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'phx-bench-oracle-'));
  writeFileSync(join(dir, 'app.mjs'), source, 'utf8');
  return dir;
}

const CHECKS: BenchCheck[] = [
  { name: 'health answers 200', method: 'GET', path: '/health', status: 200 },
  {
    name: 'create returns 201',
    method: 'POST', path: '/tasks', body: { title: 'x' }, status: 201,
    json: [{ path: 'title', op: 'equals', value: 'x' }],
    save: { id: 'id' },
  },
  {
    name: 'the created task can be read back',
    method: 'GET', path: '/tasks/{id}', status: 200,
    json: [{ path: 'title', op: 'equals', value: 'x' }],
  },
];

function benchWith(checks: BenchCheck[]): BenchCase {
  return {
    id: 'oracle-fixture',
    title: 'oracle fixture',
    arch: 'sqlite-web-api',
    intent: 'fixture',
    runtime: {
      command: ['node', 'app.mjs'],
      healthPath: '/health',
      readyTimeoutMs: 10_000,
      brief: 'fixture',
      dependencies: {},
    },
    perSampleMs: 1000,
    spec: [['fixture.md', '# fixture']],
    checks,
    digest: 'fixture',
    dir: '/dev/null',
  };
}

const WORKING_APP = `
import { createServer } from 'node:http';
const tasks = new Map(); let next = 1;
createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const json = (code, v) => { res.writeHead(code, {'content-type':'application/json'}); res.end(JSON.stringify(v)); };
    if (url.pathname === '/health') return json(200, { ok: true });
    if (url.pathname === '/tasks' && req.method === 'POST') {
      const t = { id: next++, title: JSON.parse(body || '{}').title };
      tasks.set(t.id, t);
      return json(201, t);
    }
    const m = /^\\/tasks\\/(\\d+)$/.exec(url.pathname);
    if (m) {
      const t = tasks.get(Number(m[1]));
      return t ? json(200, t) : json(404, { error: 'not found' });
    }
    json(404, { error: 'no route' });
  });
}).listen(Number(process.env.PORT));
`;

// Boots and answers, but the read-back returns the wrong title: disagreed, not broke.
const WRONG_APP = WORKING_APP.replace('return t ? json(200, t)', 'return t ? json(200, { ...t, title: "wrong" })');

const CRASHING_APP = `throw new Error('this generator produced nothing runnable');`;

describe('runBehavior — the shared oracle', () => {
  it('an app that satisfies every check is working', async () => {
    const r = await runBehavior(appDir(WORKING_APP), benchWith(CHECKS));
    expect(r.outcome).toBe('working');
    expect(r.passed).toBe(CHECKS.length);
    expect(r.failed).toEqual([]);
  }, 30_000);

  it('an app that boots and answers wrongly DISAGREED — it did not break', async () => {
    const r = await runBehavior(appDir(WRONG_APP), benchWith(CHECKS));
    expect(r.outcome).toBe('disagreed');
    expect(r.failed).toEqual(['the created task can be read back']);
    expect(r.passed).toBe(2);
  }, 30_000);

  it('an app that never boots BROKE, with a reason and zero checks attempted', async () => {
    const r = await runBehavior(appDir(CRASHING_APP), benchWith(CHECKS));
    expect(r.outcome).toBe('broke');
    expect(r.checks).toBe(0);
    expect(r.passed).toBe(0);
    expect(r.reason).toBeTruthy();
    expect(r.reason).toContain('nothing runnable');
  }, 30_000);

  it('saved bindings flow between checks, so state is really exercised', async () => {
    const r = await runBehavior(appDir(WORKING_APP), benchWith([
      ...CHECKS,
      { name: 'a second create gets a distinct id', method: 'POST', path: '/tasks', body: { title: 'y' }, status: 201, json: [{ path: 'id', op: 'equals', value: 2 }] },
    ]));
    expect(r.outcome).toBe('working');
  }, 30_000);
});
