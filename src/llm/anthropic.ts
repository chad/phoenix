/**
 * Anthropic (Claude) LLM Provider.
 *
 * Uses the Messages API via native fetch.
 * Requires ANTHROPIC_API_KEY env var.
 */

import type { LLMProvider, GenerateOptions } from './provider.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

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
    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    const data = await res.json() as {
      content: Array<{ type: string; text: string }>;
    };

    const textBlocks = data.content.filter(b => b.type === 'text');
    if (textBlocks.length === 0) {
      throw new Error('Anthropic returned no text content');
    }

    return textBlocks.map(b => b.text).join('');
  }
}
