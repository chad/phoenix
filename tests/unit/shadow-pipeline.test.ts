import { describe, it, expect } from 'vitest';
import { computeShadowDiff, classifyShadowDiff, runShadowPipeline } from '../../src/shadow-pipeline.js';
import { UpgradeClassification } from '../../src/models/pipeline.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CanonicalType } from '../../src/models/canonical.js';

function makeNode(id: string, stmt: string, links: string[] = [], type = CanonicalType.REQUIREMENT): CanonicalNode {
  return { canon_id: id, type, statement: stmt, source_clause_ids: ['clause1'], linked_canon_ids: links, tags: [] };
}

describe('computeShadowDiff', () => {
  it('reports zero change for identical nodes', () => {
    const nodes = [makeNode('a', 'stmt a'), makeNode('b', 'stmt b')];
    const metrics = computeShadowDiff(nodes, nodes);
    expect(metrics.node_change_pct).toBe(0);
    expect(metrics.orphan_nodes).toBe(0);
  });

  it('detects added and removed nodes', () => {
    const old = [makeNode('a', 'stmt a'), makeNode('b', 'stmt b')];
    const newN = [makeNode('a', 'stmt a'), makeNode('c', 'stmt c')];
    const metrics = computeShadowDiff(old, newN);
    expect(metrics.node_change_pct).toBeGreaterThan(0);
  });

  it('detects orphan nodes', () => {
    const old = [makeNode('a', 'stmt a')];
    const newN = [makeNode('a', 'stmt a'), { ...makeNode('b', 'stmt b'), source_clause_ids: [] as string[] }];
    const metrics = computeShadowDiff(old, newN);
    expect(metrics.orphan_nodes).toBe(1);
  });

  it('detects risk escalations (type changes)', () => {
    const old = [makeNode('a', 'shared stmt', [], CanonicalType.REQUIREMENT)];
    const newN = [makeNode('a', 'shared stmt', [], CanonicalType.CONSTRAINT)]; // same node, type escalated
    const metrics = computeShadowDiff(old, newN);
    expect(metrics.risk_escalations).toBe(1);
  });
});

describe('classifyShadowDiff', () => {
  it('classifies SAFE for small changes', () => {
    const { classification } = classifyShadowDiff({
      node_change_pct: 2, edge_change_pct: 1, risk_escalations: 0,
      orphan_nodes: 0, out_of_scope_growth: 0, semantic_stmt_drift: 5,
    });
    expect(classification).toBe(UpgradeClassification.SAFE);
  });

  it('classifies COMPACTION_EVENT for moderate changes', () => {
    const { classification } = classifyShadowDiff({
      node_change_pct: 15, edge_change_pct: 10, risk_escalations: 0,
      orphan_nodes: 0, out_of_scope_growth: 2, semantic_stmt_drift: 20,
    });
    expect(classification).toBe(UpgradeClassification.COMPACTION_EVENT);
  });

  it('classifies REJECT for orphan nodes', () => {
    const { classification } = classifyShadowDiff({
      node_change_pct: 1, edge_change_pct: 0, risk_escalations: 0,
      orphan_nodes: 1, out_of_scope_growth: 0, semantic_stmt_drift: 0,
    });
    expect(classification).toBe(UpgradeClassification.REJECT);
  });

  it('classifies REJECT for high semantic drift', () => {
    const { classification } = classifyShadowDiff({
      node_change_pct: 5, edge_change_pct: 5, risk_escalations: 0,
      orphan_nodes: 0, out_of_scope_growth: 0, semantic_stmt_drift: 60,
    });
    expect(classification).toBe(UpgradeClassification.REJECT);
  });
});

describe('runShadowPipeline', () => {
  it('produces a full ShadowResult', () => {
    const oldP = { pipeline_id: 'v1', model_id: 'm1', promptpack_version: 'p1', extraction_rules_version: 'r1', diff_policy_version: 'd1' };
    const newP = { pipeline_id: 'v2', model_id: 'm2', promptpack_version: 'p2', extraction_rules_version: 'r2', diff_policy_version: 'd2' };
    const nodes = [makeNode('a', 'stmt')];
    const result = runShadowPipeline(oldP, newP, nodes, nodes);
    expect(result.classification).toBe(UpgradeClassification.SAFE);
    expect(result.old_pipeline.pipeline_id).toBe('v1');
    expect(result.new_pipeline.pipeline_id).toBe('v2');
  });
});
