/**
 * Regenerator layer registry.
 *
 * Default stack: `["llm-or-stub"]`. Append refiner impls (lint-fix,
 * test-augment, security-hardener) to enhance generated files before the
 * manifest is written.
 */

import { LayerRegistry } from '../types.js';
import type { RegeneratorInput, RegeneratorOutput } from './types.js';
import { llmOrStubRegenerator } from './llm-or-stub.js';

export const regeneratorRegistry = new LayerRegistry<RegeneratorInput, RegeneratorOutput>('regenerator');

regeneratorRegistry.register(llmOrStubRegenerator);

export const DEFAULT_REGENERATOR_STACK = ['llm-or-stub'];

export type { RegeneratorInput, RegeneratorOutput, RegeneratorLayer } from './types.js';
export { llmOrStubRegenerator };
