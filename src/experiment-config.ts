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
  SAME_TYPE_REFINE_THRESHOLD: 0.15,

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

  // ─── canonicalizer-llm.ts ─────────────────────────────────────────────────
  LLM_MODE: 'reclassifier' as 'normalizer' | 'extractor' | 'reclassifier',
  LLM_MODEL: 'claude-sonnet-4-20250514',
  LLM_NORMALIZER_TEMPERATURE: 0,
  LLM_NORMALIZER_MAX_TOKENS: 150,
  LLM_NORMALIZER_SYSTEM: `You are a requirements engineer. Rewrite the given statement in canonical form.
Rules:
- One clear sentence, present tense, active voice, no pronouns, no ambiguity.
- PRESERVE all technical terms, domain vocabulary, proper nouns, acronyms, and specific values exactly as written.
- PRESERVE key verbs and their objects (e.g., keep "authenticate with email" not "handle email authentication").
- Minimize rewording — only fix grammar, voice, and clarity. Do NOT paraphrase.
Output ONLY a JSON object: {"statement": "..."}
No markdown, no explanation.`,
  LLM_SELF_CONSISTENCY_K: 1,
  LLM_CONSISTENCY_TEMPERATURE: 0.3,
  LLM_RECLASSIFIER_SYSTEM: `Classify this specification statement into exactly one type.

Types:
- REQUIREMENT: Any statement where the system "must", "shall", or "will" do something. This includes actions, capabilities, behaviors, AND enforcement of rules. If a sentence says "X must Y" and Y is an action (validate, reject, compute, send, store, track, create, delete, update, lock, report, etc.), it is a REQUIREMENT, even if it involves limits or conditions. Most spec statements are REQUIREMENT.
- CONSTRAINT: ONLY for explicit prohibitions ("must not", "cannot", "forbidden") or pure numeric/size limits stated WITHOUT an action verb ("limited to 100 characters", "maximum 20 connections", "at most 5 per minute"). If a "must" sentence includes an action verb, it is NOT a constraint.
- INVARIANT: ONLY for statements using "always", "never", "at all times", "guaranteed", or "must remain". These describe properties that hold across ALL system states.
- DEFINITION: ONLY for statements that define what a term means ("X is defined as Y", "X means Y", "X: description").
- CONTEXT: Background/framing text with no modal verbs and no actionable content.

Output ONLY a JSON object: {"type": "REQUIREMENT"}
No markdown, no explanation.`,
  LLM_RECLASSIFIER_TEMPERATURE: 0,
  LLM_RECLASSIFIER_MAX_TOKENS: 20,
  LLM_EXTRACTOR_TEMPERATURE: 0.1,
  LLM_EXTRACTOR_MAX_TOKENS: 4096,
  LLM_EXTRACTOR_BATCH_SIZE: 20,
  LLM_EXTRACTOR_CONFIDENCE: 0.7,
  LLM_EXTRACTOR_SYSTEM: `You are a requirements engineer extracting structured canonical nodes from specification text.

For each meaningful statement, extract a JSON object with:
- type: one of REQUIREMENT, CONSTRAINT, INVARIANT, DEFINITION, CONTEXT
- statement: the normalized canonical statement (clear, unambiguous, one idea)
- tags: array of key domain terms (lowercase, no stop words)
- source_section: the section heading this was extracted from

Rules:
- REQUIREMENT: something the system must do (capabilities, features)
- CONSTRAINT: something the system must NOT do, or limits/bounds
- INVARIANT: something that must ALWAYS or NEVER hold
- DEFINITION: defines a term or concept
- CONTEXT: framing text that gives meaning but isn't actionable alone

Output a JSON array. No markdown fences, no explanation.
Every node MUST include source_section.`,

  // ─── classifier.ts ────────────────────────────────────────────────────────
  CLASS_A_NORM_DIFF: 0.1,
  CLASS_A_TERM_DELTA: 0.2,
  CLASS_B_NORM_DIFF: 0.5,
  CLASS_B_TERM_DELTA: 0.5,
  CLASS_D_HIGH_CHANGE: 0.7,
  ANCHOR_MATCH_THRESHOLD: 0.5,
};
