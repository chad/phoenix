/**
 * Change Classification model.
 */

export enum ChangeClass {
  /** Trivial — formatting only */
  A = 'A',
  /** Local semantic change */
  B = 'B',
  /** Contextual semantic shift */
  C = 'C',
  /** Uncertain */
  D = 'D',
}

export interface ClassificationSignals {
  /** Normalized text edit distance (0 = identical, 1 = completely different) */
  norm_diff: number;
  /** clause_semhash changed */
  semhash_delta: boolean;
  /** context_semhash_cold changed */
  context_cold_delta: boolean;
  /** Jaccard distance of extracted terms (0 = identical, 1 = no overlap) */
  term_ref_delta: number;
  /** Section path changed */
  section_structure_delta: boolean;
  /** Number of affected canonical nodes */
  canon_impact: number;
}

export interface ChangeClassification {
  /** The assigned class */
  change_class: ChangeClass;
  /** Confidence score 0–1 */
  confidence: number;
  /** Signals used for classification */
  signals: ClassificationSignals;
  /** Clause IDs involved */
  clause_id_before?: string;
  clause_id_after?: string;
  /** Whether an LLM was used to resolve a D-class classification */
  llm_resolved?: boolean;
}

export enum DRateLevel {
  TARGET = 'TARGET',       // ≤5%
  ACCEPTABLE = 'ACCEPTABLE', // ≤10%
  WARNING = 'WARNING',     // ≤15%
  ALARM = 'ALARM',         // >15%
}

export interface DRateStatus {
  rate: number;
  level: DRateLevel;
  window_size: number;
  d_count: number;
  total_count: number;
}

export enum BootstrapState {
  BOOTSTRAP_COLD = 'BOOTSTRAP_COLD',
  BOOTSTRAP_WARMING = 'BOOTSTRAP_WARMING',
  STEADY_STATE = 'STEADY_STATE',
}
