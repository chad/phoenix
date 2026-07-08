/**
 * Evidence Collector — turns the checks Phoenix already runs into durable
 * evidence records bound to IUs and artifact hashes (PRD §10).
 *
 * Before this, nothing wrote evidence, so `phoenix status` reported every IU as
 * permanently INCOMPLETE — noise that trains users to ignore the dashboard, the
 * PRD's stated death condition. The compile gate and boundary validator produce
 * exactly the low-tier evidence the policy engine asks for (typecheck, lint via
 * compile, boundary_validation); this module records their results as evidence.
 *
 * Every record binds the manifest's current artifact hash so the policy engine
 * can reject stale evidence (evidence for an old generation must not satisfy a
 * new one). Higher-tier evidence (unit/property tests, threat notes, signoff)
 * comes from the durable-evaluation generator (Phase 5) and human action.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ImplementationUnit } from './models/iu.js';
import type { EvidenceRecord } from './models/evidence.js';
import { EvidenceKind, EvidenceStatus } from './models/evidence.js';
import type { GeneratedManifest } from './models/manifest.js';
import type { CompileError } from './models/architecture.js';
import type { Diagnostic } from './models/diagnostic.js';
import { EvidenceStore } from './store/evidence-store.js';

/**
 * Compute the artifact hash an evidence record binds to: the combined hash of
 * an IU's current output files (order-independent over path). This is the
 * identity of "the generation this evidence ran against". If any file changes,
 * the hash changes, and prior evidence becomes stale.
 */
export function iuArtifactHash(
  iu: ImplementationUnit,
  manifest: GeneratedManifest,
  projectRoot: string,
): string {
  const parts: string[] = [];
  const iuManifest = manifest.iu_manifests[iu.iu_id];
  const files = [...iu.output_files].sort();
  for (const f of files) {
    let hash = iuManifest?.files[f]?.content_hash;
    if (!hash) {
      // Fall back to hashing the file on disk (manifest may lag a repair).
      const full = join(projectRoot, f);
      hash = existsSync(full) ? sha256(readFileSync(full, 'utf8')) : 'absent';
    }
    parts.push(`${f}:${hash}`);
  }
  return sha256(parts.join('\x00'));
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

let evidenceCounter = 0;
function evidenceId(kind: string, iuId: string, timestamp: string): string {
  // Deterministic-enough id; counter disambiguates same-ms records in one run.
  return sha256(`${kind}\x00${iuId}\x00${timestamp}\x00${evidenceCounter++}`).slice(0, 16);
}

export interface EvidenceCollectionInput {
  ius: ImplementationUnit[];
  manifest: GeneratedManifest;
  projectRoot: string;
  /** Unresolved compile errors from the compile gate (empty ⇒ project compiles). */
  compileErrors: CompileError[];
  /** Boundary diagnostics from the validator, if already computed. */
  boundaryDiagnostics?: Diagnostic[];
  /** Injectable clock for deterministic tests. */
  now?: () => string;
}

/**
 * Build evidence records for TYPECHECK, LINT, and BOUNDARY_VALIDATION from the
 * results of checks that already ran. TYPECHECK/LINT both derive from the
 * compile gate (a project that compiles passes both — lint here means "the
 * emitted code is structurally valid per the target compiler"). Boundary
 * validation passes for an IU when it produced no error-severity diagnostics.
 */
export function collectLowTierEvidence(input: EvidenceCollectionInput): EvidenceRecord[] {
  const now = input.now ?? (() => new Date().toISOString());
  const timestamp = now();
  const records: EvidenceRecord[] = [];

  // Which files have unresolved compile errors → which IUs failed typecheck.
  const failedFiles = new Set(input.compileErrors.map(e => normalizeSlashes(e.file)));
  const boundaryErrorsByIU = new Map<string, string[]>();
  for (const d of input.boundaryDiagnostics ?? []) {
    if (d.severity !== 'error' || !d.iu_id) continue;
    (boundaryErrorsByIU.get(d.iu_id) ?? boundaryErrorsByIU.set(d.iu_id, []).get(d.iu_id)!)
      .push(d.message);
  }

  for (const iu of input.ius) {
    // Only record evidence for IUs that have actually been generated.
    const generated = iu.output_files.some(f => existsSync(join(input.projectRoot, f)));
    if (!generated) continue;

    const artifactHash = iuArtifactHash(iu, input.manifest, input.projectRoot);
    const iuFiles = new Set(iu.output_files.map(normalizeSlashes));
    const iuFailedFiles = [...iuFiles].filter(f => failedFiles.has(f));

    const required = new Set(iu.evidence_policy.required);

    if (required.has(EvidenceKind.TYPECHECK)) {
      const pass = iuFailedFiles.length === 0;
      records.push({
        evidence_id: evidenceId('typecheck', iu.iu_id, timestamp),
        kind: EvidenceKind.TYPECHECK,
        status: pass ? EvidenceStatus.PASS : EvidenceStatus.FAIL,
        iu_id: iu.iu_id,
        canon_ids: iu.source_canon_ids,
        artifact_hash: artifactHash,
        message: pass ? 'Compiles under target toolchain' : `Compile errors in ${iuFailedFiles.join(', ')}`,
        timestamp,
      });
    }

    if (required.has(EvidenceKind.LINT)) {
      // Lint == structural validity: the compile gate is our source of truth in v1.
      const pass = iuFailedFiles.length === 0;
      records.push({
        evidence_id: evidenceId('lint', iu.iu_id, timestamp),
        kind: EvidenceKind.LINT,
        status: pass ? EvidenceStatus.PASS : EvidenceStatus.FAIL,
        iu_id: iu.iu_id,
        canon_ids: iu.source_canon_ids,
        artifact_hash: artifactHash,
        message: pass ? 'Emitted code is structurally valid' : 'Compile gate reported errors',
        timestamp,
      });
    }

    if (required.has(EvidenceKind.BOUNDARY_VALIDATION)) {
      const errs = boundaryErrorsByIU.get(iu.iu_id) ?? [];
      const pass = errs.length === 0;
      records.push({
        evidence_id: evidenceId('boundary', iu.iu_id, timestamp),
        kind: EvidenceKind.BOUNDARY_VALIDATION,
        status: pass ? EvidenceStatus.PASS : EvidenceStatus.FAIL,
        iu_id: iu.iu_id,
        canon_ids: iu.source_canon_ids,
        artifact_hash: artifactHash,
        message: pass ? 'No boundary violations' : `Boundary violations: ${errs.join('; ')}`,
        timestamp,
      });
    }
  }

  return records;
}

/** Record low-tier evidence into the store. Returns the records written. */
export function recordLowTierEvidence(
  phoenixDir: string,
  input: EvidenceCollectionInput,
): EvidenceRecord[] {
  const records = collectLowTierEvidence(input);
  if (records.length > 0) {
    new EvidenceStore(phoenixDir).addRecords(records);
  }
  return records;
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}
