/**
 * Policy Engine — evaluates whether an IU has sufficient evidence.
 *
 * Each risk tier requires specific evidence kinds. The engine checks
 * what's been collected and what's missing or failing.
 */

import type { ImplementationUnit } from './models/iu.js';
import type { EvidenceRecord, PolicyEvaluation } from './models/evidence.js';
import { EvidenceStatus } from './models/evidence.js';

export interface PolicyOptions {
  /**
   * Current artifact hash per IU. When provided, any evidence record whose
   * artifact_hash does not match its IU's current hash is treated as STALE and
   * counts as missing — evidence for an old generation must never satisfy a new
   * one. Records with no artifact_hash are grandfathered (older evidence, or
   * evidence kinds not bound to a specific artifact, e.g. human_signoff).
   */
  currentArtifactHash?: Map<string, string>;
}

/**
 * Evaluate an IU's evidence against its policy.
 */
export function evaluatePolicy(
  iu: ImplementationUnit,
  evidence: EvidenceRecord[],
  options: PolicyOptions = {},
): PolicyEvaluation {
  const required = iu.evidence_policy.required;
  const currentHash = options.currentArtifactHash?.get(iu.iu_id);
  const isStale = (e: EvidenceRecord): boolean =>
    currentHash !== undefined && e.artifact_hash !== undefined && e.artifact_hash !== currentHash;
  const iuEvidence = evidence.filter(e => e.iu_id === iu.iu_id && !isStale(e));

  const satisfied: string[] = [];
  const missing: string[] = [];
  const failed: string[] = [];
  const stale: string[] = [];

  // Which required kinds had ONLY stale evidence (for an explainable status message).
  const staleOnly = new Set<string>();
  if (currentHash !== undefined) {
    for (const req of required) {
      const all = evidence.filter(e => e.iu_id === iu.iu_id && e.kind === req);
      const fresh = all.filter(e => !isStale(e));
      if (all.length > 0 && fresh.length === 0) staleOnly.add(req);
    }
  }

  for (const req of required) {
    const matching = iuEvidence.filter(e => e.kind === req);
    if (matching.length === 0) {
      if (staleOnly.has(req)) stale.push(req);
      missing.push(req);
    } else {
      // Latest by TIMESTAMP, not array position — a stale FAIL must not override a newer PASS.
      const latest = matching.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
      if (latest.status === EvidenceStatus.PASS) {
        satisfied.push(req);
      } else if (latest.status === EvidenceStatus.FAIL) {
        failed.push(req);
      } else {
        missing.push(req); // PENDING or SKIPPED count as missing
      }
    }
  }

  let verdict: 'PASS' | 'FAIL' | 'INCOMPLETE';
  if (failed.length > 0) {
    verdict = 'FAIL';
  } else if (missing.length > 0) {
    verdict = 'INCOMPLETE';
  } else {
    verdict = 'PASS';
  }

  return {
    iu_id: iu.iu_id,
    iu_name: iu.name,
    risk_tier: iu.risk_tier,
    required: [...required],
    satisfied,
    missing,
    failed,
    stale,
    verdict,
  };
}

/**
 * Evaluate policy for all IUs.
 */
export function evaluateAllPolicies(
  ius: ImplementationUnit[],
  evidence: EvidenceRecord[],
  options: PolicyOptions = {},
): PolicyEvaluation[] {
  return ius.map(iu => evaluatePolicy(iu, evidence, options));
}
