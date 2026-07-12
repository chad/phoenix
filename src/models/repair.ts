/**
 * Repair finding — a verifier ERROR routed into the repair loop.
 *
 * The verifiers (schema contract, constraint diagnostics, the build gate) are the
 * ORACLE and are frozen to the loop: repair changes generated code only, never a
 * checker. A RepairFinding is the machine-readable form of one ERROR diagnostic,
 * carrying enough to (a) route it to the owning generated artifact (an IU module, or
 * the shared migrations file) and (b) hand the model the exact defect + recommended
 * action VERBATIM so regeneration fixes precisely what the oracle flagged.
 */
export interface RepairFinding {
  category: 'schema' | 'constraint' | 'build';
  /** The owning IU (schema/constraint findings carry it); undefined for the shared
   *  migrations artifact and un-attributable build errors. */
  iu_id?: string;
  /** Repo-relative file the defect lives in (for build errors and the migrations file). */
  file?: string;
  /** Short subject (e.g. "adventurer" or "transaction.invariant"). */
  subject: string;
  /** The diagnostic message VERBATIM. */
  message: string;
  /** The single recommended action VERBATIM. */
  action: string;
}

/** The synthetic target id for findings that belong to the shared migrations artifact. */
export const MIGRATIONS_TARGET = 'schema-plan';
