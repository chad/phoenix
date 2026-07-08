/**
 * Evidence model — proof that an IU meets its risk-tier requirements.
 */

export enum EvidenceKind {
  TYPECHECK = 'typecheck',
  LINT = 'lint',
  BOUNDARY_VALIDATION = 'boundary_validation',
  UNIT_TEST = 'unit_tests',
  PROPERTY_TEST = 'property_tests',
  STATIC_ANALYSIS = 'static_analysis',
  THREAT_NOTE = 'threat_note',
  HUMAN_SIGNOFF = 'human_signoff',
}

export enum EvidenceStatus {
  PASS = 'PASS',
  FAIL = 'FAIL',
  PENDING = 'PENDING',
  SKIPPED = 'SKIPPED',
}

export interface EvidenceRecord {
  evidence_id: string;
  kind: EvidenceKind;
  status: EvidenceStatus;
  iu_id: string;
  /** Canonical nodes this evidence covers */
  canon_ids: string[];
  /** Hash of the artifact this evidence was run against */
  artifact_hash?: string;
  message?: string;
  timestamp: string;
}

export interface PolicyEvaluation {
  iu_id: string;
  iu_name: string;
  risk_tier: string;
  required: string[];
  satisfied: string[];
  missing: string[];
  failed: string[];
  /** Required kinds whose only evidence was stale (bound to a superseded artifact). */
  stale?: string[];
  verdict: 'PASS' | 'FAIL' | 'INCOMPLETE';
}

export interface CascadeEvent {
  source_iu_id: string;
  source_iu_name: string;
  failure_kind: string;
  affected_iu_ids: string[];
  actions: CascadeAction[];
}

export interface CascadeAction {
  iu_id: string;
  iu_name: string;
  action: string;
  reason: string;
}
