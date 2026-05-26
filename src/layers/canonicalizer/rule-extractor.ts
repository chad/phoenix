/**
 * Rule-based canonicalizer — the deterministic baseline.
 *
 * Produces candidates from clauses via the scoring rubric and resolves them
 * into a graph. This is always safe as the first impl in a stack; it ignores
 * `prior` and operates only on the raw clauses.
 */

import { extractCandidates } from '../../canonicalizer.js';
import { resolveGraph } from '../../resolution.js';
import type { CanonicalizerLayer } from './types.js';

export const ruleExtractor: CanonicalizerLayer = {
  name: 'rule-extractor',
  description: 'Deterministic sentence-level extraction using the scoring rubric.',
  async run(input) {
    const { candidates } = extractCandidates(input.clauses);
    const nodes = resolveGraph(candidates, input.clauses);
    return { candidates, nodes };
  },
};
