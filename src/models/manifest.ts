/**
 * Generated manifest — tracks every generated file for drift detection.
 */

export interface FileManifestEntry {
  path: string;
  content_hash: string;
  size: number;
}

export interface RegenMetadata {
  model_id: string;
  promptpack_hash: string;
  toolchain_version: string;
  generated_at: string;
  /**
   * Regeneration gate verdict, stamped at accept time (warn-first in alpha).
   * Readiness from the Replacement Audit: opaque|observable|evaluable|regenerable.
   */
  readiness?: string;
  /**
   * Conceptual mass at this regeneration. The next cycle reads this as the
   * `previousMass` baseline for the ratchet check.
   */
  conceptual_mass?: number;
}

export interface IUManifest {
  iu_id: string;
  iu_name: string;
  files: Record<string, FileManifestEntry>;
  regen_metadata: RegenMetadata;
}

export interface GeneratedManifest {
  iu_manifests: Record<string, IUManifest>;
  generated_at: string;
}

export enum DriftStatus {
  /** File matches manifest hash */
  CLEAN = 'CLEAN',
  /** File differs from manifest, no waiver */
  DRIFTED = 'DRIFTED',
  /** File differs, waiver exists */
  WAIVED = 'WAIVED',
  /** Manifest entry but no file on disk */
  MISSING = 'MISSING',
  /** File on disk but not in manifest */
  UNTRACKED = 'UNTRACKED',
}

export interface DriftEntry {
  status: DriftStatus;
  file_path: string;
  iu_id?: string;
  expected_hash?: string;
  actual_hash?: string;
  waiver?: DriftWaiver;
}

export interface DriftWaiver {
  kind: 'promote_to_requirement' | 'waiver' | 'temporary_patch';
  reason: string;
  signed_by?: string;
  expires?: string;
}

export interface DriftReport {
  entries: DriftEntry[];
  clean_count: number;
  drifted_count: number;
  missing_count: number;
  summary: string;
}
