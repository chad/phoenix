/**
 * LLM-Enhanced Change Classifier
 *
 * When the rule-based classifier produces a D (uncertain) classification,
 * optionally escalates to an LLM for a more informed decision.
 *
 * This reduces the D-rate by providing semantic understanding that
 * heuristics alone cannot achieve.
 */

import type { ClauseDiff } from './models/clause.js';
import type { CanonicalNode } from './models/canonical.js';
import type { ChangeClassification } from './models/classification.js';
import { ChangeClass } from './models/classification.js';
import type { LLMProvider } from './llm/provider.js';
import { classifyChange } from './classifier.js';

const CLASSIFY_SYSTEM_PROMPT = `You are a change classification expert for a version control system.

Classify the following spec change into exactly one category:
- A: Trivial change (formatting, whitespace, rewording with identical meaning)
- B: Local semantic change (meaning changed but only affects this clause)
- C: Contextual semantic shift (change affects meaning of related clauses/requirements)
- D: Truly uncertain (cannot determine impact without more context)

Respond with ONLY a single letter: A, B, C, or D.
Be conservative: prefer B over D when there's reasonable clarity.
Only use D when the change is genuinely ambiguous.`;

export interface LLMClassifierOptions {
  /** LLM provider for D-class resolution. */
  llm: LLMProvider;
  /** Only escalate D-class to LLM. Default: true */
  dClassOnly?: boolean;
}

/**
 * Classify a change, optionally using LLM for uncertain (D) results.
 */
export async function classifyChangeWithLLM(
  diff: ClauseDiff,
  canonBefore: CanonicalNode[],
  canonAfter: CanonicalNode[],
  warmBefore: string | undefined,
  warmAfter: string | undefined,
  options?: LLMClassifierOptions,
): Promise<ChangeClassification> {
  // First: rule-based classification
  const result = classifyChange(diff, canonBefore, canonAfter, warmBefore, warmAfter);

  // If no LLM or not D-class, return as-is
  if (!options?.llm) return result;
  if (options.dClassOnly !== false && result.change_class !== ChangeClass.D) {
    return result;
  }

  // Escalate to LLM
  try {
    const llmClass = await resolveWithLLM(diff, options.llm);
    return {
      ...result,
      change_class: llmClass,
      confidence: llmClass === ChangeClass.D ? result.confidence : Math.max(result.confidence, 0.75),
      llm_resolved: true,
    };
  } catch {
    // LLM failed — keep the rule-based result
    return result;
  }
}

/**
 * Batch-classify changes, escalating D-class to LLM.
 */
export async function classifyChangesWithLLM(
  diffs: ClauseDiff[],
  canonBefore: CanonicalNode[],
  canonAfter: CanonicalNode[],
  warmBefore: Map<string, string> | undefined,
  warmAfter: Map<string, string> | undefined,
  options?: LLMClassifierOptions,
): Promise<ChangeClassification[]> {
  const results: ChangeClassification[] = [];

  for (const diff of diffs) {
    const wb = diff.clause_id_before ? warmBefore?.get(diff.clause_id_before) : undefined;
    const wa = diff.clause_id_after ? warmAfter?.get(diff.clause_id_after) : undefined;
    results.push(await classifyChangeWithLLM(diff, canonBefore, canonAfter, wb, wa, options));
  }

  return results;
}

async function resolveWithLLM(diff: ClauseDiff, llm: LLMProvider): Promise<ChangeClass> {
  const prompt = buildClassifyPrompt(diff);

  const response = await llm.generate(prompt, {
    system: CLASSIFY_SYSTEM_PROMPT,
    temperature: 0,
    maxTokens: 8,
  });

  const letter = response.trim().toUpperCase().charAt(0);

  switch (letter) {
    case 'A': return ChangeClass.A;
    case 'B': return ChangeClass.B;
    case 'C': return ChangeClass.C;
    case 'D': return ChangeClass.D;
    default: return ChangeClass.D; // Unrecognized → stay uncertain
  }
}

function buildClassifyPrompt(diff: ClauseDiff): string {
  const lines: string[] = [];

  lines.push('Classify the following spec change:');
  lines.push('');

  if (diff.clause_before) {
    lines.push('## Before:');
    lines.push(`Section: ${diff.section_path_before?.join(' > ') || '(root)'}`);
    lines.push(diff.clause_before.raw_text.trim());
    lines.push('');
  }

  if (diff.clause_after) {
    lines.push('## After:');
    lines.push(`Section: ${diff.section_path_after?.join(' > ') || '(root)'}`);
    lines.push(diff.clause_after.raw_text.trim());
    lines.push('');
  }

  if (!diff.clause_before) {
    lines.push('This is a NEW clause (added).');
  } else if (!diff.clause_after) {
    lines.push('This clause was REMOVED.');
  }

  lines.push('');
  lines.push('Respond with A, B, C, or D.');

  return lines.join('\n');
}
