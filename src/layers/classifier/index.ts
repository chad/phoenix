/**
 * Classifier layer registry.
 *
 * Default stack: `["rule-classifier"]`. To reduce D-rate, append the LLM
 * resolver: `["rule-classifier", "llm-d-resolver"]`.
 */

import { LayerRegistry } from '../types.js';
import type { ClassifierInput, ClassifierOutput } from './types.js';
import { ruleClassifier } from './rule-classifier.js';
import { llmDResolver } from './llm-d-resolver.js';

export const classifierRegistry = new LayerRegistry<ClassifierInput, ClassifierOutput>('classifier');

classifierRegistry.register(ruleClassifier);
classifierRegistry.register(llmDResolver);

export const DEFAULT_CLASSIFIER_STACK = ['rule-classifier'];

export type { ClassifierInput, ClassifierOutput, ClassifierLayer } from './types.js';
export { ruleClassifier, llmDResolver };
