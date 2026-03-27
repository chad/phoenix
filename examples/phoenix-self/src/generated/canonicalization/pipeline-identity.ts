import { createHash } from 'node:crypto';

export interface PipelineIdentity {
  canonpipelineid: string;
  modelid: string;
  promptpackversion: string;
  extractionrulesversion: string;
  diffpolicyversion: string;
}

export interface PipelineUpgradeNode {
  type: 'pipelineupgrade';
  id: string;
  timestamp: string;
  fromPipeline: PipelineIdentity;
  toPipeline: PipelineIdentity;
  upgradeReason: string;
  metadata: Record<string, unknown>;
}

export interface ProvenanceGraph {
  addNode(node: PipelineUpgradeNode): void;
  getNode(id: string): PipelineUpgradeNode | undefined;
  getUpgradeHistory(pipelineId: string): PipelineUpgradeNode[];
}

export class PipelineIdentityManager {
  private currentPipeline: PipelineIdentity | null = null;
  private provenanceGraph: ProvenanceGraph;
  private upgradeHistory: Map<string, PipelineUpgradeNode[]> = new Map();

  constructor(provenanceGraph: ProvenanceGraph) {
    this.provenanceGraph = provenanceGraph;
  }

  public createPipelineIdentity(
    modelid: string,
    promptpackversion: string,
    extractionrulesversion: string,
    diffpolicyversion: string
  ): PipelineIdentity {
    const canonpipelineid = this.generateCanonPipelineId(
      modelid,
      promptpackversion,
      extractionrulesversion,
      diffpolicyversion
    );

    return {
      canonpipelineid,
      modelid,
      promptpackversion,
      extractionrulesversion,
      diffpolicyversion,
    };
  }

  public setPipeline(pipeline: PipelineIdentity): void {
    if (this.currentPipeline && !this.isPipelineEqual(this.currentPipeline, pipeline)) {
      this.recordPipelineUpgrade(this.currentPipeline, pipeline, 'Explicit pipeline change');
    }
    this.currentPipeline = pipeline;
  }

  public getCurrentPipeline(): PipelineIdentity | null {
    return this.currentPipeline;
  }

  public upgradePipeline(
    newPipeline: PipelineIdentity,
    reason: string,
    metadata: Record<string, unknown> = {}
  ): void {
    if (!this.currentPipeline) {
      throw new Error('Cannot upgrade pipeline: no current pipeline set');
    }

    if (this.isPipelineEqual(this.currentPipeline, newPipeline)) {
      throw new Error('Cannot upgrade to identical pipeline version');
    }

    this.recordPipelineUpgrade(this.currentPipeline, newPipeline, reason, metadata);
    this.currentPipeline = newPipeline;
  }

  public validatePipelineUpgrade(
    fromPipeline: PipelineIdentity,
    toPipeline: PipelineIdentity
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (this.isPipelineEqual(fromPipeline, toPipeline)) {
      errors.push('Source and target pipelines are identical');
    }

    if (!this.isValidPipelineIdentity(fromPipeline)) {
      errors.push('Invalid source pipeline identity');
    }

    if (!this.isValidPipelineIdentity(toPipeline)) {
      errors.push('Invalid target pipeline identity');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  public getUpgradeHistory(pipelineId?: string): PipelineUpgradeNode[] {
    if (pipelineId) {
      return this.upgradeHistory.get(pipelineId) || [];
    }

    const allHistory: PipelineUpgradeNode[] = [];
    for (const history of this.upgradeHistory.values()) {
      allHistory.push(...history);
    }

    return allHistory.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  private generateCanonPipelineId(
    modelid: string,
    promptpackversion: string,
    extractionrulesversion: string,
    diffpolicyversion: string
  ): string {
    const components = [modelid, promptpackversion, extractionrulesversion, diffpolicyversion];
    const hash = createHash('sha256');
    hash.update(components.join('|'));
    return hash.digest('hex');
  }

  private isPipelineEqual(a: PipelineIdentity, b: PipelineIdentity): boolean {
    return (
      a.canonpipelineid === b.canonpipelineid &&
      a.modelid === b.modelid &&
      a.promptpackversion === b.promptpackversion &&
      a.extractionrulesversion === b.extractionrulesversion &&
      a.diffpolicyversion === b.diffpolicyversion
    );
  }

  private isValidPipelineIdentity(pipeline: PipelineIdentity): boolean {
    return !!(
      pipeline.canonpipelineid &&
      pipeline.modelid &&
      pipeline.promptpackversion &&
      pipeline.extractionrulesversion &&
      pipeline.diffpolicyversion
    );
  }

  private recordPipelineUpgrade(
    fromPipeline: PipelineIdentity,
    toPipeline: PipelineIdentity,
    reason: string,
    metadata: Record<string, unknown> = {}
  ): void {
    const upgradeNode: PipelineUpgradeNode = {
      type: 'pipelineupgrade',
      id: this.generateUpgradeId(fromPipeline, toPipeline),
      timestamp: new Date().toISOString(),
      fromPipeline,
      toPipeline,
      upgradeReason: reason,
      metadata,
    };

    this.provenanceGraph.addNode(upgradeNode);

    // Track in local history
    const fromHistory = this.upgradeHistory.get(fromPipeline.canonpipelineid) || [];
    fromHistory.push(upgradeNode);
    this.upgradeHistory.set(fromPipeline.canonpipelineid, fromHistory);

    const toHistory = this.upgradeHistory.get(toPipeline.canonpipelineid) || [];
    toHistory.push(upgradeNode);
    this.upgradeHistory.set(toPipeline.canonpipelineid, toHistory);
  }

  private generateUpgradeId(from: PipelineIdentity, to: PipelineIdentity): string {
    const hash = createHash('sha256');
    hash.update(`${from.canonpipelineid}->${to.canonpipelineid}-${Date.now()}`);
    return hash.digest('hex');
  }
}

export function createPipelineIdentity(
  modelid: string,
  promptpackversion: string,
  extractionrulesversion: string,
  diffpolicyversion: string
): PipelineIdentity {
  const hash = createHash('sha256');
  hash.update([modelid, promptpackversion, extractionrulesversion, diffpolicyversion].join('|'));
  const canonpipelineid = hash.digest('hex');

  return {
    canonpipelineid,
    modelid,
    promptpackversion,
    extractionrulesversion,
    diffpolicyversion,
  };
}

export function comparePipelineIdentities(a: PipelineIdentity, b: PipelineIdentity): boolean {
  return (
    a.canonpipelineid === b.canonpipelineid &&
    a.modelid === b.modelid &&
    a.promptpackversion === b.promptpackversion &&
    a.extractionrulesversion === b.extractionrulesversion &&
    a.diffpolicyversion === b.diffpolicyversion
  );
}

export function validatePipelineIdentity(pipeline: PipelineIdentity): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!pipeline.canonpipelineid) {
    errors.push('canonpipelineid is required');
  }

  if (!pipeline.modelid) {
    errors.push('modelid is required');
  }

  if (!pipeline.promptpackversion) {
    errors.push('promptpackversion is required');
  }

  if (!pipeline.extractionrulesversion) {
    errors.push('extractionrulesversion is required');
  }

  if (!pipeline.diffpolicyversion) {
    errors.push('diffpolicyversion is required');
  }

  // Validate canonpipelineid matches computed hash
  if (pipeline.canonpipelineid && pipeline.modelid && pipeline.promptpackversion && 
      pipeline.extractionrulesversion && pipeline.diffpolicyversion) {
    const expectedId = createPipelineIdentity(
      pipeline.modelid,
      pipeline.promptpackversion,
      pipeline.extractionrulesversion,
      pipeline.diffpolicyversion
    ).canonpipelineid;

    if (pipeline.canonpipelineid !== expectedId) {
      errors.push('canonpipelineid does not match computed hash');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '736ad84d7671ed925c1e4bd58cd988bf6746c8e189baef37de1a22b0122e2ab8',
  name: 'Pipeline Identity',
  risk_tier: 'high',
  canon_ids: [4 as const],
} as const;