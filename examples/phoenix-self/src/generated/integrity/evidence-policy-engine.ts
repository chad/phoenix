import { createHash } from 'node:crypto';

export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface EvidenceArtifact {
  id: string;
  type: EvidenceType;
  hash: string;
  canonicalNodeIds: readonly number[];
  iuIds: readonly string[];
  timestamp: number;
  metadata: Record<string, unknown>;
}

export type EvidenceType = 
  | 'typecheck'
  | 'lint' 
  | 'boundary_validation'
  | 'unit_test'
  | 'property_test'
  | 'threat_note'
  | 'static_analysis'
  | 'human_signoff'
  | 'formal_verification';

export interface PolicyRequirement {
  tier: RiskTier;
  requiredEvidence: readonly EvidenceType[];
  description: string;
}

export interface EvidenceBinding {
  artifactId: string;
  canonicalNodeId: number;
  iuId: string;
  artifactHash: string;
  bindingHash: string;
}

export interface PolicyViolation {
  iuId: string;
  tier: RiskTier;
  missingEvidence: readonly EvidenceType[];
  message: string;
}

export class EvidencePolicyEngine {
  private readonly policies: Map<RiskTier, PolicyRequirement> = new Map();
  private readonly evidence: Map<string, EvidenceArtifact> = new Map();
  private readonly bindings: Map<string, EvidenceBinding[]> = new Map();

  constructor() {
    this.initializePolicies();
  }

  private initializePolicies(): void {
    this.policies.set('low', {
      tier: 'low',
      requiredEvidence: ['typecheck', 'lint', 'boundary_validation'],
      description: 'Basic validation requirements for low-risk IUs'
    });

    this.policies.set('medium', {
      tier: 'medium', 
      requiredEvidence: ['typecheck', 'lint', 'boundary_validation', 'unit_test'],
      description: 'Enhanced validation with unit testing for medium-risk IUs'
    });

    this.policies.set('high', {
      tier: 'high',
      requiredEvidence: ['typecheck', 'lint', 'boundary_validation', 'unit_test', 'property_test', 'threat_note', 'static_analysis'],
      description: 'Comprehensive validation for high-risk IUs'
    });

    this.policies.set('critical', {
      tier: 'critical',
      requiredEvidence: ['typecheck', 'lint', 'boundary_validation', 'unit_test', 'property_test', 'threat_note', 'static_analysis', 'human_signoff'],
      description: 'Maximum validation with human oversight for critical IUs'
    });
  }

  public registerEvidence(
    type: EvidenceType,
    canonicalNodeIds: readonly number[],
    iuIds: readonly string[],
    artifactData: Buffer | string,
    metadata: Record<string, unknown> = {}
  ): EvidenceArtifact {
    const hash = this.computeHash(artifactData);
    const id = this.generateEvidenceId(type, hash);
    
    const artifact: EvidenceArtifact = {
      id,
      type,
      hash,
      canonicalNodeIds,
      iuIds,
      timestamp: Date.now(),
      metadata
    };

    this.evidence.set(id, artifact);
    this.createBindings(artifact);
    
    return artifact;
  }

  private createBindings(artifact: EvidenceArtifact): void {
    for (const canonicalNodeId of artifact.canonicalNodeIds) {
      for (const iuId of artifact.iuIds) {
        const binding: EvidenceBinding = {
          artifactId: artifact.id,
          canonicalNodeId,
          iuId,
          artifactHash: artifact.hash,
          bindingHash: this.computeBindingHash(artifact.id, canonicalNodeId, iuId, artifact.hash)
        };

        const key = `${canonicalNodeId}:${iuId}`;
        const existing = this.bindings.get(key) || [];
        existing.push(binding);
        this.bindings.set(key, existing);
      }
    }
  }

  public validateCompliance(iuId: string, tier: RiskTier, canonicalNodeId: number): PolicyViolation | null {
    const policy = this.policies.get(tier);
    if (!policy) {
      throw new Error(`Unknown risk tier: ${tier}`);
    }

    const bindingKey = `${canonicalNodeId}:${iuId}`;
    const bindings = this.bindings.get(bindingKey) || [];
    
    const availableEvidence = new Set<EvidenceType>();
    for (const binding of bindings) {
      const artifact = this.evidence.get(binding.artifactId);
      if (artifact && this.verifyBindingIntegrity(binding, artifact)) {
        availableEvidence.add(artifact.type);
      }
    }

    const missingEvidence = policy.requiredEvidence.filter(
      required => !availableEvidence.has(required)
    );

    if (missingEvidence.length > 0) {
      return {
        iuId,
        tier,
        missingEvidence,
        message: `IU ${iuId} (tier: ${tier}) missing required evidence: ${missingEvidence.join(', ')}`
      };
    }

    return null;
  }

  public getEvidenceForIU(iuId: string, canonicalNodeId: number): EvidenceArtifact[] {
    const bindingKey = `${canonicalNodeId}:${iuId}`;
    const bindings = this.bindings.get(bindingKey) || [];
    
    const artifacts: EvidenceArtifact[] = [];
    for (const binding of bindings) {
      const artifact = this.evidence.get(binding.artifactId);
      if (artifact && this.verifyBindingIntegrity(binding, artifact)) {
        artifacts.push(artifact);
      }
    }
    
    return artifacts;
  }

  public verifyEvidenceIntegrity(artifactId: string): boolean {
    const artifact = this.evidence.get(artifactId);
    if (!artifact) {
      return false;
    }

    // Verify all bindings for this artifact
    for (const canonicalNodeId of artifact.canonicalNodeIds) {
      for (const iuId of artifact.iuIds) {
        const bindingKey = `${canonicalNodeId}:${iuId}`;
        const bindings = this.bindings.get(bindingKey) || [];
        
        const relevantBinding = bindings.find(b => b.artifactId === artifactId);
        if (!relevantBinding || !this.verifyBindingIntegrity(relevantBinding, artifact)) {
          return false;
        }
      }
    }

    return true;
  }

  private verifyBindingIntegrity(binding: EvidenceBinding, artifact: EvidenceArtifact): boolean {
    const expectedBindingHash = this.computeBindingHash(
      binding.artifactId,
      binding.canonicalNodeId,
      binding.iuId,
      artifact.hash
    );
    
    return binding.bindingHash === expectedBindingHash && 
           binding.artifactHash === artifact.hash;
  }

  public getPolicyRequirements(tier: RiskTier): PolicyRequirement | undefined {
    return this.policies.get(tier);
  }

  public getAllViolations(iuRiskMap: Map<string, { tier: RiskTier; canonicalNodeId: number }>): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    
    for (const [iuId, { tier, canonicalNodeId }] of iuRiskMap) {
      const violation = this.validateCompliance(iuId, tier, canonicalNodeId);
      if (violation) {
        violations.push(violation);
      }
    }
    
    return violations;
  }

  private computeHash(data: Buffer | string): string {
    const hash = createHash('sha256');
    hash.update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
    return hash.digest('hex');
  }

  private computeBindingHash(artifactId: string, canonicalNodeId: number, iuId: string, artifactHash: string): string {
    const bindingData = `${artifactId}:${canonicalNodeId}:${iuId}:${artifactHash}`;
    return this.computeHash(bindingData);
  }

  private generateEvidenceId(type: EvidenceType, hash: string): string {
    return `${type}:${hash.substring(0, 16)}`;
  }
}

export function createEvidencePolicyEngine(): EvidencePolicyEngine {
  return new EvidencePolicyEngine();
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '25935e2381b201043b8640652695a01b23e945937ad9b74df62bd1a7f3e3f312',
  name: 'Evidence & Policy Engine',
  risk_tier: 'high',
  canon_ids: [8 as const],
} as const;