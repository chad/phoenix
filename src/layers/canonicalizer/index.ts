/**
 * Canonicalizer layer registry.
 *
 * The default stack — `["rule-extractor", "llm-normalizer"]` — preserves the
 * historical behavior: deterministic extraction first, optional LLM
 * normalization second. Users add or substitute impls in
 * `.phoenix/config.json` under `layers.canonicalizer`.
 *
 * To add a specialized impl (e.g. a model dedicated to deriving technical
 * requirements):
 *
 *   import { canonicalizerRegistry } from 'phoenix-vcs';
 *   canonicalizerRegistry.register({
 *     name: 'requirements-specialist',
 *     enhancerOnly: true,
 *     async run(input, prior, ctx) { ... return enhanced; },
 *   });
 */

import { LayerRegistry } from '../types.js';
import type { CanonicalizerInput, CanonicalizerOutput } from './types.js';
import { ruleExtractor } from './rule-extractor.js';
import { llmNormalizer } from './llm-normalizer.js';
import { llmReclassifier } from './llm-reclassifier.js';
import { llmFullExtractor } from './llm-full-extractor.js';

export const canonicalizerRegistry = new LayerRegistry<CanonicalizerInput, CanonicalizerOutput>('canonicalizer');

canonicalizerRegistry.register(ruleExtractor);
canonicalizerRegistry.register(llmNormalizer);
canonicalizerRegistry.register(llmReclassifier);
canonicalizerRegistry.register(llmFullExtractor);

export const DEFAULT_CANONICALIZER_STACK = ['rule-extractor', 'llm-normalizer'];

export type { CanonicalizerInput, CanonicalizerOutput, CanonicalizerLayer } from './types.js';
export { ruleExtractor, llmNormalizer, llmReclassifier, llmFullExtractor };
