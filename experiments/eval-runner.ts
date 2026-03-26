#!/usr/bin/env npx tsx
/**
 * Evaluation Runner — Fixed harness for the autoresearch experiment loop.
 *
 * DO NOT MODIFY THIS FILE during experiments.
 * The agent modifies only experiments/config.ts.
 *
 * Usage: npx tsx experiments/eval-runner.ts [--json] [--no-log]
 */

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSpec } from '../src/spec-parser.js';
import { extractCanonicalNodes, extractCandidates } from '../src/canonicalizer.js';
import { GOLD_SPECS, type GoldSpec } from '../tests/eval/gold-standard.js';
import type { CanonicalNode } from '../src/models/canonical.js';
import { CONFIG } from '../src/experiment-config.js';

const ROOT = resolve(import.meta.dirname, '..');
const RESULTS_FILE = resolve(ROOT, 'experiments/results.tsv');

// ─── Metrics computation (same as eval test, but standalone) ────────────────

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

interface SpecMetrics {
  recall: number;
  typeAccuracy: number;
  coverage: number;
  linkPrecision: number;
  resDRate: number;
  orphanRate: number;
  hierCoverage: number;
  maxDegree: number;
  nodeCount: number;
}

function computeMetrics(spec: GoldSpec, nodes: CanonicalNode[], avgCoverage: number): SpecMetrics {
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

  let totalEdges = 0;
  let relatesToEdges = 0;
  for (const n of nodes) {
    for (const [, et] of Object.entries(n.link_types ?? {})) {
      totalEdges++;
      if (et === 'relates_to') relatesToEdges++;
    }
  }
  const resDRate = totalEdges > 0 ? relatesToEdges / totalEdges : 0;

  const orphanCount = nodes.filter(n => n.linked_canon_ids.length === 0).length;
  const orphanRate = nodes.length > 0 ? orphanCount / nodes.length : 0;

  const nonContext = nodes.filter(n => n.type !== 'CONTEXT');
  const withParent = nonContext.filter(n => n.parent_canon_id).length;
  const hierCoverage = nonContext.length > 0 ? withParent / nonContext.length : 0;

  const maxDegree = Math.max(0, ...nodes.map(n => n.linked_canon_ids.length));

  return { recall, typeAccuracy, coverage: avgCoverage, linkPrecision, resDRate, orphanRate, hierCoverage, maxDegree, nodeCount: nodes.length };
}

// ─── Composite score ────────────────────────────────────────────────────────

function compositeScore(avgRecall: number, avgTypeAcc: number, avgCoverage: number, avgDRate: number, avgHier: number): number {
  return (
    0.30 * avgRecall +
    0.25 * avgTypeAcc +
    0.20 * (avgCoverage / 100) +
    0.15 * (1 - avgDRate) +
    0.10 * avgHier
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const noLog = args.includes('--no-log');

const allMetrics: { name: string; metrics: SpecMetrics }[] = [];

for (const spec of GOLD_SPECS) {
  try {
    const { nodes, avgCoverage } = loadAndExtract(spec);
    const metrics = computeMetrics(spec, nodes, avgCoverage);
    allMetrics.push({ name: spec.name, metrics });
  } catch (e) {
    console.error(`FAILED: ${spec.name} — ${e}`);
    allMetrics.push({
      name: spec.name,
      metrics: { recall: 0, typeAccuracy: 0, coverage: 0, linkPrecision: 0, resDRate: 1, orphanRate: 1, hierCoverage: 0, maxDegree: 0, nodeCount: 0 },
    });
  }
}

// Aggregates
const count = allMetrics.length;
const avgRecall = allMetrics.reduce((s, m) => s + m.metrics.recall, 0) / count;
const avgTypeAcc = allMetrics.reduce((s, m) => s + m.metrics.typeAccuracy, 0) / count;
const avgCoverage = allMetrics.reduce((s, m) => s + m.metrics.coverage, 0) / count;
const avgDRate = allMetrics.reduce((s, m) => s + m.metrics.resDRate, 0) / count;
const avgHier = allMetrics.reduce((s, m) => s + m.metrics.hierCoverage, 0) / count;
const avgOrphan = allMetrics.reduce((s, m) => s + m.metrics.orphanRate, 0) / count;
const score = compositeScore(avgRecall, avgTypeAcc, avgCoverage, avgDRate, avgHier);

if (jsonMode) {
  console.log(JSON.stringify({ score, avgRecall, avgTypeAcc, avgCoverage, avgDRate, avgHier, avgOrphan, perSpec: allMetrics }, null, 2));
} else {
  // ASCII table
  console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║              PHOENIX CANONICALIZATION — EXPERIMENT EVAL              ║');
  console.log('╠═══════════════════════════════════════════════════════════════════════╣');
  console.log('║ Spec              │ Recall │ TypeAcc │ Cover │ ResD% │ Hier% │ Nodes ║');
  console.log('╠═══════════════════╪════════╪═════════╪═══════╪═══════╪═══════╪═══════╣');

  for (const { name, metrics: m } of allMetrics) {
    const n = name.padEnd(18);
    const recall = (m.recall * 100).toFixed(0).padStart(5) + '%';
    const type = (m.typeAccuracy * 100).toFixed(0).padStart(6) + '%';
    const cov = m.coverage.toFixed(0).padStart(4) + '%';
    const resD = (m.resDRate * 100).toFixed(0).padStart(4) + '%';
    const hier = (m.hierCoverage * 100).toFixed(0).padStart(4) + '%';
    const nodeCount = String(m.nodeCount).padStart(5);
    console.log(`║ ${n} │ ${recall} │ ${type} │ ${cov} │ ${resD} │ ${hier} │ ${nodeCount} ║`);
  }

  console.log('╠═══════════════════╪════════╪═════════╪═══════╪═══════╪═══════╪═══════╣');
  const avgR = (avgRecall * 100).toFixed(0).padStart(5) + '%';
  const avgT = (avgTypeAcc * 100).toFixed(0).padStart(6) + '%';
  const avgC = avgCoverage.toFixed(0).padStart(4) + '%';
  const avgD = (avgDRate * 100).toFixed(0).padStart(4) + '%';
  const avgH = (avgHier * 100).toFixed(0).padStart(4) + '%';
  console.log(`║ ${'AVERAGE'.padEnd(18)} │ ${avgR} │ ${avgT} │ ${avgC} │ ${avgD} │ ${avgH} │       ║`);
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log(`\n  COMPOSITE SCORE: ${score.toFixed(4)}`);
  console.log(`  Formula: 0.30·recall + 0.25·typeAcc + 0.20·coverage + 0.15·(1-dRate) + 0.10·hier`);
  console.log(`\n  Targets: Recall ≥95%, TypeAcc ≥90%, Coverage ≥95%, ResD ≤20%, Hier ≥50%`);
}

// ─── Append to results.tsv ──────────────────────────────────────────────────

if (!noLog) {
  const timestamp = new Date().toISOString();
  const header = 'timestamp\tscore\trecall\ttype_acc\tcoverage\td_rate\thier\torphan\tconfig_hash';

  if (!existsSync(RESULTS_FILE)) {
    appendFileSync(RESULTS_FILE, header + '\n');
  }

  // Simple config hash for dedup detection
  const configStr = JSON.stringify(CONFIG);
  let hash = 0;
  for (let i = 0; i < configStr.length; i++) {
    hash = ((hash << 5) - hash + configStr.charCodeAt(i)) | 0;
  }
  const configHash = Math.abs(hash).toString(36);

  const row = [
    timestamp,
    score.toFixed(4),
    (avgRecall * 100).toFixed(1),
    (avgTypeAcc * 100).toFixed(1),
    avgCoverage.toFixed(1),
    (avgDRate * 100).toFixed(1),
    (avgHier * 100).toFixed(1),
    (avgOrphan * 100).toFixed(1),
    configHash,
  ].join('\t');

  appendFileSync(RESULTS_FILE, row + '\n');
  if (!jsonMode) {
    console.log(`\n  Results appended to experiments/results.tsv`);
  }
}

// Exit with score as a parseable last line
if (!jsonMode) {
  console.log(`\nval_score=${score.toFixed(4)}`);
}
