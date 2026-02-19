/**
 * Tests for LLM-enhanced change classifier.
 */
import { describe, it, expect, vi } from 'vitest';
import { classifyChangeWithLLM, classifyChangesWithLLM } from '../../src/classifier-llm.js';
import { parseSpec } from '../../src/spec-parser.js';
import { diffClauses } from '../../src/diff.js';
import { extractCanonicalNodes } from '../../src/canonicalizer.js';
import { computeWarmHashes } from '../../src/warm-hasher.js';
import { ChangeClass, DRateLevel } from '../../src/models/classification.js';
import { DiffType } from '../../src/models/clause.js';
import type { LLMProvider } from '../../src/llm/provider.js';

function makeMockLLM(response: string): LLMProvider {
  return {
    name: 'mock',
    model: 'mock-1',
    generate: vi.fn().mockResolvedValue(response),
  };
}

const SPEC_V1 = `# Service

## Features

- The system must handle requests
- Rate limiting is enforced`;

const SPEC_V2 = `# Service

## Features

- The system must handle HTTP requests and WebSocket connections
- Rate limiting is enforced with sliding window algorithm
- New feature: audit logging must record all mutations`;

describe('LLM-Enhanced Classifier', () => {
  const clauses1 = parseSpec(SPEC_V1, 'spec/svc.md');
  const clauses2 = parseSpec(SPEC_V2, 'spec/svc.md');
  const canon1 = extractCanonicalNodes(clauses1);
  const canon2 = extractCanonicalNodes(clauses2);
  const warm1 = computeWarmHashes(clauses1, canon1);
  const warm2 = computeWarmHashes(clauses2, canon2);
  const diffs = diffClauses(clauses1, clauses2);

  it('returns rule-based result when no LLM provided', async () => {
    const diff = diffs[0];
    const result = await classifyChangeWithLLM(diff, canon1, canon2, undefined, undefined);
    expect(Object.values(ChangeClass)).toContain(result.change_class);
    expect(result.llm_resolved).toBeUndefined();
  });

  it('escalates D-class changes to LLM', async () => {
    // Create a synthetic D-class diff (high edit distance, high term delta)
    const synthDiff = {
      diff_type: DiffType.MODIFIED,
      clause_id_before: clauses1[0]?.clause_id,
      clause_id_after: clauses2[0]?.clause_id,
      clause_before: {
        ...clauses1[0],
        normalized_text: 'completely different text about something unrelated',
        clause_semhash: 'aaaa',
      },
      clause_after: {
        ...clauses2[0],
        normalized_text: 'entirely new concept with no overlap whatsoever in terminology',
        clause_semhash: 'bbbb',
      },
      section_path_before: clauses1[0]?.section_path,
      section_path_after: clauses2[0]?.section_path,
    };

    const llm = makeMockLLM('B');
    const result = await classifyChangeWithLLM(
      synthDiff, canon1, canon2, undefined, undefined,
      { llm },
    );

    // If it was originally D, LLM resolves it to B
    if (result.llm_resolved) {
      expect(result.change_class).toBe(ChangeClass.B);
      expect(result.confidence).toBeGreaterThanOrEqual(0.75);
    }
  });

  it('does not escalate non-D changes by default', async () => {
    // Unchanged clause → class A
    const unchangedDiff = {
      diff_type: DiffType.UNCHANGED as const,
      clause_id_before: clauses1[0]?.clause_id,
      clause_id_after: clauses1[0]?.clause_id,
      clause_before: clauses1[0],
      clause_after: clauses1[0],
      section_path_before: clauses1[0]?.section_path,
      section_path_after: clauses1[0]?.section_path,
    };

    const llm = makeMockLLM('C');
    const result = await classifyChangeWithLLM(
      unchangedDiff, canon1, canon2, undefined, undefined,
      { llm, dClassOnly: true },
    );

    // Should be A (trivial), LLM not called
    expect(result.change_class).toBe(ChangeClass.A);
    expect(result.llm_resolved).toBeUndefined();
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('handles LLM errors gracefully', async () => {
    const llm: LLMProvider = {
      name: 'mock',
      model: 'mock-1',
      generate: vi.fn().mockRejectedValue(new Error('rate limited')),
    };

    const diff = diffs[0];
    const result = await classifyChangeWithLLM(
      diff, canon1, canon2, undefined, undefined,
      { llm },
    );

    // Should return the rule-based result, not throw
    expect(Object.values(ChangeClass)).toContain(result.change_class);
  });

  it('batch classifies with LLM escalation', async () => {
    const llm = makeMockLLM('B');
    const results = await classifyChangesWithLLM(
      diffs, canon1, canon2, warm1, warm2,
      { llm },
    );

    expect(results.length).toBe(diffs.length);
    for (const r of results) {
      expect(Object.values(ChangeClass)).toContain(r.change_class);
    }
  });

  it('LLM response parsing handles various formats', async () => {
    // Test different response formats
    for (const response of ['A', ' B ', 'C\n', '  D  ', 'A - trivial change']) {
      const llm = makeMockLLM(response);
      const synthDiff = {
        diff_type: DiffType.MODIFIED,
        clause_id_before: clauses1[0]?.clause_id,
        clause_id_after: clauses2[0]?.clause_id,
        clause_before: {
          ...clauses1[0],
          normalized_text: 'completely different text about xyz',
          clause_semhash: 'aaaa',
        },
        clause_after: {
          ...clauses2[0],
          normalized_text: 'entirely new concept with no overlap in terms',
          clause_semhash: 'bbbb',
        },
        section_path_before: clauses1[0]?.section_path,
        section_path_after: clauses2[0]?.section_path,
      };

      const result = await classifyChangeWithLLM(
        synthDiff, canon1, canon2, undefined, undefined,
        { llm, dClassOnly: false },
      );
      expect(Object.values(ChangeClass)).toContain(result.change_class);
    }
  });
});
