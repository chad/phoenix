/**
 * LLM-normalizer canonicalizer impl.
 *
 * Takes the prior stage's candidates and rewrites each non-CONTEXT statement
 * in canonical form via the LLM. The statement text changes; types,
 * provenance, and tags are preserved. Re-resolves the graph after
 * normalization. Falls back to the prior result on LLM failure (handled
 * inside `normalizeCandidates`).
 *
 * This impl is `enhancerOnly` — it requires prior candidates to enhance.
 */

import { normalizeCandidates } from '../../canonicalizer-llm.js';
import { resolveGraph } from '../../resolution.js';
import { CONFIG } from '../../experiment-config.js';
import type { CanonicalizerLayer } from './types.js';

export const llmNormalizer: CanonicalizerLayer = {
  name: 'llm-normalizer',
  description: 'Rewrites prior candidates in canonical form via LLM, preserving types and provenance.',
  enhancerOnly: true,
  async run(input, prior, ctx) {
    if (!prior) {
      throw new Error('llm-normalizer requires a prior canonicalizer impl to produce candidates');
    }
    if (!ctx.llm) return prior;

    const k = typeof ctx.options?.selfConsistencyK === 'number'
      ? (ctx.options.selfConsistencyK as number)
      : CONFIG.LLM_SELF_CONSISTENCY_K;

    const normalized = await normalizeCandidates(prior.candidates, ctx.llm, k);
    const nodes = resolveGraph(normalized, input.clauses);
    return { candidates: normalized, nodes };
  },
};
