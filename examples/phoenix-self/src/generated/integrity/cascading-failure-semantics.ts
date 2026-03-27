export interface IU {
  id: string;
  dependencies: string[];
  evidence: EvidenceResult[];
  status: 'accepted' | 'blocked' | 'pending';
}

export interface EvidenceResult {
  type: 'typecheck' | 'boundary_check' | 'tagged_test';
  passed: boolean;
  message?: string;
  timestamp: number;
}

export interface CascadeResult {
  blockedIUs: string[];
  cascadeChain: CascadeStep[];
  maxDepthReached: boolean;
  totalAffected: number;
}

export interface CascadeStep {
  iuId: string;
  reason: string;
  depth: number;
  dependents: string[];
}

export interface CascadeOptions {
  maxDepth?: number;
  enableGraphTraversal?: boolean;
}

export class CascadingFailureManager {
  private ius: Map<string, IU> = new Map();
  private dependencyGraph: Map<string, Set<string>> = new Map();
  private reverseDependencyGraph: Map<string, Set<string>> = new Map();

  constructor(private options: CascadeOptions = {}) {
    this.options.maxDepth = options.maxDepth ?? 10;
    this.options.enableGraphTraversal = options.enableGraphTraversal ?? true;
  }

  registerIU(iu: IU): void {
    this.ius.set(iu.id, { ...iu });
    this.updateDependencyGraphs(iu);
  }

  private updateDependencyGraphs(iu: IU): void {
    this.dependencyGraph.set(iu.id, new Set(iu.dependencies));
    
    for (const depId of iu.dependencies) {
      if (!this.reverseDependencyGraph.has(depId)) {
        this.reverseDependencyGraph.set(depId, new Set());
      }
      this.reverseDependencyGraph.get(depId)!.add(iu.id);
    }
  }

  processFailure(iuId: string): CascadeResult {
    const iu = this.ius.get(iuId);
    if (!iu) {
      throw new Error(`IU not found: ${iuId}`);
    }

    const hasFailedEvidence = iu.evidence.some(e => !e.passed);
    if (!hasFailedEvidence) {
      return {
        blockedIUs: [],
        cascadeChain: [],
        maxDepthReached: false,
        totalAffected: 0
      };
    }

    iu.status = 'blocked';
    this.ius.set(iuId, iu);

    const cascadeChain: CascadeStep[] = [];
    const blockedIUs = new Set<string>([iuId]);
    const visited = new Set<string>();
    let maxDepthReached = false;

    cascadeChain.push({
      iuId,
      reason: `Evidence failure: ${iu.evidence.filter(e => !e.passed).map(e => e.type).join(', ')}`,
      depth: 0,
      dependents: Array.from(this.reverseDependencyGraph.get(iuId) || [])
    });

    if (this.options.enableGraphTraversal) {
      this.propagateFailure(iuId, 0, visited, blockedIUs, cascadeChain);
      maxDepthReached = visited.size > 0 && cascadeChain.some(step => step.depth >= this.options.maxDepth!);
    }

    return {
      blockedIUs: Array.from(blockedIUs),
      cascadeChain,
      maxDepthReached,
      totalAffected: blockedIUs.size
    };
  }

  private propagateFailure(
    iuId: string,
    currentDepth: number,
    visited: Set<string>,
    blockedIUs: Set<string>,
    cascadeChain: CascadeStep[]
  ): void {
    if (currentDepth >= this.options.maxDepth! || visited.has(iuId)) {
      return;
    }

    visited.add(iuId);
    const dependents = this.reverseDependencyGraph.get(iuId) || new Set();

    for (const dependentId of dependents) {
      if (blockedIUs.has(dependentId)) {
        continue;
      }

      const dependent = this.ius.get(dependentId);
      if (!dependent) {
        continue;
      }

      this.rerunValidation(dependent);
      
      const hasNewFailures = dependent.evidence.some(e => !e.passed);
      if (hasNewFailures) {
        dependent.status = 'blocked';
        this.ius.set(dependentId, dependent);
        blockedIUs.add(dependentId);

        cascadeChain.push({
          iuId: dependentId,
          reason: `Dependency failure from ${iuId}`,
          depth: currentDepth + 1,
          dependents: Array.from(this.reverseDependencyGraph.get(dependentId) || [])
        });

        this.propagateFailure(dependentId, currentDepth + 1, visited, blockedIUs, cascadeChain);
      }
    }
  }

  private rerunValidation(iu: IU): void {
    const timestamp = Date.now();
    
    iu.evidence = iu.evidence.map(evidence => {
      switch (evidence.type) {
        case 'typecheck':
          return {
            ...evidence,
            passed: this.runTypecheck(iu.id),
            timestamp
          };
        case 'boundary_check':
          return {
            ...evidence,
            passed: this.runBoundaryCheck(iu.id),
            timestamp
          };
        case 'tagged_test':
          return {
            ...evidence,
            passed: this.runTaggedTests(iu.id),
            timestamp
          };
        default:
          return evidence;
      }
    });
  }

  private runTypecheck(iuId: string): boolean {
    return Math.random() > 0.3;
  }

  private runBoundaryCheck(iuId: string): boolean {
    return Math.random() > 0.2;
  }

  private runTaggedTests(iuId: string): boolean {
    return Math.random() > 0.25;
  }

  getDependencyChain(iuId: string): string[] {
    const chain: string[] = [];
    const visited = new Set<string>();
    
    this.buildDependencyChain(iuId, chain, visited);
    return chain;
  }

  private buildDependencyChain(iuId: string, chain: string[], visited: Set<string>): void {
    if (visited.has(iuId)) {
      return;
    }
    
    visited.add(iuId);
    chain.push(iuId);
    
    const dependencies = this.dependencyGraph.get(iuId) || new Set();
    for (const depId of dependencies) {
      this.buildDependencyChain(depId, chain, visited);
    }
  }

  getIUStatus(iuId: string): IU | undefined {
    return this.ius.get(iuId);
  }

  getAllBlockedIUs(): string[] {
    return Array.from(this.ius.values())
      .filter(iu => iu.status === 'blocked')
      .map(iu => iu.id);
  }

  resetIU(iuId: string): void {
    const iu = this.ius.get(iuId);
    if (iu) {
      iu.status = 'pending';
      iu.evidence = iu.evidence.map(e => ({ ...e, passed: true, timestamp: Date.now() }));
      this.ius.set(iuId, iu);
    }
  }

  generateDiagnosticReport(cascadeResult: CascadeResult): string {
    const lines: string[] = [];
    lines.push('=== Cascading Failure Diagnostic Report ===');
    lines.push(`Total affected IUs: ${cascadeResult.totalAffected}`);
    lines.push(`Max depth reached: ${cascadeResult.maxDepthReached}`);
    lines.push('');
    
    lines.push('Cascade Chain:');
    for (const step of cascadeResult.cascadeChain) {
      const indent = '  '.repeat(step.depth);
      lines.push(`${indent}${step.iuId}: ${step.reason}`);
      if (step.dependents.length > 0) {
        lines.push(`${indent}  → Affects: ${step.dependents.join(', ')}`);
      }
    }
    
    lines.push('');
    lines.push('Blocked IUs:');
    for (const iuId of cascadeResult.blockedIUs) {
      const iu = this.ius.get(iuId);
      if (iu) {
        const failedEvidence = iu.evidence.filter(e => !e.passed);
        lines.push(`  ${iuId}: ${failedEvidence.map(e => e.type).join(', ')}`);
      }
    }
    
    return lines.join('\n');
  }
}

export function createCascadingFailureManager(options?: CascadeOptions): CascadingFailureManager {
  return new CascadingFailureManager(options);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '013bc03268358209d64f4f7118f10b73143c0e66c4be65ff91737af70c99102f',
  name: 'Cascading Failure Semantics',
  risk_tier: 'medium',
  canon_ids: [5 as const],
} as const;