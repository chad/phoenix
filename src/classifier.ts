/**
 * A/B/C/D Change Classifier
 *
 * Classifies each clause change using multiple signals.
 *
 * A = Trivial (formatting only)
 * B = Local semantic change
 * C = Contextual semantic shift
 * D = Uncertain
 */

import type { Clause, ClauseDiff } from './models/clause.js';
import { DiffType } from './models/clause.js';
import type { CanonicalNode } from './models/canonical.js';
import type { ClassificationSignals, ChangeClassification } from './models/classification.js';
import { ChangeClass } from './models/classification.js';
import { extractTerms } from './canonicalizer.js';
import { CONFIG } from './experiment-config.js';

/**
 * Classify a single clause diff.
 */
export function classifyChange(
  diff: ClauseDiff,
  canonicalNodesBefore: CanonicalNode[],
  canonicalNodesAfter: CanonicalNode[],
  warmHashBefore?: string,
  warmHashAfter?: string,
): ChangeClassification {
  // Pure additions and removals
  if (diff.diff_type === DiffType.ADDED) {
    const canonImpact = countCanonImpact(undefined, diff.clause_after, canonicalNodesBefore, canonicalNodesAfter);
    return {
      change_class: ChangeClass.B,
      confidence: 0.9,
      signals: {
        norm_diff: 1,
        semhash_delta: true,
        context_cold_delta: true,
        term_ref_delta: 1,
        section_structure_delta: true,
        canon_impact: canonImpact,
      },
      clause_id_after: diff.clause_id_after,
    };
  }

  if (diff.diff_type === DiffType.REMOVED) {
    const canonImpact = countCanonImpact(diff.clause_before, undefined, canonicalNodesBefore, canonicalNodesAfter);
    return {
      change_class: ChangeClass.B,
      confidence: 0.9,
      signals: {
        norm_diff: 1,
        semhash_delta: true,
        context_cold_delta: true,
        term_ref_delta: 1,
        section_structure_delta: true,
        canon_impact: canonImpact,
      },
      clause_id_before: diff.clause_id_before,
    };
  }

  if (diff.diff_type === DiffType.UNCHANGED) {
    // Check if warm hash changed (contextual shift even without content change)
    if (warmHashBefore && warmHashAfter && warmHashBefore !== warmHashAfter) {
      return {
        change_class: ChangeClass.C,
        confidence: 0.8,
        signals: {
          norm_diff: 0,
          semhash_delta: false,
          context_cold_delta: false,
          term_ref_delta: 0,
          section_structure_delta: false,
          canon_impact: 0,
        },
        clause_id_before: diff.clause_id_before,
        clause_id_after: diff.clause_id_after,
      };
    }
    return {
      change_class: ChangeClass.A,
      confidence: 1.0,
      signals: {
        norm_diff: 0,
        semhash_delta: false,
        context_cold_delta: false,
        term_ref_delta: 0,
        section_structure_delta: false,
        canon_impact: 0,
      },
      clause_id_before: diff.clause_id_before,
      clause_id_after: diff.clause_id_after,
    };
  }

  // MODIFIED or MOVED — compute signals
  const before = diff.clause_before!;
  const after = diff.clause_after!;

  const normDiff = normalizedEditDistance(before.normalized_text, after.normalized_text);
  const semhashDelta = before.clause_semhash !== after.clause_semhash;
  const contextColdDelta = before.context_semhash_cold !== after.context_semhash_cold;
  const termDelta = termJaccardDistance(before.normalized_text, after.normalized_text);
  const sectionDelta = before.section_path.join('/') !== after.section_path.join('/');
  const canonImpact = countCanonImpact(before, after, canonicalNodesBefore, canonicalNodesAfter);

  // Anchor-based matching: detect "same concept, different wording"
  // If anchors match across before/after, the change is likely cosmetic (A/B, not C/D)
  const anchorMatch = computeAnchorOverlap(before, after, canonicalNodesBefore, canonicalNodesAfter);

  const signals: ClassificationSignals = {
    norm_diff: normDiff,
    semhash_delta: semhashDelta,
    context_cold_delta: contextColdDelta,
    term_ref_delta: termDelta,
    section_structure_delta: sectionDelta,
    canon_impact: canonImpact,
  };

  // Classification logic
  if (!semhashDelta) {
    // Content identical, only moved
    return {
      change_class: ChangeClass.A,
      confidence: 0.95,
      signals,
      clause_id_before: diff.clause_id_before,
      clause_id_after: diff.clause_id_after,
    };
  }

  // Compute confidence and classify
  if (normDiff < CONFIG.CLASS_A_NORM_DIFF && termDelta < CONFIG.CLASS_A_TERM_DELTA) {
    // Very small change, high confidence it's trivial
    return {
      change_class: ChangeClass.A,
      confidence: 0.85,
      signals,
      clause_id_before: diff.clause_id_before,
      clause_id_after: diff.clause_id_after,
    };
  }

  if (canonImpact > 0 || contextColdDelta) {
    // Affects canonical graph or structural context
    const confidence = canonImpact > 2 ? 0.9 : 0.7;
    return {
      change_class: ChangeClass.C,
      confidence,
      signals,
      clause_id_before: diff.clause_id_before,
      clause_id_after: diff.clause_id_after,
    };
  }

  // Local semantic change
  if (normDiff < CONFIG.CLASS_B_NORM_DIFF && termDelta < CONFIG.CLASS_B_TERM_DELTA) {
    return {
      change_class: ChangeClass.B,
      confidence: 0.8,
      signals,
      clause_id_before: diff.clause_id_before,
      clause_id_after: diff.clause_id_after,
    };
  }

  // High uncertainty — but check anchor overlap first
  if (normDiff > CONFIG.CLASS_D_HIGH_CHANGE || termDelta > CONFIG.CLASS_D_HIGH_CHANGE) {
    // If anchors match, the concepts are the same despite heavy rewording → B not D
    if (anchorMatch > CONFIG.ANCHOR_MATCH_THRESHOLD) {
      return {
        change_class: ChangeClass.B,
        confidence: 0.65,
        signals,
        clause_id_before: diff.clause_id_before,
        clause_id_after: diff.clause_id_after,
      };
    }
    return {
      change_class: ChangeClass.D,
      confidence: 0.4,
      signals,
      clause_id_before: diff.clause_id_before,
      clause_id_after: diff.clause_id_after,
    };
  }

  return {
    change_class: ChangeClass.B,
    confidence: 0.6,
    signals,
    clause_id_before: diff.clause_id_before,
    clause_id_after: diff.clause_id_after,
  };
}

/**
 * Classify all diffs in a change set.
 */
export function classifyChanges(
  diffs: ClauseDiff[],
  canonicalNodesBefore: CanonicalNode[],
  canonicalNodesAfter: CanonicalNode[],
  warmHashesBefore?: Map<string, string>,
  warmHashesAfter?: Map<string, string>,
): ChangeClassification[] {
  return diffs.map(diff => {
    const warmBefore = diff.clause_id_before ? warmHashesBefore?.get(diff.clause_id_before) : undefined;
    const warmAfter = diff.clause_id_after ? warmHashesAfter?.get(diff.clause_id_after) : undefined;
    return classifyChange(diff, canonicalNodesBefore, canonicalNodesAfter, warmBefore, warmAfter);
  });
}

/**
 * Normalized edit distance (Levenshtein / max length).
 * Returns 0 for identical, 1 for completely different.
 */
function normalizedEditDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0 || b.length === 0) return 1;

  const maxLen = Math.max(a.length, b.length);
  const dist = levenshtein(a, b);
  return dist / maxLen;
}

/**
 * Levenshtein distance (optimized for reasonable string lengths).
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }

  return dp[n];
}

/**
 * Jaccard distance of extracted terms between two texts.
 */
function termJaccardDistance(textA: string, textB: string): number {
  const termsA = new Set(extractTerms(textA));
  const termsB = new Set(extractTerms(textB));

  if (termsA.size === 0 && termsB.size === 0) return 0;

  const intersection = [...termsA].filter(t => termsB.has(t)).length;
  const union = new Set([...termsA, ...termsB]).size;

  return 1 - (intersection / union);
}

/**
 * Compute anchor overlap: what fraction of canon nodes from the 'before' clause
 * have matching anchors in the 'after' graph. High overlap → same concepts, just reworded.
 */
function computeAnchorOverlap(
  before: Clause,
  after: Clause,
  canonBefore: CanonicalNode[],
  canonAfter: CanonicalNode[],
): number {
  const nodesBefore = canonBefore.filter(n => n.source_clause_ids.includes(before.clause_id));
  if (nodesBefore.length === 0) return 0;

  // Collect all anchors from after nodes linked to the after clause
  const nodesAfter = canonAfter.filter(n => n.source_clause_ids.includes(after.clause_id));
  const afterAnchors = new Set(nodesAfter.map(n => n.canon_anchor).filter(Boolean));

  if (afterAnchors.size === 0) return 0;

  let matched = 0;
  for (const node of nodesBefore) {
    if (node.canon_anchor && afterAnchors.has(node.canon_anchor)) matched++;
  }

  return matched / nodesBefore.length;
}

/**
 * Count canonical nodes affected by a change.
 */
function countCanonImpact(
  before: Clause | undefined,
  after: Clause | undefined,
  canonBefore: CanonicalNode[],
  canonAfter: CanonicalNode[],
): number {
  let impact = 0;

  if (before) {
    impact += canonBefore.filter(n => n.source_clause_ids.includes(before.clause_id)).length;
  }
  if (after) {
    impact += canonAfter.filter(n => n.source_clause_ids.includes(after.clause_id)).length;
  }

  return impact;
}
