import { describe, it, expect } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCase, loadCases, fixtureDigest, specText } from '../../src/bench/case.js';

const CASES = join(process.cwd(), 'bench', 'cases');

describe('the vendored bench cases', () => {
  it('todo-api loads with its spec, checks and runtime contract', () => {
    const c = loadCase(join(CASES, 'todo-api'));
    expect(c.id).toBe('todo-api');
    expect(c.spec.length).toBeGreaterThan(0);
    expect(specText(c)).toContain('GET /stats');
    expect(c.checks.length).toBeGreaterThanOrEqual(20);
    expect(c.runtime.command).toEqual(['npx', 'tsx', 'src/server.ts']);
    expect(c.runtime.brief).toContain('DB_PATH');
    expect(Object.keys(c.runtime.dependencies)).toContain('hono');
  });

  it('every case loads, and check names are unique within a case', () => {
    const all = loadCases(CASES);
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) {
      const names = c.checks.map(k => k.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('the intent arm gets one sentence, not the spec', () => {
    const c = loadCase(join(CASES, 'todo-api'));
    expect(c.intent.length).toBeLessThan(200);
    expect(c.intent).not.toContain('GET /stats');
  });
});

describe('fixture digest', () => {
  it('pins the question — any change to spec or checks changes it', () => {
    const a = mkdtempSync(join(tmpdir(), 'phx-bench-case-'));
    cpSync(join(CASES, 'todo-api'), a, { recursive: true });
    const before = fixtureDigest(a);
    expect(before).toBe(loadCase(a).digest);

    appendFileSync(join(a, 'spec', 'tasks.md'), '\n- one more requirement\n', 'utf8');
    const afterSpec = fixtureDigest(a);
    expect(afterSpec).not.toBe(before);

    const meta = JSON.parse(readFileSync(join(a, 'case.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(join(a, 'case.json'), JSON.stringify({ ...meta, perSampleMs: 1 }), 'utf8');
    expect(fixtureDigest(a)).not.toBe(afterSpec);
  });

  it('is stable across identical copies', () => {
    const a = mkdtempSync(join(tmpdir(), 'phx-bench-case-a-'));
    const b = mkdtempSync(join(tmpdir(), 'phx-bench-case-b-'));
    cpSync(join(CASES, 'todo-api'), a, { recursive: true });
    cpSync(join(CASES, 'todo-api'), b, { recursive: true });
    expect(fixtureDigest(a)).toBe(fixtureDigest(b));
  });
});

describe('loader refusals', () => {
  it('a case with duplicate check names is rejected at load, not at scoring time', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phx-bench-bad-'));
    cpSync(join(CASES, 'todo-api'), dir, { recursive: true });
    writeFileSync(join(dir, 'checks.json'), JSON.stringify([
      { name: 'same', method: 'GET', path: '/health', status: 200 },
      { name: 'same', method: 'GET', path: '/health', status: 200 },
    ]), 'utf8');
    expect(() => loadCase(dir)).toThrow(/duplicate check name/);
  });

  it('a case with no checks is rejected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phx-bench-empty-'));
    cpSync(join(CASES, 'todo-api'), dir, { recursive: true });
    writeFileSync(join(dir, 'checks.json'), '[]', 'utf8');
    expect(() => loadCase(dir)).toThrow(/no checks/);
  });
});
