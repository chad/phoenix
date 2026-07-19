/**
 * OpenAI-compatible LLM Provider.
 *
 * Uses the Chat Completions API via native fetch. Serves OpenAI itself
 * (OPENAI_API_KEY, api.openai.com) and any OpenAI-completions-compatible
 * endpoint — Moonshot/Kimi, Ollama, or a custom base URL — via `opts`.
 */

import type { LLMProvider, GenerateOptions } from './provider.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private omitTemperature: boolean;

  constructor(apiKey: string, model: string, opts: { baseUrl?: string; name?: string; omitTemperature?: boolean } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.name = opts.name ?? 'openai';
    // Reasoning models (kimi-k3) reject any temperature but 1 — the field is omitted
    // entirely rather than sending a value the model would reject or silently ignore.
    this.omitTemperature = opts.omitTemperature ?? false;
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];

    if (options?.system) {
      messages.push({ role: 'system', content: options.system });
    }
    messages.push({ role: 'user', content: prompt });

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: options?.maxTokens ?? 8192,
    };

    if (options?.temperature !== undefined && !this.omitTemperature) {
      body.temperature = options.temperature;
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${text}`);
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    if (!data.choices?.length) {
      throw new Error('OpenAI returned no choices');
    }

    return data.choices[0].message.content;
  }
}
