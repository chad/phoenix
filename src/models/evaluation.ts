/**
 * Evaluation model — durable behavioral truth surface.
 *
 * Evaluations bind to behavior at IU boundaries, not to implementation internals.
 * They survive regeneration. The separating question: "Would this assertion still
 * be meaningful if the entire implementation were replaced tomorrow?"
 *
 * Distinct from implementation tests, which die with the code they describe.
 * (See: Fowler, The Phoenix Architecture, Chapter 5)
 */

/** What the evaluation asserts about */
export type EvaluationBinding =
  | 'domain_rule'        // business logic invariant
  | 'boundary_contract'  // input/output shape at IU boundary
  | 'constraint'         // latency, throughput, error rate
  | 'invariant'          // property that holds across all states
  | 'failure_mode';      // behavior under error conditions

/** How confident we are the evaluation captures real behavior */
export type EvaluationOrigin =
  | 'specified'          // derived from spec/intent
  | 'characterization'   // captured from existing implementation (legacy)
  | 'incident'           // added after a production incident
  | 'audit';             // added during evaluation audit

export interface Evaluation {
  /** Unique ID, content-addressed */
  eval_id: string;
  /** Human-readable name */
  name: string;
  /** Which IU boundary this evaluates */
  iu_id: string;
  /** What this evaluation binds to */
  binding: EvaluationBinding;
  /** How this evaluation was created */
  origin: EvaluationOrigin;
  /** Behavioral assertion in human-readable form */
  assertion: string;
  /**
   * Given/When/Then specification:
   * - given: preconditions
   * - when: action at the boundary
   * - then: expected observable outcome
   */
  given: string;
  when: string;
  then: string;
  /** Canonical node IDs this evaluation covers */
  canon_ids: string[];
  /** Whether this is a conservation-layer evaluation (surface stability) */
  conservation: boolean;
  /** Provenance: why this evaluation exists */
  rationale?: string;
  /** Link to incident/decision that motivated this */
  provenance_ref?: string;
  /** Created timestamp */
  created_at: string;
  /** Last verified timestamp */
  last_verified_at?: string;
  /** Status of last verification */
  last_status?: 'pass' | 'fail' | 'untested';
}

/**
 * Evaluation coverage report for an IU
 */
export interface EvaluationCoverage {
  iu_id: string;
  iu_name: string;
  total_evaluations: number;
  by_binding: Record<EvaluationBinding, number>;
  by_origin: Record<EvaluationOrigin, number>;
  canon_ids_covered: string[];
  canon_ids_uncovered: string[];
  coverage_ratio: number;
  conservation_count: number;
  /** Gap analysis */
  gaps: EvaluationGap[];
}

export interface EvaluationGap {
  category: 'missing_boundary' | 'missing_invariant' | 'missing_failure_mode' | 'untested' | 'stale';
  subject: string;
  message: string;
  recommended_action: string;
}
