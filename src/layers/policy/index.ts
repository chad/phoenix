/**
 * Policy layer registry.
 *
 * Default stack: `["evidence-checker"]`. Add gates (security-gate,
 * compliance-gate) to refine the verdict after the baseline check.
 */

import { LayerRegistry } from '../types.js';
import type { PolicyInput, PolicyOutput } from './types.js';
import { evidenceChecker } from './evidence-checker.js';

export const policyRegistry = new LayerRegistry<PolicyInput, PolicyOutput>('policy');

policyRegistry.register(evidenceChecker);

export const DEFAULT_POLICY_STACK = ['evidence-checker'];

export type { PolicyInput, PolicyOutput, PolicyLayer } from './types.js';
export { evidenceChecker };
