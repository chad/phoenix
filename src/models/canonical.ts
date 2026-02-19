/**
 * Canonical Node — structured requirement extracted from clauses.
 *
 * v2: Two-phase pipeline (extraction → resolution).
 * Added CONTEXT type, confidence, typed edges, hierarchy, anchors.
 */

export enum CanonicalType {
  REQUIREMENT = 'REQUIREMENT',
  CONSTRAINT = 'CONSTRAINT',
  INVARIANT = 'INVARIANT',
  DEFINITION = 'DEFINITION',
  CONTEXT = 'CONTEXT',
}

/** Typed edge between canonical nodes */
export type EdgeType =
  | 'constrains'
  | 'defines'
  | 'refines'
  | 'invariant_of'
  | 'duplicates'
  | 'relates_to';

export interface CanonicalNode {
  /** Content-addressed ID */
  canon_id: string;
  /** Soft identity — survives minor rephrasing */
  canon_anchor?: string;
  /** Node type */
  type: CanonicalType;
  /** Normalized canonical statement */
  statement: string;
  /** Extraction confidence 0.0–1.0 */
  confidence?: number;
  /** Provenance: source clause IDs */
  source_clause_ids: string[];
  /** Edges to related canonical nodes (IDs) */
  linked_canon_ids: string[];
  /** Typed edges: canon_id → edge type */
  link_types?: Record<string, EdgeType>;
  /** Parent in hierarchy (from heading structure) */
  parent_canon_id?: string;
  /** Extracted keywords/terms for linking */
  tags: string[];
  /** How was this node extracted */
  extraction_method?: 'rule' | 'llm';
}

/** Candidate node from Phase 1 (extraction), before resolution */
export interface CandidateNode {
  candidate_id: string;
  type: CanonicalType;
  statement: string;
  confidence: number;
  source_clause_ids: string[];
  tags: string[];
  sentence_index: number;
  extraction_method: 'rule' | 'llm';
}

/** Extraction coverage per clause */
export interface ExtractionCoverage {
  clause_id: string;
  total_sentences: number;
  extracted_sentences: number;
  context_sentences: number;
  coverage_pct: number;
  uncovered: { text: string; reason: 'no_match' | 'too_short' | 'meta_text' }[];
}

export interface CanonicalGraph {
  nodes: Record<string, CanonicalNode>;
  /** Provenance edges: canon_id → clause_id[] */
  provenance: Record<string, string[]>;
}
