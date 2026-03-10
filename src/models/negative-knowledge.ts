/**
 * Negative Knowledge model — what was tried and failed.
 *
 * "What failed matters as much as what succeeded, and it disappears first."
 * Failed generation attempts, rejected approaches, incident-driven constraints.
 * Preserved across compaction. The system's immune memory.
 *
 * (See: Fowler, The Phoenix Architecture, Chapter 14)
 */

export type NegativeKnowledgeKind =
  | 'failed_generation'     // generation attempt that didn't pass evaluations
  | 'rejected_approach'     // architectural approach tried and abandoned
  | 'incident_constraint'   // constraint added after a production incident
  | 'deprecated_behavior'   // behavior intentionally removed with reason
  | 'known_limitation';     // known issue accepted with rationale

export interface NegativeKnowledge {
  /** Unique ID */
  nk_id: string;
  /** What kind of negative knowledge */
  kind: NegativeKnowledgeKind;
  /** Which IU or canonical node this applies to */
  subject_id: string;
  /** Subject type */
  subject_type: 'iu' | 'canonical_node' | 'system';
  /** Human-readable description of what was tried */
  what_was_tried: string;
  /** Why it failed or was rejected */
  why_it_failed: string;
  /** What constraint or lesson this implies for future regeneration */
  constraint_for_future: string;
  /** Reference to incident, post-mortem, or decision record */
  reference?: string;
  /** When this knowledge was recorded */
  recorded_at: string;
  /** Who recorded it */
  recorded_by?: string;
  /** Is this still relevant? (can be marked stale) */
  active: boolean;
}

/**
 * Check if a regeneration should consult negative knowledge before proceeding.
 */
export function hasRelevantNegativeKnowledge(
  records: NegativeKnowledge[],
  subjectId: string,
): NegativeKnowledge[] {
  return records.filter(nk =>
    nk.active &&
    nk.subject_id === subjectId
  );
}
