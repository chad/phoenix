/**
 * LLM Provider — pluggable interface for code generation.
 *
 * Providers implement a single method: generate code from a prompt.
 * Phoenix auto-detects available providers from env vars and saves
 * a preference in .phoenix/config.json.
 */

export interface LLMProvider {
  /** Provider name for display/config. */
  readonly name: string;

  /** Model identifier being used. */
  readonly model: string;

  /**
   * Generate a completion from a prompt.
   * Returns the raw text response.
   */
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
}

export interface GenerateOptions {
  /** Max tokens to generate. */
  maxTokens?: number;
  /** Temperature (0 = deterministic, 1 = creative). */
  temperature?: number;
  /** System prompt / role. */
  system?: string;
}

export interface LLMConfig {
  provider: string;
  model: string;
}

/** Default models per provider. Kept current — a stale id 404s and blocks codegen. */
export const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-4o',
  kimi: 'kimi-k3',
  ollama: 'qwen3.5:4b',
  'claude-cli': 'sonnet',
};
