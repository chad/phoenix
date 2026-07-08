/**
 * Anthropic (Claude) LLM Provider.
 *
 * Uses the Messages API via native fetch.
 * Requires ANTHROPIC_API_KEY env var.
 */

import type { LLMProvider, GenerateOptions } from './provider.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MAX_RETRIES = 5;
const PER_CALL_TIMEOUT_MS = 180_000;            // a single generation call
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

const sleep = (ms: number): Promise<void> => new Promise<void>(r => setTimeout(r, ms));
function backoff(attempt: number): Promise<void> {
  // exponential with jitter, capped — transient network/overload blips recover fast.
  return sleep(Math.min(800 * 2 ** attempt, 12_000) + Math.floor(Math.random() * 400));
}
function isTransient(err: unknown): boolean {
  const e = err as { name?: string; message?: string; cause?: { code?: string } };
  if (e?.name === 'AbortError') return true;
  const msg = `${e?.message ?? ''} ${e?.cause?.code ?? ''}`;
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|terminated|UND_ERR/i.test(msg);
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private apiKey: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options?.maxTokens ?? 8192,
      messages: [{ role: 'user', content: prompt }],
    };

    if (options?.system) {
      body.system = options.system;
    }
    // Claude 5-family models (sonnet-5, opus-…-5, haiku-…-5, fable-5, mythos-5)
    // deprecated the temperature parameter and reject any value. Omit it for
    // those up front; honor it for everything else. The reactive strip in the
    // retry loop catches any future model that deprecates it without a name match.
    const deprecatesTemperature = /(?:sonnet|opus|haiku|fable|mythos)-5\b|-5-2\d/.test(this.model);
    if (options?.temperature !== undefined && !deprecatesTemperature) {
      body.temperature = options.temperature;
    }

    // Retry transient network failures and retryable statuses (429/5xx/overload) with
    // backoff, and bound each call with a timeout. A single blip should not collapse
    // a whole module to a stub.
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT_MS);
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': API_VERSION,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text();
          // Self-heal: a model that deprecated `temperature` returns 400. Strip it
          // and retry immediately rather than collapsing the module to a stub.
          if (res.status === 400 && 'temperature' in body && /temperature/i.test(text) && /deprecat|not supported|unsupported|invalid/i.test(text)) {
            delete body.temperature;
            continue;
          }
          if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
            await backoff(attempt);
            continue;
          }
          throw new Error(`Anthropic API error ${res.status}: ${text}`);
        }

        const data = await res.json() as { content: Array<{ type: string; text: string }> };
        const textBlocks = data.content.filter(b => b.type === 'text');
        if (textBlocks.length === 0) throw new Error('Anthropic returned no text content');
        return textBlocks.map(b => b.text).join('');
      } catch (err) {
        lastErr = err;
        if (isTransient(err) && attempt < MAX_RETRIES) {
          await backoff(attempt);
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }
}
