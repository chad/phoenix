/**
 * Experiment Configuration — Single source of truth for all tunable parameters.
 *
 * The AI agent edits ONLY this file during experiment loops.
 * Default values match the original hardcoded constants exactly.
 */

export const CONFIG = {
  // ─── resolution.ts ────────────────────────────────────────────────────────
  MAX_DEGREE: 12,
  MIN_SHARED_TAGS: 1,
  JACCARD_DEDUP_THRESHOLD: 0.7,
  FINGERPRINT_PREFIX_COUNT: 8,
  DOC_FREQ_CUTOFF: 0.5,
  SAME_TYPE_REFINE_THRESHOLD: 0.2,

  // ─── canonicalizer.ts — scoring weights ───────────────────────────────────
  CONSTRAINT_NEGATION_WEIGHT: 4,
  CONSTRAINT_LIMIT_WEIGHT: 3,
  CONSTRAINT_NUMERIC_WEIGHT: 2,
  INVARIANT_SIGNAL_WEIGHT: 4,
  REQUIREMENT_MODAL_WEIGHT: 2,
  REQUIREMENT_KEYWORD_WEIGHT: 2,
  REQUIREMENT_VERB_WEIGHT: 1,
  DEFINITION_EXPLICIT_WEIGHT: 4,
  DEFINITION_COLON_WEIGHT: 3,
  CONTEXT_NO_MODAL_WEIGHT: 1,
  CONTEXT_SHORT_WEIGHT: 1,
  HEADING_CONTEXT_BONUS: 2,
  CONSTRAINT_MUST_BONUS: 1,
  MIN_CONFIDENCE: 0.3,
  MAX_CONFIDENCE: 1.0,
  DEFINITION_MAX_LENGTH: 200,
  MIN_EXTRACTION_LENGTH: 5,
  MIN_TERM_LENGTH: 3,
  MIN_WORD_LENGTH: 2,

  // ─── sentence-segmenter.ts ────────────────────────────────────────────────
  MIN_LIST_ITEM_LENGTH: 3,
  MIN_PROSE_SENTENCE_LENGTH: 3,
  PROSE_SPLIT_THRESHOLD: 80,
  MIN_SPLIT_PART_LENGTH: 3,

  // ─── warm-hasher.ts ───────────────────────────────────────────────────────
  WARM_MIN_CONFIDENCE: 0.3,

  // ─── classifier.ts ────────────────────────────────────────────────────────
  CLASS_A_NORM_DIFF: 0.1,
  CLASS_A_TERM_DELTA: 0.2,
  CLASS_B_NORM_DIFF: 0.5,
  CLASS_B_TERM_DELTA: 0.5,
  CLASS_D_HIGH_CHANGE: 0.7,
  ANCHOR_MATCH_THRESHOLD: 0.5,
};
