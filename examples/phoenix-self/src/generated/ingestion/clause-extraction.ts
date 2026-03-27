import { createHash } from 'node:crypto';

export interface Clause {
  clauseId: string;
  sourceDocId: string;
  sourceLineRange: [number, number];
  rawText: string;
  normalizedText: string;
  sectionPath: string[];
}

export interface ParsedDocument {
  docId: string;
  clauses: Clause[];
  sectionHierarchy: SectionNode[];
}

export interface SectionNode {
  level: number;
  title: string;
  path: string[];
  startLine: number;
  endLine: number;
  children: SectionNode[];
}

export class ClauseExtractor {
  private readonly hashAlgorithm = 'sha256';

  extractClauses(docId: string, markdownContent: string): ParsedDocument {
    const lines = markdownContent.split('\n');
    const sectionHierarchy = this.parseSectionHierarchy(lines);
    const clauses = this.extractClausesFromSections(docId, lines, sectionHierarchy);

    return {
      docId,
      clauses,
      sectionHierarchy
    };
  }

  private parseSectionHierarchy(lines: string[]): SectionNode[] {
    const sections: SectionNode[] = [];
    const sectionStack: SectionNode[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headingMatch) {
        const level = headingMatch[1].length;
        const title = headingMatch[2].trim();

        // Pop sections from stack that are at same or deeper level
        while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].level >= level) {
          const poppedSection = sectionStack.pop()!;
          poppedSection.endLine = i - 1;
        }

        // Build section path
        const path = sectionStack.map(s => s.title).concat(title);

        const section: SectionNode = {
          level,
          title,
          path,
          startLine: i,
          endLine: lines.length - 1, // Will be updated when section ends
          children: []
        };

        // Add to parent's children or root
        if (sectionStack.length > 0) {
          sectionStack[sectionStack.length - 1].children.push(section);
        } else {
          sections.push(section);
        }

        sectionStack.push(section);
      }
    }

    // Close remaining sections
    while (sectionStack.length > 0) {
      const section = sectionStack.pop()!;
      section.endLine = lines.length - 1;
    }

    return sections;
  }

  private extractClausesFromSections(docId: string, lines: string[], sections: SectionNode[]): Clause[] {
    const clauses: Clause[] = [];

    for (const section of sections) {
      this.extractClausesFromSection(docId, lines, section, clauses);
    }

    return clauses;
  }

  private extractClausesFromSection(docId: string, lines: string[], section: SectionNode, clauses: Clause[]): void {
    // Extract clauses from this section's content (before any child sections)
    let contentEndLine = section.endLine;
    if (section.children.length > 0) {
      contentEndLine = section.children[0].startLine - 1;
    }

    // Find content lines (skip the heading itself)
    const contentStartLine = section.startLine + 1;
    if (contentStartLine <= contentEndLine) {
      const contentLines = lines.slice(contentStartLine, contentEndLine + 1);
      const nonEmptyLines = contentLines.map((line, idx) => ({ line, lineNum: contentStartLine + idx }))
        .filter(({ line }) => line.trim().length > 0);

      if (nonEmptyLines.length > 0) {
        // Group consecutive non-empty lines into clauses
        let currentClause: { line: string; lineNum: number }[] = [];

        for (const { line, lineNum } of nonEmptyLines) {
          if (currentClause.length === 0 || lineNum === currentClause[currentClause.length - 1].lineNum + 1) {
            currentClause.push({ line, lineNum });
          } else {
            // Gap found, finalize current clause and start new one
            if (currentClause.length > 0) {
              clauses.push(this.createClause(docId, currentClause, section.path));
            }
            currentClause = [{ line, lineNum }];
          }
        }

        // Finalize last clause
        if (currentClause.length > 0) {
          clauses.push(this.createClause(docId, currentClause, section.path));
        }
      }
    }

    // Recursively process child sections
    for (const child of section.children) {
      this.extractClausesFromSection(docId, lines, child, clauses);
    }
  }

  private createClause(docId: string, clauseLines: { line: string; lineNum: number }[], sectionPath: string[]): Clause {
    const rawText = clauseLines.map(cl => cl.line).join('\n');
    const normalizedText = this.normalizeText(rawText);
    const clauseId = this.generateClauseId(normalizedText);
    const sourceLineRange: [number, number] = [
      clauseLines[0].lineNum,
      clauseLines[clauseLines.length - 1].lineNum
    ];

    return {
      clauseId,
      sourceDocId: docId,
      sourceLineRange,
      rawText,
      normalizedText,
      sectionPath: [...sectionPath]
    };
  }

  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim();
  }

  private generateClauseId(normalizedText: string): string {
    return createHash(this.hashAlgorithm)
      .update(normalizedText, 'utf8')
      .digest('hex');
  }
}

export function extractClauses(docId: string, markdownContent: string): ParsedDocument {
  const extractor = new ClauseExtractor();
  return extractor.extractClauses(docId, markdownContent);
}

export function generateClauseId(text: string): string {
  const extractor = new ClauseExtractor();
  const normalized = extractor['normalizeText'](text);
  return extractor['generateClauseId'](normalized);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '5034ec6ff3a2ba839954cb475d519bcd40dd2eb0556da6f1fd6fb6b472ec533e',
  name: 'Clause Extraction',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;