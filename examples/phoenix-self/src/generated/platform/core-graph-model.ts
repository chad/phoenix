import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

export type ContentHash = string;
export type VersionHash = string;
export type NodeId = string;
export type EdgeId = string;

export interface VersionedContent {
  readonly hash: ContentHash;
  readonly version: VersionHash;
  readonly content: unknown;
  readonly timestamp: number;
}

export interface GraphNode {
  readonly id: NodeId;
  readonly type: string;
  readonly content: VersionedContent;
  readonly dependencies: Set<NodeId>;
  readonly dependents: Set<NodeId>;
}

export interface GraphEdge {
  readonly id: EdgeId;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly type: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: number;
}

export interface ProvenanceEdge extends GraphEdge {
  readonly transformationType: string;
  readonly sourceGraph: GraphType;
  readonly targetGraph: GraphType;
  readonly causedBy: NodeId | null;
}

export type GraphType = 'spec' | 'canonical' | 'implementation' | 'evidence' | 'provenance';

export interface InvalidationResult {
  readonly invalidatedNodes: Set<NodeId>;
  readonly preservedNodes: Set<NodeId>;
  readonly affectedGraphs: Set<GraphType>;
}

export class CoreGraphModel extends EventEmitter {
  private readonly graphs = new Map<GraphType, Map<NodeId, GraphNode>>();
  private readonly edges = new Map<EdgeId, GraphEdge>();
  private readonly provenanceEdges = new Map<EdgeId, ProvenanceEdge>();
  private readonly contentIndex = new Map<ContentHash, Set<NodeId>>();
  private readonly versionIndex = new Map<VersionHash, NodeId>();

  constructor() {
    super();
    this.initializeGraphs();
  }

  private initializeGraphs(): void {
    const graphTypes: GraphType[] = ['spec', 'canonical', 'implementation', 'evidence', 'provenance'];
    for (const type of graphTypes) {
      this.graphs.set(type, new Map());
    }
  }

  public addNode(graphType: GraphType, nodeType: string, content: unknown): NodeId {
    const versionedContent = this.createVersionedContent(content);
    const nodeId = this.generateNodeId(graphType, nodeType, versionedContent.hash);
    
    const node: GraphNode = {
      id: nodeId,
      type: nodeType,
      content: versionedContent,
      dependencies: new Set(),
      dependents: new Set()
    };

    const graph = this.graphs.get(graphType);
    if (!graph) {
      throw new Error(`Invalid graph type: ${graphType}`);
    }

    graph.set(nodeId, node);
    this.indexContent(versionedContent.hash, nodeId);
    this.versionIndex.set(versionedContent.version, nodeId);

    this.emit('nodeAdded', { graphType, nodeId, node });
    return nodeId;
  }

  public addEdge(from: NodeId, to: NodeId, edgeType: string, metadata: Record<string, unknown> = {}): EdgeId {
    const edgeId = this.generateEdgeId(from, to, edgeType);
    const edge: GraphEdge = {
      id: edgeId,
      from,
      to,
      type: edgeType,
      metadata,
      timestamp: Date.now()
    };

    this.edges.set(edgeId, edge);
    this.updateDependencies(from, to);

    this.emit('edgeAdded', { edgeId, edge });
    return edgeId;
  }

  public addProvenanceEdge(
    from: NodeId,
    to: NodeId,
    transformationType: string,
    sourceGraph: GraphType,
    targetGraph: GraphType,
    causedBy: NodeId | null = null,
    metadata: Record<string, unknown> = {}
  ): EdgeId {
    const edgeId = this.generateEdgeId(from, to, 'provenance');
    const provenanceEdge: ProvenanceEdge = {
      id: edgeId,
      from,
      to,
      type: 'provenance',
      transformationType,
      sourceGraph,
      targetGraph,
      causedBy,
      metadata,
      timestamp: Date.now()
    };

    this.provenanceEdges.set(edgeId, provenanceEdge);
    this.edges.set(edgeId, provenanceEdge);

    const provenanceGraph = this.graphs.get('provenance');
    if (provenanceGraph) {
      const provenanceNodeId = this.addNode('provenance', 'transformation', {
        edge: provenanceEdge,
        transformation: transformationType
      });
    }

    this.emit('provenanceEdgeAdded', { edgeId, provenanceEdge });
    return edgeId;
  }

  public invalidateSubtree(changedNodeId: NodeId): InvalidationResult {
    const invalidatedNodes = new Set<NodeId>();
    const preservedNodes = new Set<NodeId>();
    const affectedGraphs = new Set<GraphType>();

    // Find all dependent nodes recursively
    const toInvalidate = new Set<NodeId>([changedNodeId]);
    const visited = new Set<NodeId>();

    while (toInvalidate.size > 0) {
      const iterator = toInvalidate.values();
      const next = iterator.next();
      if (next.done) break;
      
      const nodeId = next.value;
      toInvalidate.delete(nodeId);

      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = this.findNode(nodeId);
      if (!node) continue;

      invalidatedNodes.add(nodeId);
      
      // Find which graph this node belongs to
      for (const [graphType, graph] of this.graphs) {
        if (graph.has(nodeId)) {
          affectedGraphs.add(graphType);
          break;
        }
      }

      // Add all dependents to invalidation queue
      for (const dependentId of node.dependents) {
        if (!visited.has(dependentId)) {
          toInvalidate.add(dependentId);
        }
      }
    }

    // Collect preserved nodes (all nodes not invalidated)
    for (const graph of this.graphs.values()) {
      for (const nodeId of graph.keys()) {
        if (!invalidatedNodes.has(nodeId)) {
          preservedNodes.add(nodeId);
        }
      }
    }

    const result: InvalidationResult = {
      invalidatedNodes,
      preservedNodes,
      affectedGraphs
    };

    this.emit('subtreeInvalidated', result);
    return result;
  }

  public getNode(nodeId: NodeId): GraphNode | undefined {
    return this.findNode(nodeId);
  }

  public getEdge(edgeId: EdgeId): GraphEdge | undefined {
    return this.edges.get(edgeId);
  }

  public getProvenanceEdge(edgeId: EdgeId): ProvenanceEdge | undefined {
    return this.provenanceEdges.get(edgeId);
  }

  public getGraph(graphType: GraphType): ReadonlyMap<NodeId, GraphNode> {
    const graph = this.graphs.get(graphType);
    if (!graph) {
      throw new Error(`Invalid graph type: ${graphType}`);
    }
    return graph;
  }

  public getNodesByContent(contentHash: ContentHash): Set<NodeId> {
    return this.contentIndex.get(contentHash) || new Set();
  }

  public getNodeByVersion(versionHash: VersionHash): NodeId | undefined {
    return this.versionIndex.get(versionHash);
  }

  public getAllProvenanceEdges(): ReadonlyMap<EdgeId, ProvenanceEdge> {
    return this.provenanceEdges;
  }

  private createVersionedContent(content: unknown): VersionedContent {
    const contentStr = JSON.stringify(content, null, 0);
    const hash = this.computeHash(contentStr);
    const version = this.computeHash(contentStr + Date.now());
    
    return {
      hash,
      version,
      content,
      timestamp: Date.now()
    };
  }

  private computeHash(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }

  private generateNodeId(graphType: GraphType, nodeType: string, contentHash: ContentHash): NodeId {
    return this.computeHash(`${graphType}:${nodeType}:${contentHash}:${Date.now()}`);
  }

  private generateEdgeId(from: NodeId, to: NodeId, edgeType: string): EdgeId {
    return this.computeHash(`${from}:${to}:${edgeType}:${Date.now()}`);
  }

  private indexContent(contentHash: ContentHash, nodeId: NodeId): void {
    if (!this.contentIndex.has(contentHash)) {
      this.contentIndex.set(contentHash, new Set());
    }
    this.contentIndex.get(contentHash)!.add(nodeId);
  }

  private updateDependencies(from: NodeId, to: NodeId): void {
    const fromNode = this.findNode(from);
    const toNode = this.findNode(to);

    if (fromNode && toNode) {
      toNode.dependencies.add(from);
      fromNode.dependents.add(to);
    }
  }

  private findNode(nodeId: NodeId): GraphNode | undefined {
    for (const graph of this.graphs.values()) {
      const node = graph.get(nodeId);
      if (node) return node;
    }
    return undefined;
  }
}

export function createCoreGraphModel(): CoreGraphModel {
  return new CoreGraphModel();
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'df612c58111cfb2db926cf097e631dddca84075b068227edb30ac28b6d15d8a3',
  name: 'Core Graph Model',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;