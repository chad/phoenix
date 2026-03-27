import { createHash } from 'node:crypto';

export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface CanonicalNode {
  id: number;
  name: string;
  description: string;
}

export interface IUContract {
  canonical_nodes: readonly CanonicalNode[];
  implements: readonly number[];
}

export interface IUProposal {
  id: string;
  name: string;
  risk_tier: RiskTier;
  contract: IUContract;
  content_hash: string;
  proposed_by: 'bot' | 'human';
  proposed_at: Date;
  status: 'pending' | 'accepted' | 'rejected';
  accepted_by?: string;
  accepted_at?: Date;
}

export interface ImplementationUnit {
  id: string;
  name: string;
  risk_tier: RiskTier;
  contract: IUContract;
  content_hash: string;
  created_at: Date;
  created_by: string;
}

export function generateIUId(name: string, contract: IUContract, content: string): string {
  const contractData = JSON.stringify({
    name,
    implements: contract.implements.slice().sort(),
    canonical_nodes: contract.canonical_nodes.map(n => ({ id: n.id, name: n.name })).sort((a, b) => a.id - b.id)
  });
  
  const hash = createHash('sha256');
  hash.update(contractData);
  hash.update(content);
  return hash.digest('hex');
}

export function validateRiskTier(tier: string): tier is RiskTier {
  return ['low', 'medium', 'high', 'critical'].includes(tier);
}

export function validateContract(contract: IUContract): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!contract.canonical_nodes || contract.canonical_nodes.length === 0) {
    errors.push('Contract must declare at least one canonical node');
  }
  
  if (!contract.implements || contract.implements.length === 0) {
    errors.push('Contract must implement at least one canonical node ID');
  }
  
  const declaredIds = new Set(contract.canonical_nodes.map(n => n.id));
  const implementedIds = new Set(contract.implements);
  
  for (const implId of implementedIds) {
    if (!declaredIds.has(implId)) {
      errors.push(`Contract implements canonical node ${implId} but does not declare it`);
    }
  }
  
  const duplicateIds = contract.canonical_nodes
    .map(n => n.id)
    .filter((id, index, arr) => arr.indexOf(id) !== index);
  
  if (duplicateIds.length > 0) {
    errors.push(`Duplicate canonical node IDs: ${duplicateIds.join(', ')}`);
  }
  
  return { valid: errors.length === 0, errors };
}

export class IUManager {
  private units = new Map<string, ImplementationUnit>();
  private proposals = new Map<string, IUProposal>();
  
  proposeIU(
    name: string,
    riskTier: RiskTier,
    contract: IUContract,
    content: string,
    proposedBy: 'bot' | 'human' = 'bot'
  ): { success: boolean; proposal?: IUProposal; errors?: string[] } {
    const contractValidation = validateContract(contract);
    if (!contractValidation.valid) {
      return { success: false, errors: contractValidation.errors };
    }
    
    if (!validateRiskTier(riskTier)) {
      return { success: false, errors: ['Invalid risk tier'] };
    }
    
    const contentHash = createHash('sha256').update(content).digest('hex');
    const id = generateIUId(name, contract, content);
    
    const proposal: IUProposal = {
      id,
      name,
      risk_tier: riskTier,
      contract,
      content_hash: contentHash,
      proposed_by: proposedBy,
      proposed_at: new Date(),
      status: 'pending'
    };
    
    this.proposals.set(id, proposal);
    return { success: true, proposal };
  }
  
  acceptProposal(
    proposalId: string,
    acceptedBy: string
  ): { success: boolean; unit?: ImplementationUnit; errors?: string[] } {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      return { success: false, errors: ['Proposal not found'] };
    }
    
    if (proposal.status !== 'pending') {
      return { success: false, errors: ['Proposal is not pending'] };
    }
    
    if (proposal.proposed_by === 'bot' && !acceptedBy) {
      return { success: false, errors: ['Bot proposals require human or policy acceptance'] };
    }
    
    proposal.status = 'accepted';
    proposal.accepted_by = acceptedBy;
    proposal.accepted_at = new Date();
    
    const unit: ImplementationUnit = {
      id: proposal.id,
      name: proposal.name,
      risk_tier: proposal.risk_tier,
      contract: proposal.contract,
      content_hash: proposal.content_hash,
      created_at: proposal.accepted_at,
      created_by: acceptedBy
    };
    
    this.units.set(unit.id, unit);
    return { success: true, unit };
  }
  
  rejectProposal(proposalId: string): { success: boolean; errors?: string[] } {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      return { success: false, errors: ['Proposal not found'] };
    }
    
    if (proposal.status !== 'pending') {
      return { success: false, errors: ['Proposal is not pending'] };
    }
    
    proposal.status = 'rejected';
    return { success: true };
  }
  
  getUnit(id: string): ImplementationUnit | undefined {
    return this.units.get(id);
  }
  
  getProposal(id: string): IUProposal | undefined {
    return this.proposals.get(id);
  }
  
  listUnits(): ImplementationUnit[] {
    return Array.from(this.units.values());
  }
  
  listProposals(status?: IUProposal['status']): IUProposal[] {
    const proposals = Array.from(this.proposals.values());
    return status ? proposals.filter(p => p.status === status) : proposals;
  }
  
  findUnitsByCanonicalNode(canonicalNodeId: number): ImplementationUnit[] {
    return this.listUnits().filter(unit => 
      unit.contract.implements.includes(canonicalNodeId)
    );
  }
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '053d72d822014788abd21f50518ef2c02ae9a958bb653ca872ad5773d2bd260c',
  name: 'Implementation Unit Structure',
  risk_tier: 'medium',
  canon_ids: [5 as const],
} as const;