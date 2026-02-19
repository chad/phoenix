/**
 * Tests for LLM-enhanced canonicalization.
 */
import { describe, it, expect, vi } from 'vitest';
import { extractCanonicalNodesLLM } from '../../src/canonicalizer-llm.js';
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

describe('LLM-Enhanced Canonicalizer', () => {
  const clauses = parseSpec(SPEC, 'spec/auth.md');

  it('falls back to rule-based when no LLM provided', async () => {
    const nodes = await extractCanonicalNodesLLM(clauses, null);
    expect(nodes.length).toBeGreaterThan(0);
    // Should still work — this is the rule-based fallback
    const reqs = nodes.filter(n => n.type === CanonicalType.REQUIREMENT);
    expect(reqs.length).toBeGreaterThan(0);
  });

  it('uses LLM response to build canonical nodes', async () => {
    const llmResponse = JSON.stringify([
      { type: 'REQUIREMENT', statement: 'Users must authenticate with email and password', tags: ['authentication', 'email', 'password'] },
      { type: 'REQUIREMENT', statement: 'Sessions expire after 24 hours', tags: ['sessions', 'expiration'] },
      { type: 'CONSTRAINT', statement: 'Rate limit login attempts to 5 per minute', tags: ['rate-limit', 'login'] },
      { type: 'CONSTRAINT', statement: 'All endpoints must use HTTPS', tags: ['https', 'security'] },
      { type: 'CONSTRAINT', statement: 'Tokens must be signed with RS256', tags: ['tokens', 'rs256', 'signing'] },
    ]);

    const llm = makeMockLLM(llmResponse);
    const nodes = await extractCanonicalNodesLLM(clauses, llm);

    expect(nodes.length).toBe(5);
    expect(nodes.filter(n => n.type === CanonicalType.REQUIREMENT).length).toBe(2);
    expect(nodes.filter(n => n.type === CanonicalType.CONSTRAINT).length).toBe(3);

    // Each node should have provenance back to a clause
    for (const node of nodes) {
      expect(node.source_clause_ids.length).toBeGreaterThan(0);
      expect(node.tags.length).toBeGreaterThan(0);
    }
  });

  it('handles LLM returning markdown-fenced JSON', async () => {
    const llmResponse = '```json\n[\n  { "type": "REQUIREMENT", "statement": "Users must authenticate", "tags": ["auth"] }\n]\n```';
    const llm = makeMockLLM(llmResponse);
    const nodes = await extractCanonicalNodesLLM(clauses, llm);
    expect(nodes.length).toBe(1);
    expect(nodes[0].statement).toBe('Users must authenticate');
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

  it('falls back on invalid JSON response', async () => {
    const llm = makeMockLLM('Sorry, I cannot help with that.');
    const nodes = await extractCanonicalNodesLLM(clauses, llm);
    // Falls back to rule-based since LLM response is empty after parse
    expect(nodes.length).toBeGreaterThan(0);
  });

  it('links nodes with shared terms', async () => {
    const llmResponse = JSON.stringify([
      { type: 'REQUIREMENT', statement: 'User authentication via email login', tags: ['authentication', 'email', 'user', 'login'] },
      { type: 'CONSTRAINT', statement: 'Authentication login tokens must use RS256', tags: ['authentication', 'login', 'tokens', 'rs256'] },
    ]);

    const llm = makeMockLLM(llmResponse);
    const nodes = await extractCanonicalNodesLLM(clauses, llm);

    // Both nodes share "authentication" and "login" tags (2+ shared) — should be linked
    const linked = nodes.filter(n => n.linked_canon_ids.length > 0);
    expect(linked.length).toBe(2);
  });

  it('calls LLM with system prompt and low temperature', async () => {
    const llmResponse = JSON.stringify([
      { type: 'REQUIREMENT', statement: 'test', tags: ['test'] },
    ]);
    const llm = makeMockLLM(llmResponse);
    await extractCanonicalNodesLLM(clauses, llm);

    expect(llm.generate).toHaveBeenCalledTimes(1);
    const callArgs = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = callArgs[1] as GenerateOptions;
    expect(options.system).toBeTruthy();
    expect(options.temperature).toBe(0.1);
  });
});
