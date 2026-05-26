/**
 * LLM-reclassifier canonicalizer impl.
 *
 * Takes the prior stage's candidates and re-runs type classification on the
 * low-confidence non-CONTEXT ones via LLM. Statements are preserved; only
 * `type` (and `extraction_method`) may change. Re-resolves the graph.
 *
 * This impl is `enhancerOnly` — it expects existing candidates with confidence
 * scores from a prior extraction step.
 */

import { reclassifyCandidates } from '../../canonicalizer-llm.js';
import { resolveGraph } from '../../resolution.js';
import type { CanonicalizerLayer } from './types.js';

export const llmReclassifier: CanonicalizerLayer = {
  name: 'llm-reclassifier',
  description: 'Reclassifies low-confidence prior candidates via LLM, preserving statements.',
  enhancerOnly: true,
  async run(input, prior, ctx) {
    if (!prior) {
      throw new Error('llm-reclassifier requires a prior canonicalizer impl to produce candidates');
    }
    if (!ctx.llm) return prior;

    const reclassified = await reclassifyCandidates(prior.candidates, ctx.llm);
    const nodes = resolveGraph(reclassified, input.clauses);
    return { candidates: reclassified, nodes };
  },
};
