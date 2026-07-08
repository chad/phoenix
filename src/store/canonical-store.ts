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
   * Get the full canonical graph.
   */
  getGraph(): CanonicalGraph {
    return this.loadGraph();
  }
}
