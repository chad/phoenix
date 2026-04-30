/**
 * Claude CLI LLM Provider.
 *
 * Uses the `claude` CLI in print mode (-p) for code generation.
 * This allows Phoenix to use Claude Code's existing authentication
 * instead of requiring a separate API key.
 */

import { execFileSync } from 'node:child_process';
import type { LLMProvider, GenerateOptions } from './provider.js';

export class ClaudeCliProvider implements LLMProvider {
  readonly name = 'claude-cli';
  readonly model: string;

  constructor(model: string = 'sonnet') {
    this.model = model;
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const args = [
      '-p',
      '--model', this.model,
      '--tools', '',
      '--no-session-persistence',
    ];

    if (options?.system) {
      args.push('--system-prompt', options.system);
    }

    // Pass prompt via stdin to avoid argument length limits
    const result = execFileSync('claude', args, {
      encoding: 'utf8',
      input: prompt,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 300_000, // 5 minutes for large generations
    });

    if (!result || result.trim().length === 0) {
      throw new Error('Claude CLI returned empty response');
    }

    return result;
  }
}

/**
 * Check if the `claude` CLI is available on PATH.
 */
export function isClaudeCliAvailable(): boolean {
  try {
    execFileSync('claude', ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}
