import { describe, it, expect } from 'vitest';
import { extractVocabularies, extractLineProvenance, buildPrompt } from '../../src/llm/prompt.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

function cn(statement: string): CanonicalNode {
  return { statement } as unknown as CanonicalNode;
}
const vocabFor = (stmt: string, label: string): string[] => {
  const v = extractVocabularies([cn(stmt)]).find(x => x.label.toLowerCase() === label);
  return v ? v.values : [];
};

describe('adversarial: prompt extractVocabularies', () => {
  it('#30 "one of low, medium, high" (no colon) extracts the full list', () => {
    expect(vocabFor('Priority must be one of low, medium, high.', 'priority')).toEqual(['low', 'medium', 'high']);
  });

  it('#54 "one of low, medium or high" (no colon, or-separated) extracts the full list', () => {
    expect(vocabFor('Priority must be one of low, medium or high.', 'priority')).toEqual(['low', 'medium', 'high']);
  });

  it('#53 Oxford-comma "a, b, or c" keeps the last value', () => {
    expect(vocabFor('Status one of: a, b, or c.', 'status')).toEqual(['a', 'b', 'c']);
  });

  it('the colon form still works (guard)', () => {
    expect(vocabFor('Status must be one of: todo, in_progress, done.', 'status')).toEqual(['todo', 'in_progress', 'done']);
  });
});

describe('adversarial: prompt extractLineProvenance', () => {
  it('#56 inline block marker /*phx:R1*/ inside a template literal is recognized + stripped', () => {
    const labels = [{ label: 'R1', canonId: 'canon-1', type: 'REQUIREMENT', statement: 's' }] as never;
    const code = 'const x = `<div>/*phx:R1*/</div>`;';
    const out = extractLineProvenance(code, labels);
    expect(out.code).not.toContain('phx:');
    expect(out.lineProvenance['0']).toBe('canon-1');
  });
});

describe('adversarial: prompt buildPrompt metadata escaping', () => {
  it('#55 an IU name with an apostrophe yields a valid (escaped) string literal', () => {
    const iu: ImplementationUnit = {
      iu_id: 'IU1', kind: 'module', name: "User's Module", risk_tier: 'low',
      contract: { description: 'd', inputs: [], outputs: [], invariants: [] },
      source_canon_ids: [], dependencies: [],
      boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
      evidence_policy: { required: [] }, output_files: ['src/generated/x/x.ts'],
    };
    const prompt = buildPrompt(iu, []);
    expect(prompt).toContain('"User\'s Module"'); // JSON-escaped, parseable
    expect(prompt).not.toContain("name: 'User's Module'"); // not the broken single-quoted form
  });
});
