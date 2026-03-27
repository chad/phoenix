import { EventEmitter } from 'node:events';

export interface ShadowMetrics {
  nodechangepct: number;
  edgechangepct: number;
  riskescalations: number;
  orphannodes: number;
  outofscopegrowth: number;
  semanticstmt_drift: number;
}

export interface PipelineResult {
  nodes: Map<string, any>;
  edges: Map<string, any>;
  metadata: Record<string, any>;
}

export interface ShadowComparison {
  oldResult: PipelineResult;
  newResult: PipelineResult;
  metrics: ShadowMetrics;
  timestamp: number;
}

export type UpgradeClassification = 'safe' | 'compaction' | 'reject';

export interface UpgradeDecision {
  classification: UpgradeClassification;
  metrics: ShadowMetrics;
  reasons: string[];
  canApply: boolean;
}

export interface ShadowCanonicalizer {
  runShadowComparison(oldPipeline: () => Promise<PipelineResult>, newPipeline: () => Promise<PipelineResult>): Promise<ShadowComparison>;
  classifyUpgrade(metrics: ShadowMetrics): UpgradeDecision;
  acceptUpgrade(comparison: ShadowComparison): void;
  on(event: 'shadow-complete', listener: (comparison: ShadowComparison) => void): this;
  on(event: 'upgrade-classified', listener: (decision: UpgradeDecision) => void): this;
  on(event: 'upgrade-accepted', listener: (comparison: ShadowComparison) => void): this;
}

class ShadowCanonicalizerImpl extends EventEmitter implements ShadowCanonicalizer {
  private acceptedUpgrades = new Set<string>();

  async runShadowComparison(
    oldPipeline: () => Promise<PipelineResult>,
    newPipeline: () => Promise<PipelineResult>
  ): Promise<ShadowComparison> {
    const [oldResult, newResult] = await Promise.all([
      oldPipeline(),
      newPipeline()
    ]);

    const metrics = this.computeMetrics(oldResult, newResult);
    
    const comparison: ShadowComparison = {
      oldResult,
      newResult,
      metrics,
      timestamp: Date.now()
    };

    this.emit('shadow-complete', comparison);
    return comparison;
  }

  private computeMetrics(oldResult: PipelineResult, newResult: PipelineResult): ShadowMetrics {
    const oldNodeCount = oldResult.nodes.size;
    const newNodeCount = newResult.nodes.size;
    const oldEdgeCount = oldResult.edges.size;
    const newEdgeCount = newResult.edges.size;

    const nodechangepct = oldNodeCount === 0 ? 0 : 
      Math.abs(newNodeCount - oldNodeCount) / oldNodeCount * 100;

    const edgechangepct = oldEdgeCount === 0 ? 0 :
      Math.abs(newEdgeCount - oldEdgeCount) / oldEdgeCount * 100;

    const orphannodes = this.countOrphanNodes(oldResult, newResult);
    const riskescalations = this.countRiskEscalations(oldResult, newResult);
    const outofscopegrowth = this.measureOutOfScopeGrowth(oldResult, newResult);
    const semanticstmt_drift = this.measureSemanticDrift(oldResult, newResult);

    return {
      nodechangepct,
      edgechangepct,
      riskescalations,
      orphannodes,
      outofscopegrowth,
      semanticstmt_drift
    };
  }

  private countOrphanNodes(oldResult: PipelineResult, newResult: PipelineResult): number {
    let orphanCount = 0;
    
    for (const [nodeId] of oldResult.nodes) {
      if (!newResult.nodes.has(nodeId)) {
        const hasIncomingEdges = Array.from(oldResult.edges.values())
          .some((edge: any) => edge.target === nodeId);
        const hasOutgoingEdges = Array.from(oldResult.edges.values())
          .some((edge: any) => edge.source === nodeId);
        
        if (hasIncomingEdges || hasOutgoingEdges) {
          orphanCount++;
        }
      }
    }
    
    return orphanCount;
  }

  private countRiskEscalations(oldResult: PipelineResult, newResult: PipelineResult): number {
    let escalations = 0;
    
    for (const [nodeId, newNode] of newResult.nodes) {
      const oldNode = oldResult.nodes.get(nodeId);
      if (oldNode) {
        const oldRisk = oldNode.riskLevel || 'low';
        const newRisk = newNode.riskLevel || 'low';
        
        if (this.isRiskEscalation(oldRisk, newRisk)) {
          escalations++;
        }
      }
    }
    
    return escalations;
  }

  private isRiskEscalation(oldRisk: string, newRisk: string): boolean {
    const riskLevels = { low: 1, medium: 2, high: 3, critical: 4 };
    const oldLevel = riskLevels[oldRisk as keyof typeof riskLevels] || 1;
    const newLevel = riskLevels[newRisk as keyof typeof riskLevels] || 1;
    return newLevel > oldLevel;
  }

  private measureOutOfScopeGrowth(oldResult: PipelineResult, newResult: PipelineResult): number {
    const oldScopeSize = oldResult.metadata.scopeSize || 0;
    const newScopeSize = newResult.metadata.scopeSize || 0;
    
    if (oldScopeSize === 0) return 0;
    return Math.max(0, (newScopeSize - oldScopeSize) / oldScopeSize * 100);
  }

  private measureSemanticDrift(oldResult: PipelineResult, newResult: PipelineResult): number {
    let driftScore = 0;
    let comparedNodes = 0;
    
    for (const [nodeId, newNode] of newResult.nodes) {
      const oldNode = oldResult.nodes.get(nodeId);
      if (oldNode && oldNode.semanticHash && newNode.semanticHash) {
        if (oldNode.semanticHash !== newNode.semanticHash) {
          driftScore++;
        }
        comparedNodes++;
      }
    }
    
    return comparedNodes === 0 ? 0 : (driftScore / comparedNodes) * 100;
  }

  classifyUpgrade(metrics: ShadowMetrics): UpgradeDecision {
    const reasons: string[] = [];
    
    // Check for rejection criteria
    if (metrics.orphannodes > 0) {
      reasons.push(`${metrics.orphannodes} orphan nodes detected`);
    }
    
    if (metrics.nodechangepct > 25) {
      reasons.push(`Excessive node churn: ${metrics.nodechangepct.toFixed(2)}%`);
    }
    
    if (metrics.semanticstmt_drift > 15) {
      reasons.push(`Large semantic drift: ${metrics.semanticstmt_drift.toFixed(2)}%`);
    }
    
    if (reasons.length > 0) {
      const decision: UpgradeDecision = {
        classification: 'reject',
        metrics,
        reasons,
        canApply: false
      };
      this.emit('upgrade-classified', decision);
      return decision;
    }
    
    // Check for safe classification
    if (metrics.nodechangepct <= 3 && 
        metrics.orphannodes === 0 && 
        metrics.riskescalations === 0) {
      const decision: UpgradeDecision = {
        classification: 'safe',
        metrics,
        reasons: ['Low node change rate', 'No orphan nodes', 'No risk escalations'],
        canApply: true
      };
      this.emit('upgrade-classified', decision);
      return decision;
    }
    
    // Check for compaction event
    if (metrics.nodechangepct <= 25 && 
        metrics.orphannodes === 0 && 
        metrics.riskescalations <= 2) {
      const decision: UpgradeDecision = {
        classification: 'compaction',
        metrics,
        reasons: ['Moderate node changes', 'No orphan nodes', 'Limited risk escalations'],
        canApply: true
      };
      this.emit('upgrade-classified', decision);
      return decision;
    }
    
    // Default to rejection if no clear classification
    const decision: UpgradeDecision = {
      classification: 'reject',
      metrics,
      reasons: ['Does not meet safe or compaction criteria'],
      canApply: false
    };
    this.emit('upgrade-classified', decision);
    return decision;
  }

  acceptUpgrade(comparison: ShadowComparison): void {
    const comparisonId = this.generateComparisonId(comparison);
    
    if (this.acceptedUpgrades.has(comparisonId)) {
      throw new Error('Upgrade has already been accepted');
    }
    
    const decision = this.classifyUpgrade(comparison.metrics);
    if (!decision.canApply) {
      throw new Error(`Cannot accept upgrade classified as: ${decision.classification}`);
    }
    
    this.acceptedUpgrades.add(comparisonId);
    this.emit('upgrade-accepted', comparison);
  }

  private generateComparisonId(comparison: ShadowComparison): string {
    const content = JSON.stringify({
      timestamp: comparison.timestamp,
      metrics: comparison.metrics,
      oldNodeCount: comparison.oldResult.nodes.size,
      newNodeCount: comparison.newResult.nodes.size
    });
    
    // Simple hash function for ID generation
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return Math.abs(hash).toString(16);
  }
}

export function createShadowCanonicalizer(): ShadowCanonicalizer {
  return new ShadowCanonicalizerImpl();
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'b3c65ef5f97570cc447b02fc1c1203db4af0842c10c8bc5a04237e195ad2a74b',
  name: 'Shadow Canonicalization',
  risk_tier: 'high',
  canon_ids: [6 as const],
} as const;