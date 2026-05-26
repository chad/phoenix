/**
 * Full LLM extractor canonicalizer impl.
 *
 * Replaces the prior stage's candidates with a fresh LLM-driven extraction
 * over the raw clauses. Useful as a standalone first impl (instead of the
 * rule-based extractor) or as a later impl that supplants weak rule output.
 *
 * Falls back to the prior result if available (and to an empty graph if not)
 * when the LLM fails to produce candidates.
 */

import { extractBatchLLM } from '../../canonicalizer-llm.js';
import { resolveGraph } from '../../resolution.js';
import type { CanonicalizerLayer } from './types.js';

export const llmFullExtractor: CanonicalizerLayer = {
  name: 'llm-full-extractor',
  description: 'LLM-driven extraction from raw clauses with explicit provenance.',
  async run(input, prior, ctx) {
    if (!ctx.llm) {
      return prior ?? { candidates: [], nodes: [] };
    }

    try {
      const candidates = await extractBatchLLM(input.clauses, ctx.llm);
      if (candidates.length === 0) {
        return prior ?? { candidates: [], nodes: [] };
      }
      const nodes = resolveGraph(candidates, input.clauses);
      return { candidates, nodes };
    } catch {
      return prior ?? { candidates: [], nodes: [] };
    }
  },
};
