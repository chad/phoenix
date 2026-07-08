/**
 * Shadow Pipeline — runs old and new canonicalization pipelines in parallel,
 * compares output, and classifies the upgrade.
 */

import type { CanonicalNode } from './models/canonical.js';
import type { ShadowDiffMetrics, ShadowResult, PipelineConfig } from './models/pipeline.js';
import { UpgradeClassification } from './models/pipeline.js';

/**
 * Compare two sets of canonical nodes produced by different pipeline versions.
 */
export function computeShadowDiff(
  oldNodes: CanonicalNode[],
  newNodes: CanonicalNode[],
): ShadowDiffMetrics {
  // Match on the STABLE identity (canon_anchor: type + tags), not canon_id
  // (content-addressed). Otherwise a pipeline upgrade that merely rewords
  // statements churns every id and is wrongly REJECTed — the exact failure that
  // made this classifier unusable. Fall back to canon_id when no anchor exists.
  const identity = (n: CanonicalNode): string => n.canon_anchor ?? n.canon_id;
  const oldIds = new Set(oldNodes.map(identity));
  const newIds = new Set(newNodes.map(identity));

  const addedNodes = newNodes.filter(n => !oldIds.has(identity(n)));
  const removedNodes = oldNodes.filter(n => !newIds.has(identity(n)));
  const keptNodes = newNodes.filter(n => oldIds.has(identity(n)));

  const totalNodes = Math.max(oldNodes.length, 1);
  const nodeChangePct = ((addedNodes.length + removedNodes.length) / totalNodes) * 100;

  // Edge changes
  const oldEdges = new Set(oldNodes.flatMap(n => n.linked_canon_ids.map(l => `${n.canon_id}->${l}`)));
  const newEdges = new Set(newNodes.flatMap(n => n.linked_canon_ids.map(l => `${n.canon_id}->${l}`)));
  const edgeAdded = [...newEdges].filter(e => !oldEdges.has(e)).length;
  const edgeRemoved = [...oldEdges].filter(e => !newEdges.has(e)).length;
  const totalEdges = Math.max(oldEdges.size, 1);
  const edgeChangePct = ((edgeAdded + edgeRemoved) / totalEdges) * 100;

  // Orphan nodes (new nodes with no links and no source)
  const orphanNodes = addedNodes.filter(
    n => n.linked_canon_ids.length === 0 && n.source_clause_ids.length === 0
  ).length;

  // Risk escalations: nodes that changed type across the upgrade, matched on the
  // stable anchor so a reworded-but-same-concept node is compared to its prior self.
  const oldByAnchor = new Map(oldNodes.map(n => [identity(n), n]));
  let riskEscalations = 0;
  for (const nn of newNodes) {
    const old = oldByAnchor.get(identity(nn));
    if (old && old.type !== nn.type) riskEscalations++;
  }

  // Semantic statement drift: how many statements are completely new
  const oldStmts = new Set(oldNodes.map(n => n.statement));
  const driftCount = newNodes.filter(n => !oldStmts.has(n.statement)).length;
  const semanticDrift = (driftCount / Math.max(newNodes.length, 1)) * 100;

  return {
    node_change_pct: Math.round(nodeChangePct * 100) / 100,
    edge_change_pct: Math.round(edgeChangePct * 100) / 100,
    risk_escalations: riskEscalations,
    orphan_nodes: orphanNodes,
    out_of_scope_growth: addedNodes.length - removedNodes.length,
    semantic_stmt_drift: Math.round(semanticDrift * 100) / 100,
  };
}

/**
 * Classify a shadow diff as SAFE, COMPACTION_EVENT, or REJECT.
 */
export function classifyShadowDiff(metrics: ShadowDiffMetrics): {
  classification: UpgradeClassification;
  reason: string;
} {
  if (metrics.orphan_nodes > 0) {
    return { classification: UpgradeClassification.REJECT, reason: `${metrics.orphan_nodes} orphan nodes detected` };
  }
  if (metrics.semantic_stmt_drift > 50) {
    return { classification: UpgradeClassification.REJECT, reason: `Semantic drift too high: ${metrics.semantic_stmt_drift}%` };
  }
  if (metrics.node_change_pct <= 3 && metrics.risk_escalations === 0) {
    return { classification: UpgradeClassification.SAFE, reason: `Node change ${metrics.node_change_pct}% ≤ 3%, no risk escalations` };
  }
  if (metrics.node_change_pct <= 25 && metrics.orphan_nodes === 0 && metrics.risk_escalations === 0) {
    return { classification: UpgradeClassification.COMPACTION_EVENT, reason: `Node change ${metrics.node_change_pct}% ≤ 25%, no orphans` };
  }
  return { classification: UpgradeClassification.REJECT, reason: `Excessive churn: ${metrics.node_change_pct}% node change` };
}

/**
 * Run a full shadow comparison.
 */
export function runShadowPipeline(
  oldPipeline: PipelineConfig,
  newPipeline: PipelineConfig,
  oldNodes: CanonicalNode[],
  newNodes: CanonicalNode[],
): ShadowResult {
  const metrics = computeShadowDiff(oldNodes, newNodes);
  const { classification, reason } = classifyShadowDiff(metrics);
  return { old_pipeline: oldPipeline, new_pipeline: newPipeline, metrics, classification, reason };
}
