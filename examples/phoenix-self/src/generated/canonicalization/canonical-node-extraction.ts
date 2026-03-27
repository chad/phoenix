import { createHash } from 'node:crypto';

export type CanonicalNodeType = 'requirement' | 'constraint' | 'invariant' | 'definition' | 'context';

export interface CanonicalNode {
  canon_id: string;
  type: CanonicalNodeType;
  normalized_statement: string;
  confidence_score: number;
  source_clause_ids: string[];
  tags: string[];
  linked_canon_ids: string[];
}

export interface SourceClause {
  id: string;
  text: string;
  sentence_index: number;
}

export interface ExtractionResult {
  nodes: CanonicalNode[];
  coverage_percentage: number;
  total_sentences: number;
  processed_sentences: number;
}

export interface ExtractionOptions {
  min_confidence_threshold?: number;
  enable_linking?: boolean;
  custom_keywords?: Record<CanonicalNodeType, string[]>;
}

const DEFAULT_KEYWORDS: Record<CanonicalNodeType, string[]> = {
  requirement: ['must', 'shall', 'should', 'required', 'needs', 'has to', 'ought to'],
  constraint: ['cannot', 'must not', 'shall not', 'forbidden', 'prohibited', 'limited', 'restricted'],
  invariant: ['always', 'never', 'invariant', 'constant', 'maintains', 'preserves', 'ensures'],
  definition: ['is defined as', 'means', 'refers to', 'is', 'represents', 'denotes', 'signifies'],
  context: []
};

export class CanonicalNodeExtractor {
  private keywords: Record<CanonicalNodeType, string[]>;
  private minConfidenceThreshold: number;
  private enableLinking: boolean;

  constructor(options: ExtractionOptions = {}) {
    this.keywords = options.custom_keywords || DEFAULT_KEYWORDS;
    this.minConfidenceThreshold = options.min_confidence_threshold || 0.1;
    this.enableLinking = options.enable_linking || true;
  }

  extract(sourceClauses: SourceClause[]): ExtractionResult {
    const nodes: CanonicalNode[] = [];
    const processedSentenceIds = new Set<number>();

    for (const clause of sourceClauses) {
      const node = this.extractNodeFromClause(clause);
      if (node && node.confidence_score >= this.minConfidenceThreshold) {
        nodes.push(node);
        processedSentenceIds.add(clause.sentence_index);
      }
    }

    if (this.enableLinking) {
      this.linkNodes(nodes);
    }

    const totalSentences = new Set(sourceClauses.map(c => c.sentence_index)).size;
    const processedSentences = processedSentenceIds.size;
    const coveragePercentage = totalSentences > 0 ? (processedSentences / totalSentences) * 100 : 0;

    return {
      nodes,
      coverage_percentage: Math.round(coveragePercentage * 100) / 100,
      total_sentences: totalSentences,
      processed_sentences: processedSentences
    };
  }

  private extractNodeFromClause(clause: SourceClause): CanonicalNode | null {
    const normalizedText = this.normalizeStatement(clause.text);
    const type = this.classifyNodeType(normalizedText);
    const confidence = this.calculateConfidence(normalizedText, type);
    const tags = this.extractTags(normalizedText);
    const canonId = this.generateCanonId(normalizedText, type);

    return {
      canon_id: canonId,
      type,
      normalized_statement: normalizedText,
      confidence_score: confidence,
      source_clause_ids: [clause.id],
      tags,
      linked_canon_ids: []
    };
  }

  private normalizeStatement(text: string): string {
    return text
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s.,;:!?()-]/g, '')
      .toLowerCase();
  }

  private classifyNodeType(normalizedText: string): CanonicalNodeType {
    const scores: Record<CanonicalNodeType, number> = {
      requirement: 0,
      constraint: 0,
      invariant: 0,
      definition: 0,
      context: 0
    };

    for (const [type, keywords] of Object.entries(this.keywords) as [CanonicalNodeType, string[]][]) {
      for (const keyword of keywords) {
        if (normalizedText.includes(keyword.toLowerCase())) {
          scores[type] += 1;
        }
      }
    }

    const maxScore = Math.max(...Object.values(scores));
    if (maxScore === 0) {
      return 'context';
    }

    const bestType = Object.entries(scores).find(([_, score]) => score === maxScore)?.[0] as CanonicalNodeType;
    return bestType || 'context';
  }

  private calculateConfidence(normalizedText: string, type: CanonicalNodeType): number {
    let confidence = 0.3; // Base confidence

    // Keyword matching boost
    const keywords = this.keywords[type];
    const keywordMatches = keywords.filter(keyword => 
      normalizedText.includes(keyword.toLowerCase())
    ).length;
    
    confidence += keywordMatches * 0.2;

    // Length and structure boost
    const wordCount = normalizedText.split(' ').length;
    if (wordCount >= 5 && wordCount <= 30) {
      confidence += 0.1;
    }

    // Sentence structure boost
    if (normalizedText.includes('.') || normalizedText.includes('!') || normalizedText.includes('?')) {
      confidence += 0.1;
    }

    // Context type penalty (since it's default)
    if (type === 'context') {
      confidence *= 0.7;
    }

    return Math.min(1.0, Math.max(0.0, Math.round(confidence * 100) / 100));
  }

  private extractTags(normalizedText: string): string[] {
    const tags: string[] = [];
    
    // Extract potential entity names (capitalized words in original would be lost in normalization)
    // So we look for patterns that suggest entities
    if (normalizedText.includes('system')) tags.push('system');
    if (normalizedText.includes('user')) tags.push('user');
    if (normalizedText.includes('data')) tags.push('data');
    if (normalizedText.includes('interface')) tags.push('interface');
    if (normalizedText.includes('security')) tags.push('security');
    if (normalizedText.includes('performance')) tags.push('performance');
    
    return tags;
  }

  private generateCanonId(normalizedText: string, type: CanonicalNodeType): string {
    const content = `${type}:${normalizedText}`;
    return createHash('sha256').update(content).digest('hex');
  }

  private linkNodes(nodes: CanonicalNode[]): void {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i];
        const nodeB = nodes[j];
        
        if (this.shouldLink(nodeA, nodeB)) {
          nodeA.linked_canon_ids.push(nodeB.canon_id);
          nodeB.linked_canon_ids.push(nodeA.canon_id);
        }
      }
    }
  }

  private shouldLink(nodeA: CanonicalNode, nodeB: CanonicalNode): boolean {
    // Link nodes with shared tags
    const sharedTags = nodeA.tags.filter(tag => nodeB.tags.includes(tag));
    if (sharedTags.length > 0) return true;

    // Link definitions with requirements/constraints that might use them
    if (nodeA.type === 'definition' && ['requirement', 'constraint'].includes(nodeB.type)) {
      const definitionWords = nodeA.normalized_statement.split(' ');
      const targetWords = nodeB.normalized_statement.split(' ');
      const overlap = definitionWords.filter(word => targetWords.includes(word) && word.length > 3);
      if (overlap.length >= 2) return true;
    }

    if (nodeB.type === 'definition' && ['requirement', 'constraint'].includes(nodeA.type)) {
      const definitionWords = nodeB.normalized_statement.split(' ');
      const targetWords = nodeA.normalized_statement.split(' ');
      const overlap = definitionWords.filter(word => targetWords.includes(word) && word.length > 3);
      if (overlap.length >= 2) return true;
    }

    return false;
  }
}

export function extractCanonicalNodes(
  sourceClauses: SourceClause[], 
  options?: ExtractionOptions
): ExtractionResult {
  const extractor = new CanonicalNodeExtractor(options);
  return extractor.extract(sourceClauses);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '62bbd8e4aa6c4b46a289ef307ff265b25d2c5d0a13370bb5689e253f35f9cafd',
  name: 'Canonical Node Extraction',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;