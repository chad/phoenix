/**
 * Evaluation harness: measures canonicalization quality against gold-standard specs.
 *
 * Metrics:
 * - Extraction recall: % of expected nodes found
 * - Type accuracy: % of found nodes with correct type
 * - Coverage: average extraction coverage across clauses
 * - Linking precision: % of expected edges found with correct type
 * - Node count bounds: extracted count within expected range
 * - Resolution D-rate: % of edges that fell back to 'relates_to'
 * - Hierarchy coverage: % of non-CONTEXT nodes with parent
 * - Orphan rate: % of nodes with zero connections
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSpec } from '../../src/spec-parser.js';
import { extractCanonicalNodes, extractCandidates } from '../../src/canonicalizer.js';
import { GOLD_SPECS, type GoldSpec, type GoldNode, type GoldEdge } from './gold-standard.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CONFIG } from '../../src/experiment-config.js';

const ROOT = resolve(__dirname, '../../');

function loadAndExtract(spec: GoldSpec) {
  const text = readFileSync(resolve(ROOT, spec.path), 'utf8');
  const clauses = parseSpec(text, spec.docId);
  const { candidates, coverage } = extractCandidates(clauses);
  const nodes = extractCanonicalNodes(clauses);
  const avgCoverage = coverage.length > 0
    ? coverage.reduce((s, c) => s + c.coverage_pct, 0) / coverage.length
    : 0;
  return { clauses, candidates, coverage, nodes, avgCoverage };
}

function findNode(nodes: CanonicalNode[], substringMatch: string): CanonicalNode | undefined {
  const lower = substringMatch.toLowerCase();
  return nodes.find(n => n.statement.toLowerCase().includes(lower));
}

function computeMetrics(spec: GoldSpec, nodes: CanonicalNode[], avgCoverage: number) {
  // Extraction recall
  let found = 0;
  let typeCorrect = 0;
  for (const expected of spec.expectedNodes) {
    const node = findNode(nodes, expected.statement);
    if (node) {
      found++;
      if (node.type === expected.type) typeCorrect++;
    }
  }
  const recall = spec.expectedNodes.length > 0 ? found / spec.expectedNodes.length : 1;
  const typeAccuracy = found > 0 ? typeCorrect / found : 0;

  // Linking precision
  let edgesFound = 0;
  for (const expected of spec.expectedEdges) {
    const from = findNode(nodes, expected.from);
    const to = findNode(nodes, expected.to);
    if (from && to) {
      const isLinked = from.linked_canon_ids.includes(to.canon_id) || to.linked_canon_ids.includes(from.canon_id);
      if (isLinked) {
        const edgeType = from.link_types?.[to.canon_id] || to.link_types?.[from.canon_id];
        if (edgeType === expected.type) edgesFound++;
      }
    }
  }
  const linkPrecision = spec.expectedEdges.length > 0 ? edgesFound / spec.expectedEdges.length : 1;

  // Resolution D-rate
  let totalEdges = 0;
  let relatesToEdges = 0;
  for (const n of nodes) {
    for (const [, et] of Object.entries(n.link_types ?? {})) {
      totalEdges++;
      if (et === 'relates_to') relatesToEdges++;
    }
  }
  const resDRate = totalEdges > 0 ? relatesToEdges / totalEdges : 0;

  // Orphan rate
  const orphanCount = nodes.filter(n => n.linked_canon_ids.length === 0).length;
  const orphanRate = nodes.length > 0 ? orphanCount / nodes.length : 0;

  // Hierarchy coverage
  const nonContext = nodes.filter(n => n.type !== 'CONTEXT');
  const withParent = nonContext.filter(n => n.parent_canon_id).length;
  const hierCoverage = nonContext.length > 0 ? withParent / nonContext.length : 0;

  // Max degree
  const maxDegree = Math.max(0, ...nodes.map(n => n.linked_canon_ids.length));

  return {
    recall,
    typeAccuracy,
    coverage: avgCoverage,
    linkPrecision,
    resDRate,
    orphanRate,
    hierCoverage,
    maxDegree,
    nodeCount: nodes.length,
  };
}

// Per-spec tests
describe('Canonicalization Evaluation', () => {
  const allMetrics: { name: string; metrics: ReturnType<typeof computeMetrics> }[] = [];

  for (const spec of GOLD_SPECS) {
    describe(spec.name, () => {
      const { nodes, avgCoverage } = loadAndExtract(spec);
      const metrics = computeMetrics(spec, nodes, avgCoverage);
      allMetrics.push({ name: spec.name, metrics });

      it(`extraction coverage ≥ ${spec.expectedMinCoverage}%`, () => {
        expect(metrics.coverage).toBeGreaterThanOrEqual(spec.expectedMinCoverage);
      });

      it(`node count in range [${spec.expectedMinNodes}, ${spec.expectedMaxNodes}]`, () => {
        expect(metrics.nodeCount).toBeGreaterThanOrEqual(spec.expectedMinNodes);
        expect(metrics.nodeCount).toBeLessThanOrEqual(spec.expectedMaxNodes);
      });

      it('extraction recall ≥ 70%', () => {
        expect(metrics.recall).toBeGreaterThanOrEqual(0.7);
      });

      it('type accuracy ≥ 60%', () => {
        expect(metrics.typeAccuracy).toBeGreaterThanOrEqual(0.6);
      });

      it(`max degree ≤ ${CONFIG.MAX_DEGREE}`, () => {
        expect(metrics.maxDegree).toBeLessThanOrEqual(CONFIG.MAX_DEGREE);
      });

      it('hierarchy coverage ≥ 40%', () => {
        expect(metrics.hierCoverage).toBeGreaterThanOrEqual(0.4);
      });

      if (spec.expectedEdges.length > 0) {
        it('linking precision ≥ 50%', () => {
          expect(metrics.linkPrecision).toBeGreaterThanOrEqual(0.5);
        });
      }
    });
  }

  // Aggregate summary (runs after all specs)
  it('aggregate: average extraction recall ≥ 80%', () => {
    const avgRecall = allMetrics.reduce((s, m) => s + m.metrics.recall, 0) / allMetrics.length;
    expect(avgRecall).toBeGreaterThanOrEqual(0.8);
  });

  it('aggregate: average type accuracy ≥ 70%', () => {
    const avgType = allMetrics.reduce((s, m) => s + m.metrics.typeAccuracy, 0) / allMetrics.length;
    expect(avgType).toBeGreaterThanOrEqual(0.7);
  });

  it('aggregate: average coverage ≥ 85%', () => {
    const avgCov = allMetrics.reduce((s, m) => s + m.metrics.coverage, 0) / allMetrics.length;
    expect(avgCov).toBeGreaterThanOrEqual(85);
  });
});

// Baseline comparison report (not a test — just prints)
describe('Baseline Report', () => {
  it('prints metrics table', () => {
    console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║                CANONICALIZATION v2 — EVALUATION REPORT                ║');
    console.log('╠═══════════════════════════════════════════════════════════════════════╣');
    console.log('║ Spec              │ Recall │ TypeAcc │ Cover │ ResD% │ Hier% │ Nodes ║');
    console.log('╠═══════════════════╪════════╪═════════╪═══════╪═══════╪═══════╪═══════╣');

    let totalRecall = 0, totalType = 0, totalCov = 0, count = 0;

    for (const spec of GOLD_SPECS) {
      const { nodes, avgCoverage } = loadAndExtract(spec);
      const m = computeMetrics(spec, nodes, avgCoverage);
      totalRecall += m.recall; totalType += m.typeAccuracy; totalCov += m.coverage; count++;

      const name = spec.name.padEnd(18);
      const recall = (m.recall * 100).toFixed(0).padStart(5) + '%';
      const type = (m.typeAccuracy * 100).toFixed(0).padStart(6) + '%';
      const cov = m.coverage.toFixed(0).padStart(4) + '%';
      const resD = (m.resDRate * 100).toFixed(0).padStart(4) + '%';
      const hier = (m.hierCoverage * 100).toFixed(0).padStart(4) + '%';
      const nodeCount = String(m.nodeCount).padStart(5);

      console.log(`║ ${name} │ ${recall} │ ${type} │ ${cov} │ ${resD} │ ${hier} │ ${nodeCount} ║`);
    }

    console.log('╠═══════════════════╪════════╪═════════╪═══════╪═══════╪═══════╪═══════╣');
    const avgR = ((totalRecall / count) * 100).toFixed(0).padStart(5) + '%';
    const avgT = ((totalType / count) * 100).toFixed(0).padStart(6) + '%';
    const avgC = (totalCov / count).toFixed(0).padStart(4) + '%';
    console.log(`║ ${'AVERAGE'.padEnd(18)} │ ${avgR} │ ${avgT} │ ${avgC} │       │       │       ║`);
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');

    console.log('\nTargets: Recall ≥95%, TypeAcc ≥90%, Coverage ≥95%, ResD ≤20%, Hier ≥50%');
  });
});
