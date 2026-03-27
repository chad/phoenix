import { EventEmitter } from 'node:events';

export interface BoundarySpec {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly entryPoints: readonly string[];
  readonly exitPoints: readonly string[];
  readonly evidenceRequirements: readonly EvidenceRequirement[];
}

export interface EvidenceRequirement {
  readonly type: 'test_coverage' | 'documentation' | 'type_safety' | 'performance' | 'security';
  readonly threshold: number;
  readonly description: string;
}

export interface FunctionMapping {
  readonly functionName: string;
  readonly requirementId: string;
  readonly confidence: number;
  readonly mappedAt: Date;
  readonly mappedBy: string;
}

export interface IUStatus {
  readonly id: string;
  readonly type: 'fully_regenerated' | 'boundary_wrapped' | 'unmapped';
  readonly boundarySpec?: BoundarySpec;
  readonly mappings: readonly FunctionMapping[];
  readonly evidenceStatus: EvidenceStatus;
  readonly lastUpdated: Date;
}

export interface EvidenceStatus {
  readonly requirements: ReadonlyMap<string, EvidenceResult>;
  readonly overallCompliance: number;
}

export interface EvidenceResult {
  readonly requirement: EvidenceRequirement;
  readonly currentValue: number;
  readonly compliant: boolean;
  readonly lastChecked: Date;
}

export interface WrappingPolicy {
  readonly minEvidenceThreshold: number;
  readonly requiredEvidenceTypes: readonly EvidenceRequirement['type'][];
  readonly allowPartialCompliance: boolean;
}

export class BrownfieldWrapper extends EventEmitter {
  private readonly boundaries = new Map<string, BoundarySpec>();
  private readonly iuStatuses = new Map<string, IUStatus>();
  private readonly functionMappings = new Map<string, FunctionMapping[]>();
  private readonly policy: WrappingPolicy;

  constructor(policy: WrappingPolicy) {
    super();
    this.policy = policy;
  }

  defineBoundary(spec: BoundarySpec): void {
    if (!spec.id || !spec.name || spec.entryPoints.length === 0) {
      throw new Error('Invalid boundary spec: id, name, and entryPoints are required');
    }

    if (spec.evidenceRequirements.some(req => req.threshold < 0 || req.threshold > 100)) {
      throw new Error('Evidence requirement thresholds must be between 0 and 100');
    }

    this.boundaries.set(spec.id, spec);
    
    const existingStatus = this.iuStatuses.get(spec.id);
    const newStatus: IUStatus = {
      id: spec.id,
      type: 'boundary_wrapped',
      boundarySpec: spec,
      mappings: existingStatus?.mappings || [],
      evidenceStatus: this.calculateEvidenceStatus(spec, existingStatus?.mappings || []),
      lastUpdated: new Date()
    };

    this.iuStatuses.set(spec.id, newStatus);
    this.emit('boundaryDefined', { boundaryId: spec.id, spec });
  }

  mapFunctionToRequirement(
    boundaryId: string,
    functionName: string,
    requirementId: string,
    confidence: number,
    mappedBy: string
  ): void {
    if (!this.boundaries.has(boundaryId)) {
      throw new Error(`Boundary ${boundaryId} not found`);
    }

    if (confidence < 0 || confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }

    const mapping: FunctionMapping = {
      functionName,
      requirementId,
      confidence,
      mappedAt: new Date(),
      mappedBy
    };

    const existingMappings = this.functionMappings.get(boundaryId) || [];
    const updatedMappings = [
      ...existingMappings.filter(m => m.functionName !== functionName),
      mapping
    ];

    this.functionMappings.set(boundaryId, updatedMappings);

    const boundary = this.boundaries.get(boundaryId)!;
    const updatedStatus: IUStatus = {
      ...this.iuStatuses.get(boundaryId)!,
      mappings: updatedMappings,
      evidenceStatus: this.calculateEvidenceStatus(boundary, updatedMappings),
      lastUpdated: new Date()
    };

    this.iuStatuses.set(boundaryId, updatedStatus);
    this.emit('functionMapped', { boundaryId, mapping });
  }

  expandRegenerationSurface(boundaryId: string, additionalEntryPoints: readonly string[]): void {
    const boundary = this.boundaries.get(boundaryId);
    if (!boundary) {
      throw new Error(`Boundary ${boundaryId} not found`);
    }

    const expandedSpec: BoundarySpec = {
      ...boundary,
      entryPoints: [...boundary.entryPoints, ...additionalEntryPoints]
    };

    this.boundaries.set(boundaryId, expandedSpec);

    const status = this.iuStatuses.get(boundaryId)!;
    const updatedStatus: IUStatus = {
      ...status,
      boundarySpec: expandedSpec,
      evidenceStatus: this.calculateEvidenceStatus(expandedSpec, status.mappings),
      lastUpdated: new Date()
    };

    this.iuStatuses.set(boundaryId, updatedStatus);
    this.emit('surfaceExpanded', { boundaryId, additionalEntryPoints });
  }

  markAsFullyRegenerated(boundaryId: string): void {
    const status = this.iuStatuses.get(boundaryId);
    if (!status) {
      throw new Error(`IU ${boundaryId} not found`);
    }

    const updatedStatus: IUStatus = {
      ...status,
      type: 'fully_regenerated',
      lastUpdated: new Date()
    };

    this.iuStatuses.set(boundaryId, updatedStatus);
    this.emit('fullyRegenerated', { boundaryId });
  }

  validateBoundaryCompliance(boundaryId: string): boolean {
    const status = this.iuStatuses.get(boundaryId);
    if (!status || !status.boundarySpec) {
      return false;
    }

    const { evidenceStatus } = status;
    
    if (evidenceStatus.overallCompliance < this.policy.minEvidenceThreshold) {
      return false;
    }

    const hasRequiredTypes = this.policy.requiredEvidenceTypes.every(type =>
      Array.from(evidenceStatus.requirements.values()).some(result =>
        result.requirement.type === type && 
        (result.compliant || this.policy.allowPartialCompliance)
      )
    );

    return hasRequiredTypes;
  }

  getBoundaryStatus(boundaryId: string): IUStatus | undefined {
    return this.iuStatuses.get(boundaryId);
  }

  getAllBoundaries(): readonly BoundarySpec[] {
    return Array.from(this.boundaries.values());
  }

  getRegenerationSummary(): {
    fullyRegenerated: number;
    boundaryWrapped: number;
    unmapped: number;
    totalCompliant: number;
  } {
    const statuses = Array.from(this.iuStatuses.values());
    
    return {
      fullyRegenerated: statuses.filter(s => s.type === 'fully_regenerated').length,
      boundaryWrapped: statuses.filter(s => s.type === 'boundary_wrapped').length,
      unmapped: statuses.filter(s => s.type === 'unmapped').length,
      totalCompliant: statuses.filter(s => this.validateBoundaryCompliance(s.id)).length
    };
  }

  private calculateEvidenceStatus(
    boundary: BoundarySpec,
    mappings: readonly FunctionMapping[]
  ): EvidenceStatus {
    const requirements = new Map<string, EvidenceResult>();
    
    for (const requirement of boundary.evidenceRequirements) {
      const currentValue = this.calculateEvidenceValue(requirement, mappings);
      const result: EvidenceResult = {
        requirement,
        currentValue,
        compliant: currentValue >= requirement.threshold,
        lastChecked: new Date()
      };
      requirements.set(requirement.type, result);
    }

    const compliantCount = Array.from(requirements.values()).filter(r => r.compliant).length;
    const overallCompliance = boundary.evidenceRequirements.length > 0
      ? (compliantCount / boundary.evidenceRequirements.length) * 100
      : 0;

    return { requirements, overallCompliance };
  }

  private calculateEvidenceValue(
    requirement: EvidenceRequirement,
    mappings: readonly FunctionMapping[]
  ): number {
    switch (requirement.type) {
      case 'test_coverage':
        return mappings.length > 0 ? Math.min(mappings.length * 20, 100) : 0;
      case 'documentation':
        return mappings.filter(m => m.confidence > 0.8).length * 25;
      case 'type_safety':
        return mappings.length > 0 ? 85 : 0;
      case 'performance':
        return mappings.length > 0 ? 75 : 0;
      case 'security':
        return mappings.filter(m => m.confidence > 0.9).length * 30;
      default:
        return 0;
    }
  }
}

export function createBrownfieldWrapper(policy?: Partial<WrappingPolicy>): BrownfieldWrapper {
  const defaultPolicy: WrappingPolicy = {
    minEvidenceThreshold: 70,
    requiredEvidenceTypes: ['test_coverage', 'type_safety'],
    allowPartialCompliance: true
  };

  return new BrownfieldWrapper({ ...defaultPolicy, ...policy });
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '81b0f4c9a550b28ee83a44a3280d37b42ddadbcee0376fdc2e15b013964a89ff',
  name: 'Brownfield Progressive Wrapping',
  risk_tier: 'high',
  canon_ids: [4 as const],
} as const;