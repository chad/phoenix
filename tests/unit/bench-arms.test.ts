import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractFiles, runSingleCallArm, armBudget, isArmName, ARMS } from '../../src/bench/arms.js';
import type { BenchCase } from '../../src/bench/case.js';
import type { LLMProvider } from '../../src/llm/provider.js';

const BENCH: BenchCase = {
  id: 'fixture', title: 'fixture', arch: 'sqlite-web-api',
  intent: 'A one-sentence intent.',
  runtime: { command: ['node', 'app.mjs'], healthPath: '/health', readyTimeoutMs: 1000, brief: 'RUNTIME BRIEF', dependencies: {} },
  perSampleMs: 1000,
  spec: [['a.md', '# Spec\n\n- a requirement']],
  checks: [{ name: 'c', method: 'GET', path: '/health', status: 200 }],
  digest: 'fixture', dir: '/dev/null',
};

function provider(reply: string, capture?: (p: string) => void): LLMProvider {
  return {
    name: 'fake', model: 'fake-1',
    generate: async (prompt: string) => { capture?.(prompt); return reply; },
  };
}

function ctx(dir: string, p: LLMProvider) {
  return { bench: BENCH, dir, repoRoot: process.cwd(), env: {}, provider: p, timeoutMs: 5000 };
}

describe('reading files out of a model reply', () => {
  it('reads the JSON envelope the prompt asks for', () => {
    const files = extractFiles('Sure!\n```json\n[{"path":"src/server.ts","contents":"console.log(1)"}]\n```\n');
    expect(files).toEqual([{ path: 'src/server.ts', contents: 'console.log(1)' }]);
  });

  it('falls back to path-labelled fences — generosity aimed at the CONTROL arm', () => {
    const files = extractFiles('**src/server.ts**\n```ts\nconsole.log(1)\n```\n\n### src/db.ts\n```ts\nexport const db = 1\n```');
    expect(files.map(f => f.path)).toEqual(['src/server.ts', 'src/db.ts']);
  });

  it('reads nothing from prose, and says so by returning nothing', () => {
    expect(extractFiles('I would start by creating a server file.')).toEqual([]);
  });
});

describe('single-call arms', () => {
  it('baseline is shown the whole spec; intent is shown one sentence', async () => {
    let baselinePrompt = '', intentPrompt = '';
    const reply = '```json\n[{"path":"src/server.ts","contents":"ok"}]\n```';
    await runSingleCallArm(ctx(mkdtempSync(join(tmpdir(), 'phx-arm-')), provider(reply, p => { baselinePrompt = p; })), 'baseline');
    await runSingleCallArm(ctx(mkdtempSync(join(tmpdir(), 'phx-arm-')), provider(reply, p => { intentPrompt = p; })), 'intent');

    expect(baselinePrompt).toContain('a requirement');
    expect(intentPrompt).not.toContain('a requirement');
    expect(intentPrompt).toContain('A one-sentence intent.');
    // Both rungs are told the runtime contract — that is the harness's requirement,
    // not the pipeline's convention.
    expect(baselinePrompt).toContain('RUNTIME BRIEF');
    expect(intentPrompt).toContain('RUNTIME BRIEF');
  });

  it('writes the files it was given', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phx-arm-write-'));
    const r = await runSingleCallArm(ctx(dir, provider('```json\n[{"path":"src/server.ts","contents":"hello"}]\n```')), 'baseline');
    expect(r.ok).toBe(true);
    expect(r.files).toBe(1);
    expect(r.calls).toBe(1);
    expect(readFileSync(join(dir, 'src', 'server.ts'), 'utf8')).toBe('hello');
  });

  it('never writes outside the sample directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phx-arm-escape-'));
    const r = await runSingleCallArm(ctx(dir, provider('```json\n[{"path":"../../escaped.ts","contents":"nope"},{"path":"src/ok.ts","contents":"y"}]\n```')), 'baseline');
    expect(r.ok).toBe(true);
    expect(existsSync(join(dir, '..', '..', 'escaped.ts'))).toBe(false);
    expect(existsSync(join(dir, 'escaped.ts'))).toBe(true); // de-escaped, kept inside
  });

  it('an unreadable reply is a response_shape finding, not a crash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phx-arm-shape-'));
    const r = await runSingleCallArm(ctx(dir, provider('I refuse.')), 'baseline');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('response_shape');
  });

  it('a failed call is reported as a failed call — the runner turns that into "unreachable"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phx-arm-fail-'));
    const broken: LLMProvider = { name: 'fake', model: 'fake-1', generate: async () => { throw new Error('ECONNREFUSED'); } };
    const r = await runSingleCallArm(ctx(dir, broken), 'baseline');
    expect(r.ok).toBe(false);
    expect(r.reason?.startsWith('model call failed')).toBe(true);
  });
});

describe('budget disclosure', () => {
  it('records the retry asymmetry rather than hiding it', () => {
    expect(armBudget('phoenix')).toEqual({ calls: 'pipeline-internal', retries: 'pipeline-internal' });
    expect(armBudget('baseline')).toEqual({ calls: 1, retries: 0 });
    expect(armBudget('intent')).toEqual({ calls: 1, retries: 0 });
  });

  it('knows its own arm names', () => {
    expect(ARMS).toEqual(['phoenix', 'baseline', 'intent']);
    expect(isArmName('phoenix')).toBe(true);
    expect(isArmName('sedum')).toBe(false);
  });
});
