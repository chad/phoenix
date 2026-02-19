/**
 * Tests for LLM-enhanced canonicalization (v2: normalizer mode).
 */
import { describe, it, expect, vi } from 'vitest';
import { extractCanonicalNodesLLM } from '../../src/canonicalizer-llm.js';
import { extractCandidates } from '../../src/canonicalizer.js';
import { parseSpec } from '../../src/spec-parser.js';
import { CanonicalType } from '../../src/models/canonical.js';
import type { LLMProvider, GenerateOptions } from '../../src/llm/provider.js';

function makeMockLLM(response: string): LLMProvider {
  return {
    name: 'mock',
    model: 'mock-1',
    generate: vi.fn().mockResolvedValue(response),
  };
}

const SPEC = `# Auth Service

## Requirements

- Users must authenticate with email and password
- Sessions expire after 24 hours
- Failed login attempts are rate-limited to 5 per minute

## Security Constraints

- All endpoints must use HTTPS
- Tokens must be signed with RS256`;

describe('LLM-Enhanced Canonicalizer (v2 normalizer mode)', () => {
  const clauses = parseSpec(SPEC, 'spec/auth.md');

  it('falls back to rule-based when no LLM provided', async () => {
    const nodes = await extractCanonicalNodesLLM(clauses, null);
    expect(nodes.length).toBeGreaterThan(0);
    // Should still work — rule-based extraction + resolution
    const reqs = nodes.filter(n => n.type === CanonicalType.REQUIREMENT);
    expect(reqs.length).toBeGreaterThan(0);
  });

  it('normalizes candidate statements via LLM', async () => {
    const llm = makeMockLLM('{"statement": "The system shall authenticate users via email and password"}');
    const nodes = await extractCanonicalNodesLLM(clauses, llm);

    // Should have nodes (rule-based extraction + LLM normalization)
    expect(nodes.length).toBeGreaterThan(0);

    // LLM was called for each non-CONTEXT candidate
    const { candidates } = extractCandidates(clauses);
    const nonContext = candidates.filter(c => c.type !== CanonicalType.CONTEXT);
    expect(llm.generate).toHaveBeenCalledTimes(nonContext.length);
  });

  it('calls LLM with normalizer system prompt and temperature 0', async () => {
    const llm = makeMockLLM('{"statement": "normalized text"}');
    await extractCanonicalNodesLLM(clauses, llm);

    const callArgs = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = callArgs[1] as GenerateOptions;
    expect(options.system).toContain('canonical form');
    expect(options.temperature).toBe(0);
    expect(options.maxTokens).toBe(150);
  });

  it('falls back to rule-based on LLM error', async () => {
    const llm: LLMProvider = {
      name: 'mock',
      model: 'mock-1',
      generate: vi.fn().mockRejectedValue(new Error('API timeout')),
    };

    const nodes = await extractCanonicalNodesLLM(clauses, llm);
    // Should still produce nodes via fallback
    expect(nodes.length).toBeGreaterThan(0);
  });

  it('falls back to original statement on invalid LLM response', async () => {
    const llm = makeMockLLM('Sorry, I cannot help with that.');
    const nodes = await extractCanonicalNodesLLM(clauses, llm);
    // Falls back per-node — still produces nodes
    expect(nodes.length).toBeGreaterThan(0);
  });

  it('preserves provenance through normalization', async () => {
    const llm = makeMockLLM('{"statement": "The system shall authenticate users"}');
    const nodes = await extractCanonicalNodesLLM(clauses, llm);

    for (const node of nodes) {
      expect(node.source_clause_ids.length).toBeGreaterThan(0);
      // Each source clause should be from our parsed clauses
      const clauseIds = new Set(clauses.map(c => c.clause_id));
      for (const srcId of node.source_clause_ids) {
        expect(clauseIds.has(srcId)).toBe(true);
      }
    }
  });

  it('marks LLM-normalized nodes with extraction_method=llm', async () => {
    const llm = makeMockLLM('{"statement": "The system shall authenticate users"}');
    const nodes = await extractCanonicalNodesLLM(clauses, llm);

    const llmNodes = nodes.filter(n => n.extraction_method === 'llm');
    // At least some nodes should be marked as LLM-normalized
    expect(llmNodes.length).toBeGreaterThan(0);
  });

  it('skips CONTEXT nodes for LLM normalization', async () => {
    const simpleSpec = '# Title\n\nJust some description.\n\n## Reqs\n\n- Must do X.';
    const simpleClauses = parseSpec(simpleSpec, 'test.md');
    const llm = makeMockLLM('{"statement": "normalized"}');
    await extractCanonicalNodesLLM(simpleClauses, llm);

    // CONTEXT nodes should NOT trigger LLM calls
    const { candidates } = extractCandidates(simpleClauses);
    const nonContext = candidates.filter(c => c.type !== CanonicalType.CONTEXT);
    expect(llm.generate).toHaveBeenCalledTimes(nonContext.length);
  });
});
