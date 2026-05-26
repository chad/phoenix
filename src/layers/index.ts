/**
 * Layered pipeline — public surface.
 *
 * Layers are pluggable and additive: each layer (canonicalizer, classifier,
 * iu-planner, regenerator, policy) has a registry of named implementations,
 * and a config-driven `LayerStack` chains them so each impl enhances the
 * prior impl's output.
 *
 * Register a new impl from outside:
 *
 *   import { canonicalizerRegistry } from 'phoenix-vcs';
 *   canonicalizerRegistry.register({
 *     name: 'requirements-specialist',
 *     enhancerOnly: true,
 *     async run(input, prior, ctx) { ... },
 *   });
 *
 * Then reference it in `.phoenix/config.json`:
 *
 *   { "layers": { "canonicalizer": ["rule-extractor", "requirements-specialist"] } }
 */

export type { Layer, LayerContext } from './types.js';
export { LayerStack, LayerRegistry } from './types.js';

export type { LayersConfig } from './config.js';
export { defaultLayersConfig, mergeLayersConfig, loadLayersConfig } from './config.js';

export { Pipeline, buildPipeline } from './pipeline.js';
export type { PipelineStacks, BuildPipelineArgs } from './pipeline.js';

// Per-layer registries and types
export { canonicalizerRegistry, DEFAULT_CANONICALIZER_STACK } from './canonicalizer/index.js';
export type { CanonicalizerInput, CanonicalizerOutput, CanonicalizerLayer } from './canonicalizer/index.js';

export { classifierRegistry, DEFAULT_CLASSIFIER_STACK } from './classifier/index.js';
export type { ClassifierInput, ClassifierOutput, ClassifierLayer } from './classifier/index.js';

export { iuPlannerRegistry, DEFAULT_IU_PLANNER_STACK } from './iu-planner/index.js';
export type { IUPlannerInput, IUPlannerOutput, IUPlannerLayer } from './iu-planner/index.js';

export { regeneratorRegistry, DEFAULT_REGENERATOR_STACK } from './regenerator/index.js';
export type { RegeneratorInput, RegeneratorOutput, RegeneratorLayer } from './regenerator/index.js';

export { policyRegistry, DEFAULT_POLICY_STACK } from './policy/index.js';
export type { PolicyInput, PolicyOutput, PolicyLayer } from './policy/index.js';
