/**
 * LLM provider resolution — the configurable model surface.
 *
 * Providers were hardcoded (anthropic/openai/claude-cli); the registry now covers the
 * openai-compatible family: Moonshot/Kimi (MOONSHOT_API_KEY → kimi-k3), Ollama
 * (explicit config only — auto-detect must never probe the network), and a custom
 * endpoint escape hatch (PHOENIX_LLM_BASE_URL). These tests pin:
 *   1. detection order and defaults (anthropic > openai > kimi > claude-cli),
 *   2. explicit overrides (env > config.json > detection),
 *   3. honesty: an explicit provider with no credential resolves to null (stubs),
 *      never to a silently different provider,
 *   4. the wire shape: a kimi provider really POSTs to api.moonshot.ai with the
 *      moonshot key and the kimi-k3 model id.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Claude CLI detection must not leak the dev machine's state into these tests.
vi.mock('../../src/llm/claude-cli.js', () => ({
  isClaudeCliAvailable: () => false,
  ClaudeCliProvider: class {
    readonly name = 'claude-cli';
    readonly model = 'sonnet';
    async generate(): Promise<string> { return ''; }
  },
}));

import { resolveProvider, describeAvailability } from '../../src/llm/resolve.js';
import { DEFAULT_MODELS } from '../../src/llm/provider.js';

const LLM_ENV = [
  'PHOENIX_NO_LLM', 'PHOENIX_LLM_PROVIDER', 'PHOENIX_LLM_MODEL', 'PHOENIX_LLM_BASE_URL', 'PHOENIX_LLM_API_KEY',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'MOONSHOT_API_KEY',
];

let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = {};
  for (const k of LLM_ENV) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of LLM_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

function configDir(llm?: { provider: string; model: string }): string {
  const dir = mkdtempSync(join(tmpdir(), 'phx-llm-resolve-'));
  mkdirSync(dir, { recursive: true });
  if (llm) writeFileSync(join(dir, 'config.json'), JSON.stringify({ llm }), 'utf8');
  return dir;
}

describe('provider detection and defaults', () => {
  it('kimi is detected from MOONSHOT_API_KEY with the kimi-k3 default model', () => {
    process.env.MOONSHOT_API_KEY = 'mk-test';
    const p = resolveProvider();
    expect(p?.name).toBe('kimi');
    expect(p?.model).toBe('kimi-k3');
  });

  it('detection order: anthropic > openai > kimi', () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.OPENAI_API_KEY = 'o';
    process.env.MOONSHOT_API_KEY = 'm';
    expect(resolveProvider()?.name).toBe('anthropic');
    delete process.env.ANTHROPIC_API_KEY;
    expect(resolveProvider()?.name).toBe('openai');
    delete process.env.OPENAI_API_KEY;
    expect(resolveProvider()?.name).toBe('kimi');
  });

  it('no keys → null (honest stub fallback), and PHOENIX_NO_LLM=1 forces null', () => {
    expect(resolveProvider()).toBeNull();
    process.env.MOONSHOT_API_KEY = 'm';
    process.env.PHOENIX_NO_LLM = '1';
    expect(resolveProvider()).toBeNull();
  });

  it('ollama is never auto-detected (no network probing on CLI startup)', () => {
    const { available, hint } = describeAvailability();
    expect(available).not.toContain('ollama');
    expect(hint).toContain('ollama');
  });
});

describe('explicit overrides (env > config.json > detection)', () => {
  it('PHOENIX_LLM_PROVIDER=kimi wins over a present ANTHROPIC_API_KEY', () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.MOONSHOT_API_KEY = 'm';
    process.env.PHOENIX_LLM_PROVIDER = 'kimi';
    expect(resolveProvider()?.name).toBe('kimi');
  });

  it('PHOENIX_LLM_MODEL overrides the provider default and the config model', () => {
    process.env.MOONSHOT_API_KEY = 'm';
    process.env.PHOENIX_LLM_MODEL = 'kimi-k2.7-code';
    const p = resolveProvider(configDir({ provider: 'kimi', model: 'ignored' }));
    expect(p?.model).toBe('kimi-k2.7-code');
  });

  it('config.json selects provider+model when no env override (ollama needs no key)', () => {
    const p = resolveProvider(configDir({ provider: 'ollama', model: 'llama3.1:8b' }));
    expect(p?.name).toBe('ollama');
    expect(p?.model).toBe('llama3.1:8b');
  });

  it('an explicit provider with no credential resolves to null, never to a silent substitute', () => {
    process.env.ANTHROPIC_API_KEY = 'a'; // detectable, but the user asked for kimi
    process.env.PHOENIX_LLM_PROVIDER = 'kimi'; // ... without MOONSHOT_API_KEY
    expect(resolveProvider()).toBeNull();
  });

  it('custom endpoint: PHOENIX_LLM_BASE_URL (+ optional key) builds an openai-compatible provider', () => {
    process.env.PHOENIX_LLM_PROVIDER = 'custom';
    expect(resolveProvider()).toBeNull(); // no base URL yet
    process.env.PHOENIX_LLM_BASE_URL = 'http://localhost:1234/v1/';
    process.env.PHOENIX_LLM_MODEL = 'my-model';
    const p = resolveProvider();
    expect(p?.name).toBe('custom');
    expect(p?.model).toBe('my-model');
  });

  it('DEFAULT_MODELS covers every detectable provider', () => {
    for (const name of ['anthropic', 'openai', 'kimi', 'claude-cli']) {
      expect(DEFAULT_MODELS[name], `default model for ${name}`).toBeTruthy();
    }
    expect(DEFAULT_MODELS.kimi).toBe('kimi-k3');
  });
});

describe('the wire shape', () => {
  it('a kimi provider POSTs chat-completions to api.moonshot.ai with the moonshot key + model id', async () => {
    process.env.MOONSHOT_API_KEY = 'mk-secret';
    const calls: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({
        url,
        auth: (init.headers as Record<string, string>).Authorization,
        body: JSON.parse(init.body as string),
      });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    });
    const p = resolveProvider();
    expect(p?.name).toBe('kimi');
    const out = await p!.generate('hello', { system: 'sys', temperature: 0 });
    expect(out).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.moonshot.ai/v1/chat/completions');
    expect(calls[0].auth).toBe('Bearer mk-secret');
    expect(calls[0].body.model).toBe('kimi-k3');
    // kimi-k3 is a reasoning model: the API rejects temperature≠1, so the field is
    // omitted entirely (never sent a value it would 400 on).
    expect('temperature' in calls[0].body).toBe(false);
  });

  it('a non-reasoning openai-compatible provider still sends temperature', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    });
    const p = resolveProvider();
    expect(p?.name).toBe('openai');
    await p!.generate('hi', { temperature: 0 });
    expect(calls[0].temperature).toBe(0);
  });
});

describe('stale config model never leaks across an env provider override', () => {
  it('env provider override + config from another provider → the NEW provider default model', () => {
    process.env.MOONSHOT_API_KEY = 'm';
    process.env.PHOENIX_LLM_PROVIDER = 'kimi';
    // Saved while anthropic was in use — its model id must NOT ride onto kimi.
    const p = resolveProvider(configDir({ provider: 'anthropic', model: 'claude-sonnet-5' }));
    expect(p?.name).toBe('kimi');
    expect(p?.model).toBe('kimi-k3');
  });
  it('env provider override naming the SAME provider keeps the config model', () => {
    process.env.MOONSHOT_API_KEY = 'm';
    process.env.PHOENIX_LLM_PROVIDER = 'kimi';
    const p = resolveProvider(configDir({ provider: 'kimi', model: 'kimi-k2.7-code' }));
    expect(p?.model).toBe('kimi-k2.7-code');
  });
});
