export interface DependencyNode {
  readonly id: string;
  readonly type: 'module' | 'function' | 'class' | 'interface' | 'type';
  readonly sourceFile: string;
  readonly line: number;
  readonly column: number;
}

export interface DependencyEdge {
  readonly from: DependencyNode;
  readonly to: DependencyNode;
  readonly type: 'import' | 'call' | 'extends' | 'implements' | 'reference';
  readonly sourceFile: string;
  readonly line: number;
  readonly column: number;
}

export interface DependencyGraph {
  readonly nodes: ReadonlyMap<string, DependencyNode>;
  readonly edges: readonly DependencyEdge[];
}

export interface BoundaryPolicy {
  readonly allowedDependencies: readonly string[];
  readonly forbiddenDependencies: readonly string[];
  readonly sideChannelRestrictions: readonly string[];
}

export interface ImplementationUnit {
  readonly id: string;
  readonly name: string;
  readonly boundaryPolicy: BoundaryPolicy;
  readonly sourceFiles: readonly string[];
}

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  readonly type: 'boundary_violation' | 'side_channel_violation';
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly sourceFile: string;
  readonly line: number;
  readonly column: number;
  readonly violatingDependency: string;
  readonly implementationUnit: string;
}

export interface LinterConfig {
  readonly boundaryViolationSeverity: DiagnosticSeverity;
  readonly sideChannelViolationSeverity: DiagnosticSeverity;
}

export class ArchitecturalLinter {
  private readonly config: LinterConfig;

  constructor(config: LinterConfig) {
    this.config = config;
  }

  extractDependencyGraph(generatedCode: Map<string, string>): DependencyGraph {
    const nodes = new Map<string, DependencyNode>();
    const edges: DependencyEdge[] = [];

    for (const [filePath, content] of generatedCode) {
      this.parseFileForDependencies(filePath, content, nodes, edges);
    }

    return {
      nodes,
      edges
    };
  }

  private parseFileForDependencies(
    filePath: string,
    content: string,
    nodes: Map<string, DependencyNode>,
    edges: DependencyEdge[]
  ): void {
    const lines = content.split('\n');
    
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const lineNumber = lineIndex + 1;

      // Parse imports
      const importMatch = line.match(/^import\s+.*?\s+from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        const importPath = importMatch[1];
        const column = line.indexOf(importPath);
        
        const fromNode = this.getOrCreateNode(filePath, 'module', filePath, lineNumber, 0, nodes);
        const toNode = this.getOrCreateNode(importPath, 'module', importPath, 1, 0, nodes);
        
        edges.push({
          from: fromNode,
          to: toNode,
          type: 'import',
          sourceFile: filePath,
          line: lineNumber,
          column
        });
      }

      // Parse function calls
      const callMatches = line.matchAll(/(\w+)\s*\(/g);
      for (const match of callMatches) {
        const functionName = match[1];
        const column = match.index || 0;
        
        if (this.isExternalDependency(functionName)) {
          const fromNode = this.getOrCreateNode(filePath, 'module', filePath, lineNumber, 0, nodes);
          const toNode = this.getOrCreateNode(functionName, 'function', 'external', 1, 0, nodes);
          
          edges.push({
            from: fromNode,
            to: toNode,
            type: 'call',
            sourceFile: filePath,
            line: lineNumber,
            column
          });
        }
      }

      // Parse class extensions
      const extendsMatch = line.match(/class\s+\w+\s+extends\s+(\w+)/);
      if (extendsMatch) {
        const baseClass = extendsMatch[1];
        const column = line.indexOf(baseClass);
        
        const fromNode = this.getOrCreateNode(filePath, 'module', filePath, lineNumber, 0, nodes);
        const toNode = this.getOrCreateNode(baseClass, 'class', 'external', 1, 0, nodes);
        
        edges.push({
          from: fromNode,
          to: toNode,
          type: 'extends',
          sourceFile: filePath,
          line: lineNumber,
          column
        });
      }

      // Parse interface implementations
      const implementsMatch = line.match(/class\s+\w+\s+implements\s+(\w+)/);
      if (implementsMatch) {
        const interfaceName = implementsMatch[1];
        const column = line.indexOf(interfaceName);
        
        const fromNode = this.getOrCreateNode(filePath, 'module', filePath, lineNumber, 0, nodes);
        const toNode = this.getOrCreateNode(interfaceName, 'interface', 'external', 1, 0, nodes);
        
        edges.push({
          from: fromNode,
          to: toNode,
          type: 'implements',
          sourceFile: filePath,
          line: lineNumber,
          column
        });
      }
    }
  }

  private getOrCreateNode(
    id: string,
    type: DependencyNode['type'],
    sourceFile: string,
    line: number,
    column: number,
    nodes: Map<string, DependencyNode>
  ): DependencyNode {
    const existing = nodes.get(id);
    if (existing) {
      return existing;
    }

    const node: DependencyNode = {
      id,
      type,
      sourceFile,
      line,
      column
    };
    
    nodes.set(id, node);
    return node;
  }

  private isExternalDependency(name: string): boolean {
    return /^[A-Z]/.test(name) || name.includes('.');
  }

  validateDependencies(
    dependencyGraph: DependencyGraph,
    implementationUnit: ImplementationUnit
  ): readonly Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const edge of dependencyGraph.edges) {
      const violation = this.checkBoundaryViolation(edge, implementationUnit);
      if (violation) {
        diagnostics.push(violation);
      }

      const sideChannelViolation = this.checkSideChannelViolation(edge, implementationUnit);
      if (sideChannelViolation) {
        diagnostics.push(sideChannelViolation);
      }
    }

    return diagnostics;
  }

  private checkBoundaryViolation(
    edge: DependencyEdge,
    implementationUnit: ImplementationUnit
  ): Diagnostic | null {
    const targetId = edge.to.id;
    const policy = implementationUnit.boundaryPolicy;

    // Check if dependency is explicitly forbidden
    if (policy.forbiddenDependencies.includes(targetId)) {
      return {
        type: 'boundary_violation',
        severity: this.config.boundaryViolationSeverity,
        message: `Forbidden dependency on '${targetId}' detected`,
        sourceFile: edge.sourceFile,
        line: edge.line,
        column: edge.column,
        violatingDependency: targetId,
        implementationUnit: implementationUnit.id
      };
    }

    // Check if dependency is not in allowed list (if allowlist is non-empty)
    if (policy.allowedDependencies.length > 0 && !policy.allowedDependencies.includes(targetId)) {
      // Allow internal dependencies within the same implementation unit
      if (!this.isInternalDependency(targetId, implementationUnit)) {
        return {
          type: 'boundary_violation',
          severity: this.config.boundaryViolationSeverity,
          message: `Dependency on '${targetId}' not in allowed list`,
          sourceFile: edge.sourceFile,
          line: edge.line,
          column: edge.column,
          violatingDependency: targetId,
          implementationUnit: implementationUnit.id
        };
      }
    }

    return null;
  }

  private checkSideChannelViolation(
    edge: DependencyEdge,
    implementationUnit: ImplementationUnit
  ): Diagnostic | null {
    const targetId = edge.to.id;
    const policy = implementationUnit.boundaryPolicy;

    for (const restriction of policy.sideChannelRestrictions) {
      if (targetId.includes(restriction) || targetId.match(new RegExp(restriction))) {
        return {
          type: 'side_channel_violation',
          severity: this.config.sideChannelViolationSeverity,
          message: `Side-channel violation: dependency on '${targetId}' matches restriction '${restriction}'`,
          sourceFile: edge.sourceFile,
          line: edge.line,
          column: edge.column,
          violatingDependency: targetId,
          implementationUnit: implementationUnit.id
        };
      }
    }

    return null;
  }

  private isInternalDependency(targetId: string, implementationUnit: ImplementationUnit): boolean {
    return implementationUnit.sourceFiles.some(file => 
      targetId.startsWith(file) || targetId.includes(implementationUnit.name)
    );
  }

  lint(
    generatedCode: Map<string, string>,
    implementationUnit: ImplementationUnit
  ): readonly Diagnostic[] {
    const dependencyGraph = this.extractDependencyGraph(generatedCode);
    const diagnostics = this.validateDependencies(dependencyGraph, implementationUnit);

    // Invariant: Never silently ignore boundary violations
    const boundaryViolations = diagnostics.filter(d => d.type === 'boundary_violation');
    if (boundaryViolations.length > 0) {
      // Log or emit the violations - they must not be ignored
      for (const violation of boundaryViolations) {
        if (violation.severity === 'error') {
          throw new Error(`Boundary violation detected: ${violation.message} at ${violation.sourceFile}:${violation.line}:${violation.column}`);
        }
      }
    }

    return diagnostics;
  }
}

export function createArchitecturalLinter(config: LinterConfig): ArchitecturalLinter {
  return new ArchitecturalLinter(config);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'a1110ed578638325563de998e28b41d11e2c3057fb0b8e2a87ba55889e0607af',
  name: 'Architectural Linter',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;