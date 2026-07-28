/**
 * Compaction proposals (book ch10–11) — "active reduction of conceptual mass and
 * system sprawl... continuous discipline, not cleanup sprint... treating mass as a
 * budget."
 *
 * (Distinct from `compaction.ts`, which is the storage engine that archives cold
 * objects. This operates on the SYSTEM's conceptual mass — the IU graph — not on
 * storage bytes.)
 *
 * Phoenix MEASURED conceptual mass (regen gate) and never reduced it. This proposes
 * compactions, with evidence — and NEVER applies one itself (same discipline as
 * repair --spec: the human is sovereign; merging IUs is regeneration + eval re-run, a
 * deliberate act).
 *
 * Detectors, all deterministic over (IUs, canon graph, eval-coverage):
 *   - over-fragmented entity: one entity spread across many IUs (from grain policy) →
 *     consolidate toward the evaluable grain.
 *   - dead weight: an IU nothing references and no eval covers → delete or cover
 *     (the deletion-test unverifiable-and-unconsumed case).
 *   - orphan canon: normative canon nodes no IU owns → intent that compiled to nothing.
 */

import type { ImplementationUnit } from './models/iu.js';
import type { CanonicalNode } from './models/canonical.js';
import { CanonicalType } from './models/canonical.js';
import { assessPlanGrain, GRAIN_MAX_NODES } from './grain-policy.js';
import { analyzeDeletion } from './deletion-test.js';

export interface CompactionProposal {
  kind: 'merge-over-fragmented' | 'dead-weight' | 'orphan-canon';
  subject: string;
  evidence: string;
  action: string;
  /** Verification the human (or a future --apply) must run before accepting. */
  verification: string;
}

export interface CompactionResult {
  proposals: CompactionProposal[];
  mass: { ius: number; nodes: number; budgetIUs?: number; overBudget: boolean };
}

const NORMATIVE = new Set([CanonicalType.REQUIREMENT, CanonicalType.CONSTRAINT, CanonicalType.INVARIANT]);

export function proposeCompactions(
  ius: ImplementationUnit[],
  canonNodes: CanonicalNode[],
  isCovered: (iu: ImplementationUnit) => boolean,
  opts: { budgetIUs?: number } = {},
): CompactionResult {
  const proposals: CompactionProposal[] = [];

  // 1. Over-fragmented entities → consolidation proposals.
  const grain = assessPlanGrain(ius, canonNodes);
  for (const e of grain.overFragmented) {
    const targetModules = Math.max(1, Math.ceil(e.totalNodes / GRAIN_MAX_NODES));
    proposals.push({
      kind: 'merge-over-fragmented',
      subject: e.entity,
      evidence: `"${e.entity}" is spread across ${e.ius.length} IUs (${e.totalNodes} nodes): ${e.ius.slice(0, 6).join(', ')}${e.ius.length > 6 ? '…' : ''}`,
      action: `consolidate toward ${targetModules} "${e.entity}" module(s) that each own an evaluable slice`,
      verification: `regenerate the merged module(s); run the union of all facets' evals; accept only if none regress`,
    });
  }

  // 2. Dead weight → delete-or-cover proposals (nothing references it, no eval).
  for (const iu of ius) {
    const r = analyzeDeletion(iu, ius, canonNodes, isCovered);
    if (r.actualConsumers.length === 0 && !r.evaluationCovered) {
      proposals.push({
        kind: 'dead-weight',
        subject: iu.name,
        evidence: `no IU references "${iu.name}"'s entities and no evaluation covers it — deleting it would go unnoticed`,
        action: `confirm it is genuinely unused, then delete it; if it is load-bearing, the gap is missing evals, not dead code`,
        verification: `delete in a temp copy, recompile + run the full eval suite; accept only if nothing breaks`,
      });
    }
  }

  // 3. Orphan canon → normative intent no IU owns.
  const owned = new Set<string>();
  for (const iu of ius) for (const cid of iu.source_canon_ids) owned.add(cid);
  const orphans = canonNodes.filter(n => NORMATIVE.has(n.type) && !owned.has(n.canon_id));
  if (orphans.length > 0) {
    proposals.push({
      kind: 'orphan-canon',
      subject: `${orphans.length} normative node(s)`,
      evidence: `${orphans.length} requirement/constraint/invariant node(s) are owned by no IU — intent that compiled to nothing (e.g. "${orphans[0].statement.slice(0, 70)}")`,
      action: `attach them to the IU they concern (re-plan) or, if genuinely vestigial, prune them from the spec via a spec proposal`,
      verification: `re-plan and confirm each orphan lands in an IU, or a spec proposal removes it with provenance`,
    });
  }

  const nodes = canonNodes.filter(n => NORMATIVE.has(n.type)).length;
  const budgetIUs = opts.budgetIUs;
  return {
    proposals,
    mass: { ius: ius.length, nodes, budgetIUs, overBudget: budgetIUs !== undefined && ius.length > budgetIUs },
  };
}
