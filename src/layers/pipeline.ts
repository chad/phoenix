/**
 * Pipeline — typed aggregate of all layer stacks.
 *
 * `buildPipeline(config, context)` resolves each layer's configured impl list
 * against its registry, producing a `Pipeline` whose methods invoke the
 * matching stack. The CLI calls these methods instead of importing the
 * underlying functions directly, so adding a new impl is a config change, not
 * a code change.
 */

import type { LayerContext, LayerStack } from './types.js';
import { canonicalizerRegistry } from './canonicalizer/index.js';
import type { CanonicalizerInput, CanonicalizerOutput } from './canonicalizer/index.js';
import { classifierRegistry } from './classifier/index.js';
import type { ClassifierInput, ClassifierOutput } from './classifier/index.js';
import { iuPlannerRegistry } from './iu-planner/index.js';
import type { IUPlannerInput, IUPlannerOutput } from './iu-planner/index.js';
import { regeneratorRegistry } from './regenerator/index.js';
import type { RegeneratorInput, RegeneratorOutput } from './regenerator/index.js';
import { policyRegistry } from './policy/index.js';
import type { PolicyInput, PolicyOutput } from './policy/index.js';
import type { LayersConfig } from './config.js';
import { defaultLayersConfig } from './config.js';

export interface PipelineStacks {
  canonicalizer: LayerStack<CanonicalizerInput, CanonicalizerOutput>;
  classifier: LayerStack<ClassifierInput, ClassifierOutput>;
  iuPlanner: LayerStack<IUPlannerInput, IUPlannerOutput>;
  regenerator: LayerStack<RegeneratorInput, RegeneratorOutput>;
  policy: LayerStack<PolicyInput, PolicyOutput>;
}

export class Pipeline {
  readonly stacks: PipelineStacks;
  readonly context: LayerContext;

  constructor(stacks: PipelineStacks, context: LayerContext) {
    this.stacks = stacks;
    this.context = context;
  }

  canonicalize(input: CanonicalizerInput): Promise<CanonicalizerOutput> {
    return this.stacks.canonicalizer.run(input, this.context);
  }

  classify(input: ClassifierInput): Promise<ClassifierOutput> {
    return this.stacks.classifier.run(input, this.context);
  }

  planIUs(input: IUPlannerInput): Promise<IUPlannerOutput> {
    return this.stacks.iuPlanner.run(input, this.context);
  }

  regenerate(input: RegeneratorInput): Promise<RegeneratorOutput> {
    return this.stacks.regenerator.run(input, this.context);
  }

  evaluatePolicy(input: PolicyInput): Promise<PolicyOutput> {
    return this.stacks.policy.run(input, this.context);
  }

  /** Human-readable description of the resolved stacks (for `phoenix status`). */
  describe(): Record<keyof PipelineStacks, string[]> {
    return {
      canonicalizer: this.stacks.canonicalizer.describe(),
      classifier: this.stacks.classifier.describe(),
      iuPlanner: this.stacks.iuPlanner.describe(),
      regenerator: this.stacks.regenerator.describe(),
      policy: this.stacks.policy.describe(),
    };
  }
}

export interface BuildPipelineArgs {
  config?: LayersConfig;
  context: LayerContext;
}

/** Resolve a config + context into a fully-typed `Pipeline`. */
export function buildPipeline(args: BuildPipelineArgs): Pipeline {
  const config = args.config ?? defaultLayersConfig();
  const stacks: PipelineStacks = {
    canonicalizer: canonicalizerRegistry.resolve(config.canonicalizer),
    classifier: classifierRegistry.resolve(config.classifier),
    iuPlanner: iuPlannerRegistry.resolve(config['iu-planner']),
    regenerator: regeneratorRegistry.resolve(config.regenerator),
    policy: policyRegistry.resolve(config.policy),
  };
  return new Pipeline(stacks, args.context);
}
