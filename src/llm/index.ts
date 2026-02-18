/**
 * LLM integration — pluggable provider system for code generation.
 */

export type { LLMProvider, GenerateOptions, LLMConfig } from './provider.js';
export { DEFAULT_MODELS } from './provider.js';
export { AnthropicProvider } from './anthropic.js';
export { OpenAIProvider } from './openai.js';
export { resolveProvider, describeAvailability } from './resolve.js';
export { buildPrompt, SYSTEM_PROMPT } from './prompt.js';
