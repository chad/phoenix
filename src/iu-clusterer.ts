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
  'name', 'id', 'identifier', 'list', 'set', 'thing', 'type',
  // NB: 'order' and 'item' are domain ENTITIES far more often than sequence words
  // (e-commerce order, line item), so they are NOT stop-anchors.
  'create', 'read', 'update', 'delete', 'edit', 'character', 'exceed', 'change',
  // adjectives / value words that describe an entity but must not name a cluster
  'negative', 'positive', 'least', 'most', 'empty', 'valid', 'invalid', 'active',
  // operation verbs — a cluster is a domain NOUN (entity/capability), never an
  // action. Anchoring on a verb like "allow"/"manage" merges unrelated entities
  // and makes IU identity unstable across re-planning (breaking selective regen).
  // Only UNAMBIGUOUS verbs — words that double as domain nouns (issue, order,
  // view, store, return, process, mark) are deliberately left out.
  'allow', 'manage', 'register', 'generate', 'deactivate', 'activate',
  'assign', 'provide', 'support', 'enable', 'accept', 'receive', 'handle',
  'validate', 'reopen', 'let', 'must', 'reset', 'submit', 'cancel', 'approve',
  'reject', 'compute', 'calculate',
  // requirement-phrasing words that surface as tags on adapted/operational specs
  // ("must include", "must equal", "must be able to", "must remain within") — a
  // cluster named 'include' or 'equal' is a phrasing artifact, never a domain
  'include', 'equal', 'able', 'exactly', 'within', 'contain', 'locally', 'other',
  'use', 'displayed', 'present', 'required', 'retain', 'offer', 'string', 'boolean',
  'who', 'optional', 'stored', 'named', 'deterministic', 'mvp',
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
  if (sub.size <= 1) return chunkSplit(c); // tags can't split — bound the grain anyway
  const result = mergeTiny([...sub].map(([anchor, nodes]) => ({ anchor, nodes })), tagsOf);
  // If every sub-bucket is a singleton, mergeTiny is a no-op and we'd emit only singletons
  // (violating MIN_CLUSTER) — keep the original cluster intact instead of exploding it.
  if (result.every(r => r.nodes.length < MIN_CLUSTER)) return chunkSplit(c);
  // A sub-bucket can still exceed the ceiling (one dominant second tag) — bound it.
  return result.flatMap(r => (r.nodes.length > MAX_CLUSTER ? chunkSplit(r) : [r]));
}

/**
 * Last-resort split when tags cannot partition an oversized cluster: stable
 * order-preserving chunks ("room", "room-2", …). Sacrifices semantic sub-naming to
 * keep every IU a generatable grain — an 80-node module fits no codegen prompt.
 */
function chunkSplit(c: CanonCluster): CanonCluster[] {
  if (c.nodes.length <= MAX_CLUSTER) return [c];
  const parts = Math.ceil(c.nodes.length / MAX_CLUSTER);
  const per = Math.ceil(c.nodes.length / parts);
  const out: CanonCluster[] = [];
  for (let i = 0; i < parts; i++) {
    out.push({ anchor: i === 0 ? c.anchor : `${c.anchor}-${i + 1}`, nodes: c.nodes.slice(i * per, (i + 1) * per) });
  }
  return out;
}

/** Above this many nodes, one prompt cannot hold the assignment JSON — go two-stage. */
export const LLM_SINGLE_CALL_MAX = 150;

export interface LLMClusterOptions {
  /** Invoked when LLM clustering fails and the deterministic rule clusterer takes
   *  over — a silent downgrade would present tag-heuristic module names as semantic
   *  judgment (this exact silence produced 'include'/'equal' modules once). */
  onFallback?: (err: Error) => void;
}

/**
 * LLM clusterer — the semantic primary. Partitions the canonical requirements into
 * cohesive domain modules (an entity + its constraints + its operations; a UI is its
 * own module; a derived report is its own module), which is the judgment a tag
 * heuristic can't reliably make. Falls back to the deterministic rule clusterer on
 * any transport/parse failure or for nodes the model leaves unassigned — LOUDLY,
 * via onFallback. Large graphs go two-stage (discover modules, then assign in
 * batches) because a single reply cannot hold a thousand-node mapping.
 */
export async function clusterCanonNodesLLM(
  nodes: CanonicalNode[],
  llm: LLMProvider,
  opts: LLMClusterOptions = {},
): Promise<CanonCluster[]> {
  const real = nodes.filter(n => n.type !== CanonicalType.CONTEXT);
  if (real.length === 0) return [];

  try {
    const clusters = real.length <= LLM_SINGLE_CALL_MAX
      ? await clusterSingleCall(real, llm)
      : await clusterTwoStage(real, llm);
    if (clusters.length === 0) throw new Error('LLM returned no usable clusters');
    clusters.sort((a, b) => b.nodes.length - a.nodes.length || (a.anchor < b.anchor ? -1 : 1));
    return clusters;
  } catch (e) {
    opts.onFallback?.(e instanceof Error ? e : new Error(String(e)));
    return clusterCanonNodes(real); // deterministic fallback
  }
}

/** Fold model-dropped requirements into rule-clustered homes so nothing is lost. */
function foldOrphans(clusters: CanonCluster[], real: CanonicalNode[], assigned: Set<number>): void {
  const orphans = real.filter((_, i) => !assigned.has(i));
  if (!orphans.length) return;
  for (const c of clusterCanonNodes(orphans)) {
    const existing = clusters.find(x => x.anchor === c.anchor);
    if (existing) existing.nodes.push(...c.nodes); else clusters.push(c);
  }
}

async function clusterSingleCall(real: CanonicalNode[], llm: LLMProvider): Promise<CanonCluster[]> {
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

  const raw = await llm.generate(prompt, { temperature: 0, maxTokens: 8192 });
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
  foldOrphans(clusters, real, assigned);
  return clusters;
}

/**
 * Two-stage clustering for large graphs. Stage A reads every statement (truncated)
 * and names the system's modules; stage B assigns requirements to those modules in
 * concurrent batches. Batch assignment is order-independent: results key on the
 * requirement's global number.
 */
async function clusterTwoStage(real: CanonicalNode[], llm: LLMProvider): Promise<CanonCluster[]> {
  // Stage A — discover the module list from the whole (truncated) corpus.
  const brief = real.map((n, i) => `${i + 1}. ${n.statement.replace(/\n/g, ' ').slice(0, 100)}`).join('\n');
  const nameRaw = await llm.generate(
    `Here are ${real.length} software requirements (truncated). Name the domain modules that partition this system — one per domain entity, one for the user-facing UI, one per genuinely derived view. Aim for ${Math.max(6, Math.min(24, Math.round(real.length / 40)))}–${Math.max(10, Math.min(30, Math.round(real.length / 25)))} modules. Return ONLY a JSON array of short lowercase names, no prose.\n\n${brief}`,
    { temperature: 0, maxTokens: 1024 },
  );
  const names = (JSON.parse(nameRaw.slice(nameRaw.indexOf('['), nameRaw.lastIndexOf(']') + 1)) as string[])
    .map(slugAnchor).filter((v, i, a) => v.length > 0 && a.indexOf(v) === i);
  if (names.length === 0) throw new Error('stage A returned no module names');

  // Stage B — assign every requirement to a module, in concurrent batches.
  const BATCH = 120, POOL = 4;
  const assignment = new Map<number, string>(); // global idx → module
  const batches: Array<{ start: number; nodes: CanonicalNode[] }> = [];
  for (let s = 0; s < real.length; s += BATCH) batches.push({ start: s, nodes: real.slice(s, s + BATCH) });
  let next = 0;
  async function worker(): Promise<void> {
    while (next < batches.length) {
      const b = batches[next++];
      const listed = b.nodes.map((n, i) => `${b.start + i + 1}. [${n.type}] ${n.statement.replace(/\n/g, ' ').slice(0, 200)}`).join('\n');
      try {
        const raw = await llm.generate(
          `Assign each requirement to exactly one of these modules: ${names.join(', ')}.\nReturn ONLY a JSON object mapping module name to the list of requirement numbers, e.g. {"room": [1, 4], "avatar": [2]}. Every number must appear exactly once. No prose.\n\n${listed}`,
          { temperature: 0, maxTokens: 4096 },
        );
        const obj = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Record<string, number[]>;
        for (const [name, nums] of Object.entries(obj)) {
          const anchor = slugAnchor(name);
          for (const num of nums || []) {
            const idx = num - 1;
            if (idx >= 0 && idx < real.length && !assignment.has(idx)) assignment.set(idx, anchor);
          }
        }
      } catch {
        // One failed batch must not nuke the whole semantic clustering — its nodes
        // fold into rule-clustered homes below (and if EVERY batch fails, the empty
        // assignment throws to the caller's loud fallback).
      }
    }
  }
  await Promise.all(Array.from({ length: POOL }, worker));
  if (assignment.size === 0) throw new Error('every assignment batch failed');

  const groups = new Map<string, CanonicalNode[]>();
  for (const [idx, anchor] of assignment) {
    if (!groups.has(anchor)) groups.set(anchor, []);
    groups.get(anchor)!.push(real[idx]);
  }
  let clusters: CanonCluster[] = [...groups].map(([anchor, ns]) => ({ anchor, nodes: ns }));
  foldOrphans(clusters, real, new Set(assignment.keys()));

  // Bound the grain: tiny clusters merge, oversized ones split by salient sub-tag —
  // a 100-node 'room' module is not a replaceable unit for codegen.
  const tagsOf = new Map<string, string[]>();
  const freq = new Map<string, number>();
  for (const n of real) {
    const ts = [...new Set((n.tags || []).map(singular).filter(t => t.length > 2))];
    tagsOf.set(n.canon_id, ts);
    for (const t of ts) freq.set(t, (freq.get(t) || 0) + 1);
  }
  clusters = mergeTiny(clusters, tagsOf);
  clusters = clusters.flatMap(c => (c.nodes.length > MAX_CLUSTER ? splitOversized(c, tagsOf, freq) : [c]));
  return clusters;
}

function slugAnchor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'module';
}
