/**
 * Resolution Engine — Phase 2 of canonicalization.
 *
 * Takes flat CandidateNode[] from extraction and produces
 * a structured CanonicalGraph with:
 * - Deduplication / merge of equivalent candidates
 * - Typed edge inference (constrains, defines, refines, etc.)
 * - Hierarchy from heading structure
 * - canon_anchor for stable soft identity
 * - IDF-weighted linking via inverted index (replaces O(n²))
 */

import type { CanonicalNode, CandidateNode } from './models/canonical.js';
import type { Clause } from './models/clause.js';
import type { EdgeType } from './models/canonical.js';
import { CanonicalType } from './models/canonical.js';
import { sha256 } from './semhash.js';

/** Maximum outgoing edges per node (excluding 'duplicates') */
const MAX_DEGREE = 8;

/** Minimum shared tags for a link (at least 1 must be non-trivial) */
const MIN_SHARED_TAGS = 2;

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Resolve candidate nodes into a canonical graph.
 */
export function resolveGraph(candidates: CandidateNode[], clauses: Clause[]): CanonicalNode[] {
  if (candidates.length === 0) return [];

  // Build clause index for hierarchy inference
  const clauseMap = new Map(clauses.map(c => [c.clause_id, c]));

  // Step 1: Convert candidates to draft nodes
  let nodes = candidates.map(c => candidateToNode(c));

  // Step 2: Deduplicate
  nodes = deduplicateNodes(nodes);

  // Step 3: Compute IDF over all tags
  const idf = computeIDF(nodes);

  // Step 4: Build inverted index and infer typed edges
  inferTypedEdges(nodes, idf);

  // Step 5: Infer hierarchy from heading structure
  inferHierarchy(nodes, clauseMap);

  // Step 6: Compute anchors
  computeAnchors(nodes);

  // Step 7: Enforce max degree
  enforceMaxDegree(nodes, idf);

  return nodes;
}

// ─── Step 1: Convert ─────────────────────────────────────────────────────────

function candidateToNode(c: CandidateNode): CanonicalNode {
  return {
    canon_id: c.candidate_id,
    type: c.type,
    statement: c.statement,
    confidence: c.confidence,
    source_clause_ids: [...c.source_clause_ids],
    linked_canon_ids: [],
    link_types: {},
    tags: [...c.tags],
    extraction_method: c.extraction_method,
  };
}

// ─── Step 2: Deduplication ───────────────────────────────────────────────────

function deduplicateNodes(nodes: CanonicalNode[]): CanonicalNode[] {
  // Group by normalized statement fingerprint (token trigrams)
  const groups = new Map<string, CanonicalNode[]>();

  for (const node of nodes) {
    const fp = statementFingerprint(node.statement);
    const group = groups.get(fp) ?? [];
    group.push(node);
    groups.set(fp, group);
  }

  const merged: CanonicalNode[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }

    // Check pairwise similarity within fingerprint group
    const used = new Set<number>();
    for (let i = 0; i < group.length; i++) {
      if (used.has(i)) continue;

      let primary = group[i];
      const mergedSources = new Set(primary.source_clause_ids);
      const mergedTags = new Set(primary.tags);

      for (let j = i + 1; j < group.length; j++) {
        if (used.has(j)) continue;
        const sim = tokenJaccard(primary.statement, group[j].statement);
        if (sim > 0.7 && areTypesCompatible(primary.type, group[j].type)) {
          // Merge: keep higher confidence node as primary
          used.add(j);
          for (const s of group[j].source_clause_ids) mergedSources.add(s);
          for (const t of group[j].tags) mergedTags.add(t);

          if ((group[j].confidence ?? 0) > (primary.confidence ?? 0)) {
            const oldSources = mergedSources;
            primary = { ...group[j], source_clause_ids: [...oldSources], tags: [...mergedTags] };
          }
        }
      }

      primary.source_clause_ids = [...mergedSources];
      primary.tags = [...mergedTags];
      merged.push(primary);
    }
  }

  return merged;
}

function statementFingerprint(statement: string): string {
  // Coarse fingerprint: sorted 3-char token prefixes
  const tokens = statement.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const prefixes = tokens.map(t => t.slice(0, 3)).sort();
  // Use first 8 prefixes as bucket key
  return prefixes.slice(0, 8).join('|');
}

function tokenJaccard(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\s+/));
  const tb = new Set(b.toLowerCase().split(/\s+/));
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function areTypesCompatible(a: CanonicalType, b: CanonicalType): boolean {
  if (a === b) return true;
  if (a === CanonicalType.CONTEXT || b === CanonicalType.CONTEXT) return true;
  return false;
}

// ─── Step 3: IDF computation ─────────────────────────────────────────────────

function computeIDF(nodes: CanonicalNode[]): Map<string, number> {
  const docFreq = new Map<string, number>();
  const N = nodes.length;

  for (const node of nodes) {
    const uniqueTags = new Set(node.tags);
    for (const tag of uniqueTags) {
      docFreq.set(tag, (docFreq.get(tag) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [tag, df] of docFreq) {
    idf.set(tag, Math.log((N + 1) / (df + 1)) + 1);
  }

  return idf;
}

// ─── Step 4: Typed edge inference ────────────────────────────────────────────

function inferTypedEdges(nodes: CanonicalNode[], idf: Map<string, number>): void {
  // Build inverted index: tag → node indices
  const tagIndex = new Map<string, number[]>();
  for (let i = 0; i < nodes.length; i++) {
    for (const tag of nodes[i].tags) {
      const list = tagIndex.get(tag) ?? [];
      list.push(i);
      tagIndex.set(tag, list);
    }
  }

  // Compute IDF threshold: only skip tags appearing in >40% of nodes.
  // IDF for a tag in 40% of N nodes ≈ log(N / (0.4*N)) + 1 ≈ log(2.5) + 1 ≈ 1.92
  // We use a hard threshold based on document frequency, not percentile.
  const N = nodes.length;
  const maxDF = Math.max(2, Math.floor(N * 0.4)); // tags in >40% of nodes are trivial
  const idfThreshold = Math.log((N + 1) / (maxDF + 1)) + 1;

  // Generate candidate pairs from inverted index
  const pairScores = new Map<string, { i: number; j: number; sharedNonTrivial: number; sharedTags: string[] }>();

  for (const [tag, indices] of tagIndex) {
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const i = indices[a];
        const j = indices[b];
        const key = i < j ? `${i}:${j}` : `${j}:${i}`;
        const entry = pairScores.get(key) ?? { i: Math.min(i, j), j: Math.max(i, j), sharedNonTrivial: 0, sharedTags: [] };
        const tagIdf = idf.get(tag) ?? 0;
        if (tagIdf > idfThreshold) {
          entry.sharedNonTrivial++;
        }
        entry.sharedTags.push(tag);
        pairScores.set(key, entry);
      }
    }
  }

  // Create edges for pairs with enough shared tags (at least MIN_SHARED_TAGS total,
  // and at least 1 non-trivial tag)
  for (const { i, j, sharedNonTrivial, sharedTags } of pairScores.values()) {
    if (sharedTags.length < MIN_SHARED_TAGS || sharedNonTrivial < 1) continue;

    const nodeA = nodes[i];
    const nodeB = nodes[j];

    // Skip linking canon→canon within same canon_id
    if (nodeA.canon_id === nodeB.canon_id) continue;

    // Infer edge type
    const edgeType = inferEdgeType(nodeA, nodeB);

    // Add bidirectional link
    addEdge(nodeA, nodeB, edgeType);
    addEdge(nodeB, nodeA, reverseEdgeType(edgeType));
  }
}

function inferEdgeType(from: CanonicalNode, to: CanonicalNode): EdgeType {
  // Constraint → Requirement = constrains
  if (from.type === CanonicalType.CONSTRAINT && to.type === CanonicalType.REQUIREMENT) return 'constrains';
  if (from.type === CanonicalType.REQUIREMENT && to.type === CanonicalType.CONSTRAINT) return 'constrains';

  // Invariant → Requirement = invariant_of
  if (from.type === CanonicalType.INVARIANT && to.type === CanonicalType.REQUIREMENT) return 'invariant_of';
  if (from.type === CanonicalType.REQUIREMENT && to.type === CanonicalType.INVARIANT) return 'invariant_of';

  // Definition → anything = defines
  if (from.type === CanonicalType.DEFINITION) return 'defines';
  if (to.type === CanonicalType.DEFINITION) return 'defines';

  // Context → Requirement = refines
  if (from.type === CanonicalType.CONTEXT && to.type === CanonicalType.REQUIREMENT) return 'refines';
  if (from.type === CanonicalType.REQUIREMENT && to.type === CanonicalType.CONTEXT) return 'refines';

  return 'relates_to';
}

function reverseEdgeType(type: EdgeType): EdgeType {
  // Most edge types are symmetric in our model
  return type;
}

function addEdge(from: CanonicalNode, to: CanonicalNode, type: EdgeType): void {
  if (!from.linked_canon_ids.includes(to.canon_id)) {
    from.linked_canon_ids.push(to.canon_id);
  }
  if (!from.link_types) from.link_types = {};
  from.link_types[to.canon_id] = type;
}

// ─── Step 5: Hierarchy inference ─────────────────────────────────────────────

function inferHierarchy(nodes: CanonicalNode[], clauseMap: Map<string, Clause>): void {
  // Group nodes by source document
  const byDoc = new Map<string, CanonicalNode[]>();
  for (const node of nodes) {
    for (const clauseId of node.source_clause_ids) {
      const clause = clauseMap.get(clauseId);
      if (!clause) continue;
      const docId = clause.source_doc_id;
      const list = byDoc.get(docId) ?? [];
      list.push(node);
      byDoc.set(docId, list);
    }
  }

  for (const docNodes of byDoc.values()) {
    // Find CONTEXT nodes and their section depth
    const contextNodes: { node: CanonicalNode; depth: number; sectionPath: string[] }[] = [];
    const nonContextNodes: { node: CanonicalNode; depth: number; sectionPath: string[] }[] = [];

    for (const node of docNodes) {
      const clause = clauseMap.get(node.source_clause_ids[0]);
      if (!clause) continue;
      const depth = clause.section_path.length;
      const entry = { node, depth, sectionPath: clause.section_path };

      if (node.type === CanonicalType.CONTEXT) {
        contextNodes.push(entry);
      } else {
        nonContextNodes.push(entry);
      }
    }

    // For each non-context node, find the nearest context parent
    // (same doc, shallower or equal depth, matching section prefix)
    for (const child of nonContextNodes) {
      let bestParent: CanonicalNode | null = null;
      let bestDepth = -1;

      for (const parent of contextNodes) {
        if (parent.depth < child.depth && parent.depth > bestDepth) {
          // Check section path prefix match
          const prefixMatch = parent.sectionPath.every((seg, i) => child.sectionPath[i] === seg);
          if (prefixMatch) {
            bestParent = parent.node;
            bestDepth = parent.depth;
          }
        }
      }

      if (bestParent) {
        child.node.parent_canon_id = bestParent.canon_id;
      }
    }
  }
}

// ─── Step 6: Anchor computation ──────────────────────────────────────────────

function computeAnchors(nodes: CanonicalNode[]): void {
  for (const node of nodes) {
    const sortedTags = [...node.tags].sort().join(',');
    const sortedSources = [...node.source_clause_ids].sort().join(',');
    node.canon_anchor = sha256([node.type, sortedTags, sortedSources].join('\x00'));
  }
}

// ─── Step 7: Enforce max degree ──────────────────────────────────────────────

function enforceMaxDegree(nodes: CanonicalNode[], idf: Map<string, number>): void {
  for (const node of nodes) {
    // Count non-duplicate edges
    const edges = node.linked_canon_ids.filter(
      id => node.link_types?.[id] !== 'duplicates'
    );

    if (edges.length <= MAX_DEGREE) continue;

    // Score each edge by shared tag IDF
    const nodeTagSet = new Set(node.tags);
    const edgeScores: { id: string; score: number }[] = [];

    const nodeIndex = new Map(nodes.map(n => [n.canon_id, n]));

    for (const id of edges) {
      const target = nodeIndex.get(id);
      if (!target) { edgeScores.push({ id, score: 0 }); continue; }

      let score = 0;
      for (const tag of target.tags) {
        if (nodeTagSet.has(tag)) {
          score += idf.get(tag) ?? 0;
        }
      }
      edgeScores.push({ id, score });
    }

    // Keep top MAX_DEGREE edges by score
    edgeScores.sort((a, b) => b.score - a.score);
    const keep = new Set(edgeScores.slice(0, MAX_DEGREE).map(e => e.id));

    // Also keep all 'duplicates' edges
    for (const id of node.linked_canon_ids) {
      if (node.link_types?.[id] === 'duplicates') keep.add(id);
    }

    // Filter
    node.linked_canon_ids = node.linked_canon_ids.filter(id => keep.has(id));
    if (node.link_types) {
      for (const id of Object.keys(node.link_types)) {
        if (!keep.has(id)) delete node.link_types[id];
      }
    }
  }
}
