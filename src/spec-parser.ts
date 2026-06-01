/**
 * Spec Parser — Markdown → Clause[]
 *
 * Splits a Markdown document on heading boundaries.
 * Each heading + its body = one Clause.
 * Tracks section hierarchy for nested headings.
 */

import type { Clause } from './models/clause.js';
import { normalizeText } from './normalizer.js';
import { clauseSemhash, contextSemhashCold, clauseId } from './semhash.js';

export interface RawSection {
  heading: string;
  level: number;
  startLine: number; // 1-indexed
  endLine: number;   // 1-indexed, inclusive
  rawText: string;
  sectionPath: string[];
}

/**
 * Parse a Markdown document into an array of Clauses.
 */
export function parseSpec(content: string, docId: string): Clause[] {
  const lines = content.split('\n');
  const sections = extractSections(lines);

  if (sections.length === 0) {
    // No headings found — treat entire document as one clause
    if (content.trim().length === 0) return [];
    const normalizedText = normalizeText(content);
    const semhash = clauseSemhash(normalizedText);
    const sectionPath: string[] = [];
    const id = clauseId(docId, normalizedText);
    const ctxHash = contextSemhashCold(normalizedText, '', '');
    return [{
      clause_id: id,
      source_doc_id: docId,
      source_line_range: [1, lines.length],
      raw_text: content,
      normalized_text: normalizedText,
      section_path: sectionPath,
      clause_semhash: semhash,
      context_semhash_cold: ctxHash,
    }];
  }

  // Build clauses without context hashes first
  const preClauses: Omit<Clause, 'context_semhash_cold'>[] = sections.map(sec => {
    const normalized = normalizeText(sec.rawText);
    const semhash = clauseSemhash(normalized);
    const id = clauseId(docId, normalized);
    return {
      clause_id: id,
      source_doc_id: docId,
      source_line_range: [sec.startLine, sec.endLine] as [number, number],
      raw_text: sec.rawText,
      normalized_text: normalized,
      section_path: sec.sectionPath,
      clause_semhash: semhash,
    };
  });

  // Now compute context hashes with neighbor awareness
  const clauses: Clause[] = preClauses.map((pc, i) => {
    const prev = i > 0 ? preClauses[i - 1].clause_semhash : '';
    const next = i < preClauses.length - 1 ? preClauses[i + 1].clause_semhash : '';
    const ctxHash = contextSemhashCold(pc.normalized_text, prev, next);
    return { ...pc, context_semhash_cold: ctxHash };
  });

  return clauses;
}

/**
 * Extract sections from Markdown lines.
 * A section = heading line through (but not including) the next heading of same or higher level,
 * or end of file.
 */
export function extractSections(lines: string[]): RawSection[] {
  const headingPattern = /^(#{1,6})\s+(.+)/;
  const headingIndices: { index: number; level: number; text: string }[] = [];

  // Track fenced-code state so a `# heading-looking` line INSIDE a ``` fence is not
  // parsed as a real heading; skip headings whose text is empty after trimming.
  const fencePattern = /^\s*(```|~~~)/;
  let inFence = false;
  let fenceMarker = '';
  for (let i = 0; i < lines.length; i++) {
    const fm = lines[i].match(fencePattern);
    if (fm) {
      if (!inFence) { inFence = true; fenceMarker = fm[1]; }
      else if (lines[i].trimStart().startsWith(fenceMarker)) { inFence = false; fenceMarker = ''; }
      continue;
    }
    if (inFence) continue;
    const match = lines[i].match(headingPattern);
    if (match && match[2].trim().length > 0) {
      headingIndices.push({ index: i, level: match[1].length, text: match[2].trim() });
    }
  }

  if (headingIndices.length === 0) return [];

  // Build sections with proper section_path tracking
  const sections: RawSection[] = [];
  const pathStack: { level: number; text: string }[] = [];

  // Capture pre-heading content as a preamble section
  if (headingIndices.length > 0 && headingIndices[0].index > 0) {
    const preambleText = lines.slice(0, headingIndices[0].index).join('\n');
    if (preambleText.trim().length > 0) {
      sections.push({
        heading: '(preamble)',
        level: 0,
        startLine: 1,
        endLine: headingIndices[0].index,
        rawText: preambleText, // not trimmed — consistent with heading sections + the range
        sectionPath: ['(preamble)'],
      });
    }
  }

  for (let h = 0; h < headingIndices.length; h++) {
    const { index, level, text } = headingIndices[h];
    const startLine = index + 1; // 1-indexed
    let endLine = h < headingIndices.length - 1
      ? headingIndices[h + 1].index // line before next heading (0-indexed), = next heading 1-indexed - 1
      : lines.length;
    // For the LAST section, don't count the empty trailing element a final newline
    // produces — the range must point at a real content line.
    if (h === headingIndices.length - 1) {
      while (endLine > startLine && lines[endLine - 1].trim() === '') endLine--;
    }

    // Update section path stack
    while (pathStack.length > 0 && pathStack[pathStack.length - 1].level >= level) {
      pathStack.pop();
    }
    pathStack.push({ level, text });
    const sectionPath = pathStack.map(p => p.text);

    // Extract raw text for this section
    const rawText = lines.slice(index, endLine).join('\n');

    sections.push({
      heading: text,
      level,
      startLine,
      endLine,
      rawText,
      sectionPath: [...sectionPath],
    });
  }

  return sections;
}
