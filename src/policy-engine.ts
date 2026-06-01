/**
 * Policy Engine — evaluates whether an IU has sufficient evidence.
 *
 * Each risk tier requires specific evidence kinds. The engine checks
 * what's been collected and what's missing or failing.
 */

import type { ImplementationUnit } from './models/iu.js';
import type { EvidenceRecord, PolicyEvaluation } from './models/evidence.js';
import { EvidenceStatus } from './models/evidence.js';

/**
 * Evaluate an IU's evidence against its policy.
 */
export function evaluatePolicy(
  iu: ImplementationUnit,
  evidence: EvidenceRecord[],
): PolicyEvaluation {
  const required = iu.evidence_policy.required;
  const iuEvidence = evidence.filter(e => e.iu_id === iu.iu_id);

  const satisfied: string[] = [];
  const missing: string[] = [];
  const failed: string[] = [];

  for (const req of required) {
    const matching = iuEvidence.filter(e => e.kind === req);
    if (matching.length === 0) {
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
    verdict,
  };
}

/**
 * Evaluate policy for all IUs.
 */
export function evaluateAllPolicies(
  ius: ImplementationUnit[],
  evidence: EvidenceRecord[],
): PolicyEvaluation[] {
  return ius.map(iu => evaluatePolicy(iu, evidence));
}
