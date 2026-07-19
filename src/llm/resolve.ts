/**
 * LLM Provider Resolution — auto-detect, preference, config.
 *
 * Priority order:
 * 1. PHOENIX_LLM_PROVIDER env var (explicit override; PHOENIX_LLM_MODEL picks the model)
 * 2. Saved preference in .phoenix/config.json ({ llm: { provider, model } })
 * 3. Auto-detect from available API keys (PROVIDER_REGISTRY order):
 *    ANTHROPIC_API_KEY → anthropic, OPENAI_API_KEY → openai, MOONSHOT_API_KEY → kimi,
 *    Claude Code CLI present → claude-cli
 * 4. null (no provider available — fall back to stubs)
 *
 * Provider families: anthropic, claude-cli, and openai-compatible (chat
 * completions). The openai-compatible family covers OpenAI, Moonshot/Kimi,
 * Ollama (explicit config only — never auto-detected, so a CLI run never
 * probes the network), and any custom endpoint via:
 *   PHOENIX_LLM_PROVIDER=custom PHOENIX_LLM_BASE_URL=… [PHOENIX_LLM_API_KEY=…]
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LLMProvider, LLMConfig } from './provider.js';
import { DEFAULT_MODELS } from './provider.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { ClaudeCliProvider, isClaudeCliAvailable } from './claude-cli.js';

interface PhoenixConfig {
  llm?: LLMConfig;
}

/**
 * Resolve the LLM provider. Returns null if no provider is available.
 */
export function resolveProvider(phoenixDir?: string): LLMProvider | null {
  // 0. Hard stub-mode override — force deterministic, offline stub generation
  //    regardless of available keys/CLI. Used for reproducible tests and for
  //    "explain the pipeline without spending tokens".
  if (process.env.PHOENIX_NO_LLM === '1') return null;

  const config = phoenixDir ? loadConfig(phoenixDir) : {};

  // 1. Explicit env var override
  const envProvider = process.env.PHOENIX_LLM_PROVIDER;
  const envModel = process.env.PHOENIX_LLM_MODEL;

  // 2. Determine provider name
  const providerName = envProvider || config.llm?.provider || detectProvider();
  if (!providerName) return null;

  // 3. Determine model. The saved config's model applies only when the config's
  //    provider is the one in effect — an env provider override must not inherit a
  //    stale model id from a different provider (kimi + 'claude-sonnet-5' = a 400
  //    every call, masked by the extractor's rule fallback).
  const configModelApplies = !envProvider || !config.llm?.provider || config.llm.provider === providerName;
  const model = envModel
    || (configModelApplies ? config.llm?.model : undefined)
    || DEFAULT_MODELS[providerName]
    || DEFAULT_MODELS.anthropic;

  // 4. Build provider
  const provider = buildProvider(providerName, model);
  if (!provider) return null;

  // 5. Save preference if we detected it (and have a phoenix dir)
  if (phoenixDir && !config.llm && !envProvider && !envModel) {
    saveConfig(phoenixDir, {
      ...config,
      llm: { provider: providerName, model },
    });
  }

  return provider;
}

/** How a provider is built and whether it participates in env auto-detection. */
interface ProviderSpec {
  family: 'anthropic' | 'openai-compatible' | 'claude-cli';
  /** Env var holding the API key (absent = no key required, e.g. ollama). */
  keyEnv?: string;
  /** Chat-completions base URL (openai-compatible family). */
  baseUrl?: string;
  /** Key used when the endpoint needs none but the header must exist (ollama). */
  staticKey?: string;
  /** Omit the temperature field (reasoning models like kimi-k3 reject any value but 1). */
  omitTemperature?: boolean;
  /** Checked by env auto-detection, in registry order. Ollama is explicit-only
   *  (auto-detecting it would mean probing localhost on every CLI run). */
  detect: boolean;
}

/** The known providers. Order = auto-detection preference. */
const PROVIDER_REGISTRY: Record<string, ProviderSpec> = {
  anthropic: { family: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY', detect: true },
  openai: { family: 'openai-compatible', keyEnv: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1', detect: true },
  kimi: { family: 'openai-compatible', keyEnv: 'MOONSHOT_API_KEY', baseUrl: 'https://api.moonshot.ai/v1', omitTemperature: true, detect: true },
  'claude-cli': { family: 'claude-cli', detect: true },
  ollama: { family: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', staticKey: 'ollama', detect: false },
};

/**
 * Auto-detect which provider is available from env vars (registry order).
 */
function detectProvider(): string | null {
  for (const [name, spec] of Object.entries(PROVIDER_REGISTRY)) {
    if (!spec.detect) continue;
    if (spec.family === 'claude-cli') {
      if (isClaudeCliAvailable()) return name;
    } else if (spec.keyEnv && process.env[spec.keyEnv]) return name;
  }
  return null;
}

/**
 * Build a provider instance.
 */
function buildProvider(name: string, model: string): LLMProvider | null {
  // The custom escape hatch: any openai-compatible endpoint, configured by env.
  if (name === 'custom') {
    const baseUrl = process.env.PHOENIX_LLM_BASE_URL;
    if (!baseUrl) return null;
    return new OpenAIProvider(process.env.PHOENIX_LLM_API_KEY ?? 'none', model, { baseUrl, name: 'custom' });
  }
  const spec = PROVIDER_REGISTRY[name];
  if (!spec) return null;
  switch (spec.family) {
    case 'anthropic': {
      const key = process.env[spec.keyEnv!];
      if (!key) return null;
      return new AnthropicProvider(key, model);
    }
    case 'openai-compatible': {
      const key = spec.keyEnv ? process.env[spec.keyEnv] : spec.staticKey;
      if (!key) return null;
      return new OpenAIProvider(key, model, { baseUrl: spec.baseUrl, name, omitTemperature: spec.omitTemperature });
    }
    case 'claude-cli': {
      return new ClaudeCliProvider(model || 'sonnet');
    }
  }
}

/**
 * Load Phoenix config from .phoenix/config.json.
 */
function loadConfig(phoenixDir: string): PhoenixConfig {
  const configPath = join(phoenixDir, 'config.json');
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Save Phoenix config to .phoenix/config.json.
 */
function saveConfig(phoenixDir: string, config: PhoenixConfig): void {
  mkdirSync(phoenixDir, { recursive: true });
  writeFileSync(
    join(phoenixDir, 'config.json'),
    JSON.stringify(config, null, 2) + '\n',
    'utf8',
  );
}

/**
 * Describe which providers are available (for CLI help).
 */
export function describeAvailability(): { available: string[]; configured: string | null; hint: string } {
  if (process.env.PHOENIX_NO_LLM === '1') {
    return { available: [], configured: null, hint: 'PHOENIX_NO_LLM=1 — forcing deterministic stub generation.' };
  }
  const available: string[] = [];
  for (const [name, spec] of Object.entries(PROVIDER_REGISTRY)) {
    if (!spec.detect) continue;
    if (spec.family === 'claude-cli' ? isClaudeCliAvailable() : (spec.keyEnv && process.env[spec.keyEnv])) available.push(name);
  }

  const configured = process.env.PHOENIX_LLM_PROVIDER || null;

  let hint: string;
  if (available.length === 0) {
    hint = 'No LLM providers found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or MOONSHOT_API_KEY (kimi), or install Claude Code CLI to enable code generation. Falling back to stubs.';
  } else if (available.length === 1) {
    hint = `Using ${available[0]} (detected from env).`;
  } else {
    hint = `Multiple providers available: ${available.join(', ')}. Using ${configured || available[0]}. Set PHOENIX_LLM_PROVIDER to override.`;
  }
  hint += ' Explicit-only providers: ollama (config .phoenix/config.json), custom (PHOENIX_LLM_BASE_URL).';

  return { available, configured, hint };
}
