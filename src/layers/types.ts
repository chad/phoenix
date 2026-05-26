/**
 * Layer Abstraction — pluggable, additive pipeline stages.
 *
 * Each layer (canonicalizer, classifier, planner, regenerator, policy) has a
 * registry of named implementations. A `LayerStack` executes implementations
 * in order, threading the prior output through so each implementation can
 * enhance (or fully replace) the result. This lets users:
 *
 *   - swap a single impl: `["llm-extractor"]`
 *   - chain enhancers:    `["rule-extractor", "llm-normalizer", "requirements-specialist"]`
 *   - branch by purpose:  one impl produces, another refines REQUIREMENT types,
 *                         a third derives INVARIANTs.
 *
 * The first implementation in a stack receives `prior = null` and must produce
 * an initial output. Subsequent implementations receive the previous output and
 * either enhance it or ignore it.
 */

import type { LLMProvider } from '../llm/provider.js';

/** Cross-layer context passed to every implementation. */
export interface LayerContext {
  /** Optional LLM provider. Implementations that don't need one ignore it. */
  llm?: LLMProvider | null;
  /** Project root on disk. */
  projectRoot?: string;
  /** .phoenix directory. */
  phoenixDir?: string;
  /** Free-form bag for impl-specific knobs (e.g. selfConsistencyK). */
  options?: Record<string, unknown>;
}

/**
 * A single implementation of a layer.
 *
 * `prior` is null for the first impl in a stack, and the previous impl's output
 * for every subsequent impl. Implementations that strictly enhance (rather than
 * produce from scratch) should treat `prior === null` as an error.
 */
export interface Layer<TInput, TOutput> {
  /** Unique name within the layer's registry. */
  readonly name: string;
  /** Optional human-readable description. */
  readonly description?: string;
  /** When true, this impl requires a prior output (cannot be first in a stack). */
  readonly enhancerOnly?: boolean;
  run(input: TInput, prior: TOutput | null, context: LayerContext): Promise<TOutput>;
}

/**
 * An ordered sequence of `Layer` implementations for a single pipeline stage.
 * Running the stack folds each impl over the prior output.
 */
export class LayerStack<TInput, TOutput> {
  readonly layerName: string;
  readonly impls: ReadonlyArray<Layer<TInput, TOutput>>;

  constructor(layerName: string, impls: Layer<TInput, TOutput>[]) {
    if (impls.length === 0) {
      throw new Error(`LayerStack(${layerName}): at least one implementation is required`);
    }
    if (impls[0].enhancerOnly) {
      throw new Error(
        `LayerStack(${layerName}): first implementation "${impls[0].name}" is marked enhancerOnly and cannot lead the stack`,
      );
    }
    this.layerName = layerName;
    this.impls = impls;
  }

  /** Implementation names in execution order. */
  describe(): string[] {
    return this.impls.map(i => i.name);
  }

  async run(input: TInput, context: LayerContext): Promise<TOutput> {
    let prior: TOutput | null = null;
    for (const impl of this.impls) {
      prior = await impl.run(input, prior, context);
    }
    // Safe: `impls` is non-empty so the loop ran at least once.
    return prior as TOutput;
  }
}

/**
 * Registry of named implementations for a single layer. Configurations
 * reference impls by name; `resolve()` materializes a `LayerStack`.
 */
export class LayerRegistry<TInput, TOutput> {
  readonly layerName: string;
  private readonly impls = new Map<string, Layer<TInput, TOutput>>();

  constructor(layerName: string) {
    this.layerName = layerName;
  }

  register(impl: Layer<TInput, TOutput>): this {
    if (this.impls.has(impl.name)) {
      throw new Error(`LayerRegistry(${this.layerName}): duplicate implementation "${impl.name}"`);
    }
    this.impls.set(impl.name, impl);
    return this;
  }

  has(name: string): boolean {
    return this.impls.has(name);
  }

  get(name: string): Layer<TInput, TOutput> | undefined {
    return this.impls.get(name);
  }

  list(): string[] {
    return [...this.impls.keys()];
  }

  /**
   * Resolve a list of impl names into a `LayerStack`. Unknown names throw with
   * a list of valid options so config errors are easy to fix.
   */
  resolve(names: string[]): LayerStack<TInput, TOutput> {
    if (names.length === 0) {
      throw new Error(
        `LayerRegistry(${this.layerName}): config provided zero implementations (available: ${this.list().join(', ') || '<none>'})`,
      );
    }
    const impls = names.map(name => {
      const impl = this.impls.get(name);
      if (!impl) {
        throw new Error(
          `LayerRegistry(${this.layerName}): unknown implementation "${name}" (available: ${this.list().join(', ')})`,
        );
      }
      return impl;
    });
    return new LayerStack(this.layerName, impls);
  }
}
