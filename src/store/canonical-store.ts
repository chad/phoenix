/**
 * Canonical Store — manages the Canonical Graph
 *
 * Persists canonical nodes and their provenance edges.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CanonicalNode, CanonicalGraph } from '../models/canonical.js';
import { ContentStore } from './content-store.js';

export class CanonicalStore {
  private contentStore: ContentStore;
  private graphPath: string;

  constructor(phoenixRoot: string) {
    this.contentStore = new ContentStore(phoenixRoot);
    const graphDir = join(phoenixRoot, 'graphs');
    mkdirSync(graphDir, { recursive: true });
    this.graphPath = join(graphDir, 'canonical.json');
  }

  private loadGraph(): CanonicalGraph {
    if (!existsSync(this.graphPath)) {
      return { nodes: {}, provenance: {} };
    }
    // An empty/partial file (process killed mid-write) must not brick the store.
    try {
      return JSON.parse(readFileSync(this.graphPath, 'utf8'));
    } catch {
      return { nodes: {}, provenance: {} };
    }
  }

  private saveGraph(graph: CanonicalGraph): void {
    writeFileSync(this.graphPath, JSON.stringify(graph, null, 2), 'utf8');
  }

  /**
   * Store canonical nodes and update the graph.
   */
  saveNodes(nodes: CanonicalNode[]): void {
    const graph = this.loadGraph();

    for (const node of nodes) {
      // Store in content store
      this.contentStore.put(node.canon_id, node);

      // Update graph index
      graph.nodes[node.canon_id] = node;

      // Update provenance
      for (const clauseId of node.source_clause_ids) {
        if (!graph.provenance[node.canon_id]) {
          graph.provenance[node.canon_id] = [];
        }
        if (!graph.provenance[node.canon_id].includes(clauseId)) {
          graph.provenance[node.canon_id].push(clauseId);
        }
      }
    }

    this.saveGraph(graph);
  }

  /**
   * Replace the entire canonical graph with a fresh node set. Canonicalization is
   * a full re-extraction, so nodes for clauses that no longer exist must be
   * dropped — otherwise stale nodes accumulate forever (conceptual-mass bloat)
   * and pollute IU planning, invalidation, and stability measurement. Returns the
   * canon_ids that were removed (now candidates for content-store GC).
   */
  replaceNodes(nodes: CanonicalNode[]): string[] {
    const previous = this.loadGraph();
    const keptIds = new Set(nodes.map(n => n.canon_id));
    const removed = Object.keys(previous.nodes).filter(id => !keptIds.has(id));

    const graph: CanonicalGraph = { nodes: {}, provenance: {} };
    for (const node of nodes) {
      this.contentStore.put(node.canon_id, node);
      graph.nodes[node.canon_id] = node;
      for (const clauseId of node.source_clause_ids) {
        (graph.provenance[node.canon_id] ??= []);
        if (!graph.provenance[node.canon_id].includes(clauseId)) {
          graph.provenance[node.canon_id].push(clauseId);
        }
      }
    }
    this.saveGraph(graph);
    // Reclaim the orphaned blobs — a dropped node's content should not linger.
    for (const id of removed) this.contentStore.remove(id);
    return removed;
  }

  /**
   * Get a canonical node by ID.
   */
  getNode(canonId: string): CanonicalNode | null {
    return this.contentStore.get<CanonicalNode>(canonId);
  }

  /**
   * Get all canonical nodes.
   */
  getAllNodes(): CanonicalNode[] {
    const graph = this.loadGraph();
    return Object.values(graph.nodes);
  }

  /**
   * Get canonical nodes sourced from a specific clause.
   */
  getNodesByClause(clauseId: string): CanonicalNode[] {
    const graph = this.loadGraph();
    return Object.values(graph.nodes).filter(
      n => n.source_clause_ids.includes(clauseId)
    );
  }

  /**
   * Re-point clause references after a clause was re-keyed without changing meaning.
   *
   * A clause's identity is `sha256(doc + normalized_text)`, and the normalizer's notion of
   * "formatting" is narrower than the change classifier's: a trailing full stop survives
   * normalization but is classified A (trivial). In that gap a clause silently gets a NEW
   * id while the canonical graph keeps pointing at the old one — so the next REAL edit to
   * that clause walks canon → IU and finds nothing, and selective invalidation reports
   * zero stale units. The defining capability, off, quietly, after a cosmetic edit.
   *
   * Rather than widen the normalizer (which re-keys every clause in every project), the
   * pipeline repairs the edge: an A-class change carries its old and new id here, and the
   * graph follows. Meaning is untouched — only the address changed.
   *
   * Returns the number of node references rewritten.
   */
  rekeyClauseReferences(remap: ReadonlyMap<string, string>): number {
    if (remap.size === 0) return 0;
    const graph = this.loadGraph();
    let rewritten = 0;

    for (const node of Object.values(graph.nodes)) {
      let touched = false;
      const ids = node.source_clause_ids.map(id => {
        const next = remap.get(id);
        if (next === undefined || next === id) return id;
        touched = true;
        return next;
      });
      if (!touched) continue;
      // De-duplicate: two clauses can re-key onto the same id if their normalized text
      // converged, and a node must not list the same source twice.
      node.source_clause_ids = [...new Set(ids)];
      this.contentStore.put(node.canon_id, node);
      graph.provenance[node.canon_id] = [...node.source_clause_ids];
      rewritten++;
    }

    if (rewritten > 0) this.saveGraph(graph);
    return rewritten;
  }

  /**
   * Get the full canonical graph.
   */
  getGraph(): CanonicalGraph {
    return this.loadGraph();
  }
}
