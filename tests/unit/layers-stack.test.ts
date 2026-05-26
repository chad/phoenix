/**
 * Tests for the generic layer machinery — the contract that makes
 * implementations pluggable AND additive.
 */
import { describe, it, expect } from 'vitest';
import { LayerStack, LayerRegistry } from '../../src/layers/types.js';
import type { Layer, LayerContext } from '../../src/layers/types.js';

interface Acc { trail: string[]; }

function mkImpl(name: string, opts: { enhancer?: boolean; transform?: (prior: Acc | null) => Acc } = {}): Layer<{ seed: string }, Acc> {
  return {
    name,
    enhancerOnly: opts.enhancer,
    async run(input, prior) {
      if (opts.transform) return opts.transform(prior);
      const prev = prior?.trail ?? [`seed:${input.seed}`];
      return { trail: [...prev, name] };
    },
  };
}

const ctx: LayerContext = {};

describe('LayerStack', () => {
  it('runs a single impl with prior=null', async () => {
    const stack = new LayerStack('test', [mkImpl('only')]);
    const out = await stack.run({ seed: 'X' }, ctx);
    expect(out.trail).toEqual(['seed:X', 'only']);
  });

  it('chains impls, threading prior output through each one (additive)', async () => {
    const stack = new LayerStack('test', [
      mkImpl('a'),
      mkImpl('b', { enhancer: true }),
      mkImpl('c', { enhancer: true }),
    ]);
    const out = await stack.run({ seed: 'X' }, ctx);
    expect(out.trail).toEqual(['seed:X', 'a', 'b', 'c']);
  });

  it('lets an enhancer fully transform the prior output', async () => {
    const stack = new LayerStack('test', [
      mkImpl('a'),
      mkImpl('replace', { enhancer: true, transform: () => ({ trail: ['replaced'] }) }),
    ]);
    const out = await stack.run({ seed: 'X' }, ctx);
    expect(out.trail).toEqual(['replaced']);
  });

  it('rejects an empty impl list', () => {
    expect(() => new LayerStack('test', [])).toThrow(/at least one/);
  });

  it('rejects an enhancerOnly impl in the first slot', () => {
    expect(() => new LayerStack('test', [mkImpl('only', { enhancer: true })]))
      .toThrow(/enhancerOnly/);
  });

  it('describes impl order', () => {
    const stack = new LayerStack('test', [mkImpl('a'), mkImpl('b', { enhancer: true })]);
    expect(stack.describe()).toEqual(['a', 'b']);
  });
});

describe('LayerRegistry', () => {
  it('registers and resolves impls by name', async () => {
    const reg = new LayerRegistry<{ seed: string }, Acc>('test');
    reg.register(mkImpl('first')).register(mkImpl('second', { enhancer: true }));
    expect(reg.list()).toEqual(['first', 'second']);
    const stack = reg.resolve(['first', 'second']);
    const out = await stack.run({ seed: 'Y' }, ctx);
    expect(out.trail).toEqual(['seed:Y', 'first', 'second']);
  });

  it('rejects duplicate registration', () => {
    const reg = new LayerRegistry<{ seed: string }, Acc>('test');
    reg.register(mkImpl('only'));
    expect(() => reg.register(mkImpl('only'))).toThrow(/duplicate/);
  });

  it('rejects unknown impls with the available list in the error', () => {
    const reg = new LayerRegistry<{ seed: string }, Acc>('test');
    reg.register(mkImpl('alpha'));
    reg.register(mkImpl('beta', { enhancer: true }));
    expect(() => reg.resolve(['gamma'])).toThrow(/unknown.*gamma.*alpha.*beta/s);
  });

  it('rejects a zero-impl config', () => {
    const reg = new LayerRegistry<{ seed: string }, Acc>('test');
    reg.register(mkImpl('first'));
    expect(() => reg.resolve([])).toThrow(/zero implementations/);
  });
});
