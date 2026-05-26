/**
 * Default regenerator impl: LLM if available, deterministic stub otherwise.
 *
 * Delegates to the existing `generateIU` function so behavior is identical to
 * the pre-layer pipeline. The layer wrapper exists so additional impls (e.g.
 * a lint-and-fix pass) can be chained after this one.
 */

import { generateIU } from '../../regen.js';
import type { RegeneratorLayer } from './types.js';

export const llmOrStubRegenerator: RegeneratorLayer = {
  name: 'llm-or-stub',
  description: 'Generates code via the configured LLM, or deterministic stubs when no LLM is available.',
  async run(input, _prior, ctx) {
    return generateIU(input.iu, {
      llm: ctx.llm ?? undefined,
      canonNodes: input.canonNodes,
      allIUs: input.allIUs,
      projectRoot: ctx.projectRoot,
      target: input.target,
      onProgress: input.onProgress,
    });
  },
};
