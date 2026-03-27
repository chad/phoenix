import { createHash } from 'node:crypto';

export interface Clause {
  id: string;
  normalizedText: string;
  sectionPath: string[];
}

export interface ClauseWithNeighbors extends Clause {
  neighborHashes: string[];
}

export interface GraphEdge {
  type: 'relates_to' | 'depends_on' | 'conflicts_with' | 'references';
  strength: 'weak' | 'strong';
  sourceId: string;
  targetId: string;
}

export interface CanonicalGraphContext {
  edges: GraphEdge[];
  nodeIds: string[];
}

export interface SemanticHashes {
  clause_semhash: string;
  contextsemhashcold: string;
  contextsemhashwarm?: string;
}

export class SemanticHasher {
  private readonly hashCache = new Map<string, string>();

  computeClauseSemhash(normalizedText: string): string {
    const cacheKey = `clause:${normalizedText}`;
    
    if (this.hashCache.has(cacheKey)) {
      return this.hashCache.get(cacheKey)!;
    }

    const hash = createHash('sha256')
      .update(normalizedText, 'utf8')
      .digest('hex');

    this.hashCache.set(cacheKey, hash);
    return hash;
  }

  computeContextSemhashCold(clause: ClauseWithNeighbors): string {
    const sectionPathStr = clause.sectionPath.join('/');
    const neighborHashesStr = clause.neighborHashes.sort().join('|');
    
    const contextInput = [
      clause.normalizedText,
      sectionPathStr,
      neighborHashesStr
    ].join('::');

    const cacheKey = `cold:${contextInput}`;
    
    if (this.hashCache.has(cacheKey)) {
      return this.hashCache.get(cacheKey)!;
    }

    const hash = createHash('sha256')
      .update(contextInput, 'utf8')
      .digest('hex');

    this.hashCache.set(cacheKey, hash);
    return hash;
  }

  computeContextSemhashWarm(
    clause: ClauseWithNeighbors,
    canonicalContext: CanonicalGraphContext
  ): string {
    // Filter out weak 'relates_to' edges to prevent incidental invalidation
    const relevantEdges = canonicalContext.edges.filter(edge => 
      !(edge.type === 'relates_to' && edge.strength === 'weak')
    );

    // Sort edges for deterministic hashing
    const sortedEdges = relevantEdges
      .sort((a, b) => {
        const aKey = `${a.sourceId}:${a.targetId}:${a.type}:${a.strength}`;
        const bKey = `${b.sourceId}:${b.targetId}:${b.type}:${b.strength}`;
        return aKey.localeCompare(bKey);
      });

    const edgesStr = sortedEdges
      .map(edge => `${edge.sourceId}->${edge.targetId}:${edge.type}:${edge.strength}`)
      .join('|');

    const nodeIdsStr = canonicalContext.nodeIds.sort().join(',');
    const sectionPathStr = clause.sectionPath.join('/');
    const neighborHashesStr = clause.neighborHashes.sort().join('|');

    const warmInput = [
      clause.normalizedText,
      sectionPathStr,
      neighborHashesStr,
      edgesStr,
      nodeIdsStr
    ].join('::');

    const cacheKey = `warm:${warmInput}`;
    
    if (this.hashCache.has(cacheKey)) {
      return this.hashCache.get(cacheKey)!;
    }

    const hash = createHash('sha256')
      .update(warmInput, 'utf8')
      .digest('hex');

    this.hashCache.set(cacheKey, hash);
    return hash;
  }

  computeAllHashes(
    clause: ClauseWithNeighbors,
    canonicalContext?: CanonicalGraphContext
  ): SemanticHashes {
    const clause_semhash = this.computeClauseSemhash(clause.normalizedText);
    const contextsemhashcold = this.computeContextSemhashCold(clause);
    
    const result: SemanticHashes = {
      clause_semhash,
      contextsemhashcold
    };

    if (canonicalContext) {
      result.contextsemhashwarm = this.computeContextSemhashWarm(clause, canonicalContext);
    }

    return result;
  }

  clearCache(): void {
    this.hashCache.clear();
  }

  getCacheSize(): number {
    return this.hashCache.size;
  }
}

export function createSemanticHasher(): SemanticHasher {
  return new SemanticHasher();
}

export function computeClauseSemhash(normalizedText: string): string {
  return createHash('sha256')
    .update(normalizedText, 'utf8')
    .digest('hex');
}

export function computeContextSemhashCold(clause: ClauseWithNeighbors): string {
  const sectionPathStr = clause.sectionPath.join('/');
  const neighborHashesStr = clause.neighborHashes.sort().join('|');
  
  const contextInput = [
    clause.normalizedText,
    sectionPathStr,
    neighborHashesStr
  ].join('::');

  return createHash('sha256')
    .update(contextInput, 'utf8')
    .digest('hex');
}

export function computeContextSemhashWarm(
  clause: ClauseWithNeighbors,
  canonicalContext: CanonicalGraphContext
): string {
  const relevantEdges = canonicalContext.edges.filter(edge => 
    !(edge.type === 'relates_to' && edge.strength === 'weak')
  );

  const sortedEdges = relevantEdges
    .sort((a, b) => {
      const aKey = `${a.sourceId}:${a.targetId}:${a.type}:${a.strength}`;
      const bKey = `${b.sourceId}:${b.targetId}:${b.type}:${b.strength}`;
      return aKey.localeCompare(bKey);
    });

  const edgesStr = sortedEdges
    .map(edge => `${edge.sourceId}->${edge.targetId}:${edge.type}:${edge.strength}`)
    .join('|');

  const nodeIdsStr = canonicalContext.nodeIds.sort().join(',');
  const sectionPathStr = clause.sectionPath.join('/');
  const neighborHashesStr = clause.neighborHashes.sort().join('|');

  const warmInput = [
    clause.normalizedText,
    sectionPathStr,
    neighborHashesStr,
    edgesStr,
    nodeIdsStr
  ].join('::');

  return createHash('sha256')
    .update(warmInput, 'utf8')
    .digest('hex');
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'd66eb87520511ebe320d2956d1c9f8654e59d10626612884b226474fcbc598e7',
  name: 'Semantic Hashing',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;