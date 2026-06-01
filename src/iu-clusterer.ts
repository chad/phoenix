/**
 * IU Clusterer — partition the canonical graph into domain modules.
 *
 * Replaces document-structure bucketing (group by markdown section) with
 * domain-driven clustering: each node is anchored to the entity or capability it
 * concerns, derived from its own tags — never from the heading it fell under.
 *
 *   - capability nodes (UI/view, or derived reports/rollups) cluster by capability,
 *     because presentation and derived views are concerns that span entities;
 *   - everything else clusters by its dominant domain entity (the most salient
 *     shared noun);
 *   - tiny clusters merge into their nearest neighbour, oversized clusters split,
 *     so each IU is a bounded, replaceable grain.
 *
 * The canonical statements and tags carry the domain; the graph is dense with
 * `refines` edges (every similar requirement links to every other), so connected
 * components collapse — entity anchoring is the robust signal.
 */

import type { CanonicalNode } from './models/canonical.js';
import { CanonicalType } from './models/canonical.js';
import type { LLMProvider } from './llm/provider.js';

export interface CanonCluster {
  /** Domain anchor — the entity or capability this cluster is about. */
  anchor: string;
  nodes: CanonicalNode[];
}

// Presentation concern — UI/view nodes cluster together regardless of entity.
const VIEW_MARKERS = new Set([
  'board', 'column', 'card', 'layout', 'page', 'screen', 'dashboard', 'kanban',
  'ui', 'web', 'browser', 'render', 'display', 'badge', 'button', 'dropdown',
  'sidebar', 'responsive', 'design', 'frontend', 'view', 'panel', 'modal',
]);
// Derived-view concern — rollups/reports cluster as "<entity>-rollup".
const REPORT_MARKERS = new Set([
  'rollup', 'report', 'summary', 'analytics', 'metric', 'breakdown', 'aggregate', 'chart', 'stat',
]);
// Generic tags + attribute/verb words that never anchor a cluster on their own (an
// attribute like "status" belongs to its entity, not to a cluster named "status").
const STOP_ANCHORS = new Set([
  'system', 'user', 'app', 'application', 'service', 'api', 'data', 'value', 'one',
  'interface', 'programmatic', 'request', 'response', 'field', 'time', 'date',
  'name', 'id', 'identifier', 'list', 'set', 'item', 'thing', 'type', 'order',
  'create', 'read', 'update', 'delete', 'edit', 'character', 'exceed', 'change',
  // common attributes / values
  'status', 'priority', 'point', 'estimate', 'capacity', 'title', 'goal', 'label',
  'assignee', 'description', 'count', 'color', 'complete', 'overdue', 'unique', 'integer',
  'email', 'isbn', 'author', 'address', 'phone', 'amount', 'quantity', 'price',
]);

export function singular(t: string): string {
  // Leave non-plural endings intact so the canonical tag vocabulary isn't corrupted
  // (status, analysis, analytics, class, bus, series) — these also appear in the marker
  // and stop-anchor sets, so over-stripping would break membership tests.
  if (/(?:ss|us|is|ics|series)$/.test(t)) return t;
  if (t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.endsWith('s')) return t.slice(0, -1);
  return t;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

const MIN_CLUSTER = 2;     // singletons merge into a neighbour
const MAX_CLUSTER = 24;    // oversized clusters split (conceptual-mass ceiling)

/**
 * Cluster canonical nodes into domain modules. Deterministic; no LLM.
 */
export function clusterCanonNodes(nodes: CanonicalNode[]): CanonCluster[] {
  const real = nodes.filter(n => n.type !== CanonicalType.CONTEXT);
  if (real.length === 0) return [];

  // Singularized tag sets + corpus frequency.
  const tagsOf = new Map<string, string[]>();
  const freq = new Map<string, number>();
  for (const n of real) {
    const ts = [...new Set((n.tags || []).map(singular).filter(t => t.length > 2))];
    tagsOf.set(n.canon_id, ts);
    for (const t of ts) freq.set(t, (freq.get(t) || 0) + 1);
  }
  const f = (t: string) => freq.get(t) || 0;
  const byFreqDesc = (a: string, b: string) => f(b) - f(a) || (a < b ? -1 : 1);

  // One corpus-level anchor per capability — presentation (UI/view) is a single
  // module however many view nouns it uses (board, column, card, …); likewise each
  // derived-view kind (rollup/report) is one module.
  const topMarker = (markers: Set<string>) =>
    [...freq.keys()].filter(t => markers.has(t)).sort(byFreqDesc)[0];
  const viewAnchor = topMarker(VIEW_MARKERS);
  const reportAnchor = topMarker(REPORT_MARKERS);

  // Anchor each node by its PRIMARY concern — the most salient (highest-frequency)
  // tag that isn't a generic stop word. A node merely mentioning a view/report word
  // is not a view/report node unless that is its primary concern.
  const anchorOf = new Map<string, string>();
  for (const n of real) {
    const ranked = tagsOf.get(n.canon_id)!.filter(t => !STOP_ANCHORS.has(t)).sort(byFreqDesc);
    const top = ranked[0];

    let anchor: string;
    if (viewAnchor && top && VIEW_MARKERS.has(top)) anchor = viewAnchor;             // presentation
    else if (reportAnchor && top && REPORT_MARKERS.has(top)) anchor = reportAnchor;  // derived view
    else {
      const entity = ranked.find(t => !VIEW_MARKERS.has(t) && !REPORT_MARKERS.has(t) && f(t) >= 2);
      anchor = entity ?? top ?? 'general';
    }
    anchorOf.set(n.canon_id, anchor);
  }

  // Attach constraints/invariants to the entity they constrain by following typed
  // edges — an attribute constraint ("title must not exceed 200 chars") belongs to
  // its entity, not to a cluster named after the attribute.
  const byId = new Map(real.map(n => [n.canon_id, n]));
  for (const n of real) {
    if (n.type !== CanonicalType.CONSTRAINT && n.type !== CanonicalType.INVARIANT) continue;
    const tally = new Map<string, number>();
    for (const [targetId, edge] of Object.entries(n.link_types || {})) {
      if (!['constrains', 'invariant_of', 'refines', 'defines'].includes(edge)) continue;
      const target = byId.get(targetId);
      if (!target || target.type === CanonicalType.CONSTRAINT || target.type === CanonicalType.INVARIANT) continue;
      const a = anchorOf.get(targetId);
      if (a) tally.set(a, (tally.get(a) || 0) + 1);
    }
    const best = [...tally].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0];
    if (best) anchorOf.set(n.canon_id, best[0]);
  }

  // Group, then resolve singletons (merge into nearest by tag overlap) and oversize.
  const groups = new Map<string, CanonicalNode[]>();
  for (const n of real) {
    const a = anchorOf.get(n.canon_id)!;
    if (!groups.has(a)) groups.set(a, []);
    groups.get(a)!.push(n);
  }
  let clusters: CanonCluster[] = [...groups].map(([anchor, ns]) => ({ anchor, nodes: ns }));

  clusters = mergeTiny(clusters, tagsOf);
  clusters = clusters.flatMap(c => (c.nodes.length > MAX_CLUSTER ? splitOversized(c, tagsOf, freq) : [c]));

  // Stable order: largest domain first.
  clusters.sort((a, b) => b.nodes.length - a.nodes.length || (a.anchor < b.anchor ? -1 : 1));
  return clusters;
}

function clusterTags(c: CanonCluster, tagsOf: Map<string, string[]>): Set<string> {
  const s = new Set<string>();
  for (const n of c.nodes) for (const t of tagsOf.get(n.canon_id) || []) s.add(t);
  return s;
}

/** Merge clusters below the minimum size into the nearest larger cluster by tag overlap. */
function mergeTiny(clusters: CanonCluster[], tagsOf: Map<string, string[]>): CanonCluster[] {
  const tiny = clusters.filter(c => c.nodes.length < MIN_CLUSTER);
  const big = clusters.filter(c => c.nodes.length >= MIN_CLUSTER);
  if (tiny.length === 0 || big.length === 0) return clusters;
  const bigTags = big.map(c => clusterTags(c, tagsOf));
  // Deterministic fallback for a zero-overlap orphan: the LARGEST cluster (tiebreak by
  // anchor codepoint) — absorbs noise singletons without depending on input order.
  let fallback = 0;
  big.forEach((c, i) => {
    if (c.nodes.length > big[fallback].nodes.length ||
        (c.nodes.length === big[fallback].nodes.length && c.anchor < big[fallback].anchor)) fallback = i;
  });
  for (const t of tiny) {
    const tt = clusterTags(t, tagsOf);
    let best = 0, bestIdx = -1;
    bigTags.forEach((bt, i) => { const j = jaccard(tt, bt); if (j > best) { best = j; bestIdx = i; } });
    big[bestIdx >= 0 ? bestIdx : fallback].nodes.push(...t.nodes);
  }
  return big;
}

/** Split an oversized cluster by its second-most-salient tag. */
function splitOversized(c: CanonCluster, tagsOf: Map<string, string[]>, freq: Map<string, number>): CanonCluster[] {
  const f = (t: string) => freq.get(t) || 0;
  const sub = new Map<string, CanonicalNode[]>();
  for (const n of c.nodes) {
    const ts = (tagsOf.get(n.canon_id) || []).filter(t => t !== c.anchor && !STOP_ANCHORS.has(t)).sort((a, b) => f(b) - f(a));
    const key = ts[0] ? `${c.anchor}-${ts[0]}` : c.anchor;
    if (!sub.has(key)) sub.set(key, []);
    sub.get(key)!.push(n);
  }
  if (sub.size <= 1) return [c]; // can't split meaningfully
  const result = mergeTiny([...sub].map(([anchor, nodes]) => ({ anchor, nodes })), tagsOf);
  // If every sub-bucket is a singleton, mergeTiny is a no-op and we'd emit only singletons
  // (violating MIN_CLUSTER) — keep the original cluster intact instead of exploding it.
  if (result.every(r => r.nodes.length < MIN_CLUSTER)) return [c];
  return result;
}

/**
 * LLM clusterer — the semantic primary. Partitions the canonical requirements into
 * cohesive domain modules (an entity + its constraints + its operations; a UI is its
 * own module; a derived report is its own module), which is the judgment a tag
 * heuristic can't reliably make. Falls back to the deterministic rule clusterer on
 * any transport/parse failure or for nodes the model leaves unassigned.
 */
export async function clusterCanonNodesLLM(
  nodes: CanonicalNode[],
  llm: LLMProvider,
): Promise<CanonCluster[]> {
  const real = nodes.filter(n => n.type !== CanonicalType.CONTEXT);
  if (real.length === 0) return [];

  const listed = real.map((n, i) => `${i + 1}. [${n.type}] ${n.statement.replace(/\n/g, ' ')}`).join('\n');
  const prompt = `Group these software requirements into cohesive implementation modules.

A module is ONE real-world thing. The whole system is usually 3–6 modules:
- one module per domain ENTITY — its data model, ALL its validation/workflow rules, AND its API/operations are the SAME module. Never split "issue" from "issue api" or "issue validation"; combine them into one "issue" module.
- one module for the user-facing UI (the board/dashboard), separate from the entities it displays.
- one module per genuinely DERIVED view (e.g. a rollup/report computed from other entities).

Do NOT create a module for a cross-cutting phrase like "expose a programmatic interface", or for generic definitions/identifiers — attach those requirements to the entity they most concern. Group by domain meaning, never by document structure. Every module must be replaceable on its own.

Return ONLY a JSON array: [{"name": "<short entity or capability name>", "members": [<requirement numbers>]}], with every requirement assigned to exactly one module and no prose.

Requirements:
${listed}`;

  try {
    const raw = await llm.generate(prompt, { temperature: 0, maxTokens: 4096 });
    const json = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1);
    const groups = JSON.parse(json) as { name: string; members: number[] }[];
    const assigned = new Set<number>();
    const clusters: CanonCluster[] = [];
    for (const g of groups) {
      const ns: CanonicalNode[] = [];
      for (const m of g.members || []) {
        const idx = m - 1;
        if (idx >= 0 && idx < real.length && !assigned.has(idx)) { assigned.add(idx); ns.push(real[idx]); }
      }
      if (ns.length) clusters.push({ anchor: slugAnchor(g.name), nodes: ns });
    }
    // Any requirement the model dropped: fold into the rule-clustered home so nothing is lost.
    const orphans = real.filter((_, i) => !assigned.has(i));
    if (orphans.length) {
      for (const c of clusterCanonNodes(orphans)) {
        const existing = clusters.find(x => x.anchor === c.anchor);
        if (existing) existing.nodes.push(...c.nodes); else clusters.push(c);
      }
    }
    if (clusters.length === 0) return clusterCanonNodes(real);
    clusters.sort((a, b) => b.nodes.length - a.nodes.length || (a.anchor < b.anchor ? -1 : 1));
    return clusters;
  } catch {
    return clusterCanonNodes(real); // deterministic fallback
  }
}

function slugAnchor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'module';
}
