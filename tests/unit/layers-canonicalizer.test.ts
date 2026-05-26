/**
 * Tests for the canonicalizer layer — verifies that the rule extractor
 * produces a working baseline, and that LLM enhancers receive the prior
 * candidates and re-resolve correctly.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseSpec } from '../../src/spec-parser.js';
import { canonicalizerRegistry, DEFAULT_CANONICALIZER_STACK } from '../../src/layers/canonicalizer/index.js';
import { buildPipeline } from '../../src/layers/pipeline.js';
import { defaultLayersConfig } from '../../src/layers/config.js';
import { CanonicalType } from '../../src/models/canonical.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import type { LayerContext } from '../../src/layers/types.js';

const SPEC = `# Auth Service

## Requirements

- Users must authenticate with email and password
- Sessions expire after 24 hours

## Security Constraints

- All endpoints must use HTTPS`;

function mockLLM(response: string): LLMProvider {
  return {
    name: 'mock',
    model: 'mock-1',
    generate: vi.fn().mockResolvedValue(response),
  };
}

describe('canonicalizer layer', () => {
  const clauses = parseSpec(SPEC, 'spec/auth.md');

  it('rule-extractor runs alone and produces candidates + resolved nodes', async () => {
    const stack = canonicalizerRegistry.resolve(['rule-extractor']);
    const out = await stack.run({ clauses }, {});
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.nodes.length).toBeGreaterThan(0);
    const reqs = out.nodes.filter(n => n.type === CanonicalType.REQUIREMENT);
    expect(reqs.length).toBeGreaterThan(0);
  });

  it('llm-normalizer receives prior candidates and rewrites statements', async () => {
    const llm = mockLLM('{"statement": "The system shall authenticate users via email and password"}');
    const ctx: LayerContext = { llm };
    const stack = canonicalizerRegistry.resolve(['rule-extractor', 'llm-normalizer']);
    const out = await stack.run({ clauses }, ctx);

    // LLM was called for at least one non-CONTEXT candidate
    expect((llm.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);

    // At least some nodes are marked as LLM-extracted
    expect(out.nodes.some(n => n.extraction_method === 'llm')).toBe(true);
  });

  it('llm-normalizer refuses to lead a stack (enhancerOnly)', () => {
    expect(() => canonicalizerRegistry.resolve(['llm-normalizer']))
      .toThrow(/enhancerOnly/);
  });

  it('default config matches the historical normalizer-on-rules behavior', () => {
    expect(defaultLayersConfig().canonicalizer).toEqual(DEFAULT_CANONICALIZER_STACK);
    expect(DEFAULT_CANONICALIZER_STACK).toEqual(['rule-extractor', 'llm-normalizer']);
  });

  it('Pipeline.canonicalize wires the configured stack and passes context.llm', async () => {
    const llm = mockLLM('{"statement": "The system shall authenticate users"}');
    const pipeline = buildPipeline({
      config: { ...defaultLayersConfig(), canonicalizer: ['rule-extractor', 'llm-normalizer'] },
      context: { llm },
    });
    const out = await pipeline.canonicalize({ clauses });
    expect(out.nodes.length).toBeGreaterThan(0);
    expect((llm.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('a custom enhancer can be registered and chained after extraction', async () => {
    // Use a fresh registry to keep the global registry stable across test runs.
    const { LayerRegistry } = await import('../../src/layers/types.js');
    type In = { clauses: typeof clauses };
    type Out = { candidates: any[]; nodes: any[] };
    const reg = new LayerRegistry<In, Out>('canonicalizer-test');
    const { ruleExtractor } = await import('../../src/layers/canonicalizer/rule-extractor.js');
    reg.register(ruleExtractor);
    reg.register({
      name: 'invariant-derivator',
      enhancerOnly: true,
      async run(_input, prior) {
        if (!prior) throw new Error('needs prior');
        // Pretend to derive an invariant per requirement.
        const derived = prior.nodes
          .filter(n => n.type === CanonicalType.REQUIREMENT)
          .map((n, i) => ({ ...n, canon_id: `derived-inv-${i}`, type: CanonicalType.INVARIANT }));
        return { candidates: prior.candidates, nodes: [...prior.nodes, ...derived] };
      },
    });
    const stack = reg.resolve(['rule-extractor', 'invariant-derivator']);
    const out = await stack.run({ clauses }, {});
    const invariants = out.nodes.filter(n => n.type === CanonicalType.INVARIANT);
    expect(invariants.length).toBeGreaterThan(0);
  });
});
