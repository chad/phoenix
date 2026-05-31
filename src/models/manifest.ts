/**
 * Generated manifest — tracks every generated file for drift detection.
 */

export interface FileManifestEntry {
  path: string;
  content_hash: string;
  size: number;
  /**
   * Exact line→canon provenance captured from the model's //phx: markers at
   * generation time (0-based line index, as a string key → canon id). Absent for
   * stub-generated or un-annotated files; the inspector falls back to inference.
   */
  line_provenance?: Record<string, string>;
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

/**
 * One IU's contribution to a shared aggregate file (e.g. its migration inside the
 * shared `_migrations.ts`). The region is delimited in the file by
 * `// <<phx:region iu=… role=…>> … // <</phx:region>>` markers; `content_hash` is
 * over the region body alone, so drift is localized and attributed to one IU.
 */
export interface FileRegion {
  iu_id: string;
  /** Artifact role of this region, e.g. 'migration'. */
  role: string;
  /** Optional secondary key within a role (e.g. the table name for a migration). */
  key?: string;
  /** Hash of the region body (the lines between the markers), not the whole file. */
  content_hash: string;
  /** 0-based line index of the region body's first line in the assembled file. */
  start_line: number;
  /** 0-based line index just past the region body's last line. */
  end_line: number;
}

/**
 * A file owned by NO single IU — an aggregate of contributions from many IUs.
 * The canonical example is the database migrations file: every entity IU
 * contributes one `registerMigration` region.
 */
export interface SharedFileManifest {
  path: string;
  /** Whole-file hash — fast path for "nothing drifted". */
  content_hash: string;
  regions: FileRegion[];
}

export interface GeneratedManifest {
  iu_manifests: Record<string, IUManifest>;
  /** Shared aggregate files (path → manifest). IUs contribute regions, not the file. */
  shared_files?: Record<string, SharedFileManifest>;
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
  /** For a shared-file region: the artifact role (e.g. 'migration'). */
  role?: string;
  /** For a shared-file region: the role's secondary key (e.g. the table name). */
  key?: string;
  /** For a shared-file region: its body line range in the file. */
  region?: { start_line: number; end_line: number };
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
