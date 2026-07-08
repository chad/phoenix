/**
 * Implementation Unit (IU) — stable compilation boundary.
 *
 * Maps canonical requirements to generated code modules.
 */

export type IUKind = 'module' | 'function';
export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface IUContract {
  /** Description of what this IU does */
  description: string;
  /** Input types / parameters */
  inputs: string[];
  /** Output types / return values */
  outputs: string[];
  /** Invariants that must hold */
  invariants: string[];
}

export interface BoundaryPolicy {
  code: {
    allowed_ius: string[];
    allowed_packages: string[];
    forbidden_ius: string[];
    forbidden_packages: string[];
    forbidden_paths: string[];
  };
  side_channels: {
    databases: string[];
    queues: string[];
    caches: string[];
    config: string[];
    external_apis: string[];
    files: string[];
  };
}

export interface EnforcementConfig {
  dependency_violation: { severity: 'error' | 'warning' };
  side_channel_violation: { severity: 'error' | 'warning' };
}

export interface EvidencePolicy {
  /** What evidence is required for this risk tier (ALL must be satisfied). */
  required: string[];
  /**
   * Alternative groups: each group is satisfied if AT LEAST ONE of its kinds is.
   * Expresses PRD §10's "human signoff OR formal/simulation evidence" for the
   * critical tier without forcing every alternative.
   */
  one_of?: string[][];
}

export interface ImplementationUnit {
  iu_id: string;
  kind: IUKind;
  name: string;
  risk_tier: RiskTier;
  contract: IUContract;
  source_canon_ids: string[];
  dependencies: string[];
  boundary_policy: BoundaryPolicy;
  enforcement: EnforcementConfig;
  evidence_policy: EvidencePolicy;
  output_files: string[];
}

export function defaultBoundaryPolicy(): BoundaryPolicy {
  return {
    code: {
      allowed_ius: [],
      allowed_packages: [],
      forbidden_ius: [],
      forbidden_packages: [],
      forbidden_paths: [],
    },
    side_channels: {
      databases: [],
      queues: [],
      caches: [],
      config: [],
      external_apis: [],
      files: [],
    },
  };
}

export function defaultEnforcement(): EnforcementConfig {
  return {
    dependency_violation: { severity: 'error' },
    side_channel_violation: { severity: 'warning' },
  };
}
