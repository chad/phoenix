/**
 * Sentence Segmenter — splits clause text into semantic units.
 *
 * Rules:
 * - List items (-, *, •, numbered) are each one sentence
 * - Prose is split on sentence-ending punctuation
 * - Compound modals ("must A and must B") are split into two
 * - Lines with sequence indicators (→, ->) are kept atomic
 */

import { CONFIG } from './experiment-config.js';

/** A segmented sentence with its position index */
export interface Sentence {
  text: string;
  index: number;
  /** Whether this came from a list item (vs prose splitting) */
  fromList: boolean;
}

/**
 * Segment clause raw text into individual sentences.
 */
export function segmentSentences(rawText: string): Sentence[] {
  const lines = rawText.split('\n');
  const sentences: Sentence[] = [];
  let idx = 0;

  let proseBuffer = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Extract heading text as a sentence (provides section context)
    const headingMatch = trimmed.match(/^#{1,6}\s+(.*)/);
    if (headingMatch) {
      if (proseBuffer) {
        flushProse(proseBuffer, sentences, idx);
        idx = sentences.length;
        proseBuffer = '';
      }
      const headingText = headingMatch[1].trim();
      if (headingText.length >= CONFIG.MIN_LIST_ITEM_LENGTH) {
        sentences.push({ text: headingText, index: idx++, fromList: false });
      }
      continue;
    }

    // Skip empty lines — flush prose buffer
    if (!trimmed) {
      if (proseBuffer) {
        flushProse(proseBuffer, sentences, idx);
        idx = sentences.length;
        proseBuffer = '';
      }
      continue;
    }

    // Detect list items. Require whitespace after the marker and cap the ordinal to
    // 1-3 digits, so a decimal ('1.5'), negative ('-5'), 4-digit year ('2024.'), or
    // emphasis ('*word*') at line start is NOT misread as a list item.
    const listMatch = trimmed.match(/^(?:[-*•]|\d{1,3}[.)])\s+(.*)/);
    if (listMatch) {
      // Flush any pending prose
      if (proseBuffer) {
        flushProse(proseBuffer, sentences, idx);
        idx = sentences.length;
        proseBuffer = '';
      }
      const content = listMatch[1].trim();
      if (content.length >= CONFIG.MIN_LIST_ITEM_LENGTH) {
        // Split compound modals within list items
        const subs = splitCompoundModals(content);
        for (const sub of subs) {
          sentences.push({ text: sub, index: idx++, fromList: true });
        }
      }
    } else {
      // Prose line. In unstructured input (notes, chat) each line is usually its
      // own statement; only join when the line is a soft-wrap continuation of an
      // unfinished sentence (previous buffer didn't end in .!? and this line starts
      // lowercase). Otherwise flush the buffer so lines don't bleed together.
      const isContinuation = proseBuffer.length > 0
        && !/[.!?]$/.test(proseBuffer)
        && /^[a-z]/.test(trimmed);
      if (proseBuffer && !isContinuation) {
        flushProse(proseBuffer, sentences, idx);
        idx = sentences.length;
        proseBuffer = '';
      }
      proseBuffer += (proseBuffer ? ' ' : '') + trimmed;
    }
  }

  // Flush remaining prose
  if (proseBuffer) {
    flushProse(proseBuffer, sentences, idx);
  }

  return sentences;
}

/**
 * Split prose text into sentences and add to the array.
 */
function flushProse(text: string, sentences: Sentence[], startIdx: number): void {
  // Split on sentence boundaries: period/exclamation/question followed by space + uppercase
  const raw = splitProseIntoSentences(text);
  let idx = startIdx;
  for (const s of raw) {
    const trimmed = s.trim();
    if (trimmed.length < CONFIG.MIN_PROSE_SENTENCE_LENGTH) continue;
    // Split compound modals
    const subs = splitCompoundModals(trimmed);
    for (const sub of subs) {
      sentences.push({ text: sub, index: idx++, fromList: false });
    }
  }
}

/**
 * Split prose text on sentence boundaries.
 */
function splitProseIntoSentences(text: string): string[] {
  // Don't split if it's short enough to be one sentence
  if (text.length < CONFIG.PROSE_SPLIT_THRESHOLD) return [text];

  const results: string[] = [];
  // Split on '. ', '! ', '? ' followed by uppercase letter
  const pattern = /([.!?])\s+(?=[A-Z])/g;
  // Don't split after a known abbreviation/title or a single-letter acronym piece.
  const ABBREV = /(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|U\.S|a\.m|p\.m|[A-Z])$/i;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (ABBREV.test(text.slice(lastIdx, match.index))) continue; // not a real boundary
    const end = match.index + match[1].length;
    results.push(text.slice(lastIdx, end).trim());
    lastIdx = end + match[0].length - match[1].length;
  }

  if (lastIdx < text.length) {
    results.push(text.slice(lastIdx).trim());
  }

  return results.filter(s => s.length > 0);
}

/**
 * Split compound modal sentences:
 * "X must do A and must do B" → ["X must do A", "must do B"]
 * "X must do A; Y must do B" → ["X must do A", "Y must do B"]
 *
 * Only split if both parts contain a modal verb.
 */
export function splitCompoundModals(text: string): string[] {
  // Check for semicolons with modals on both sides
  const semiParts = text.split(/\s*;\s*/);
  if (semiParts.length > 1 && semiParts.every(p => hasModal(p))) {
    return carrySubjects(semiParts.filter(p => p.length >= CONFIG.MIN_SPLIT_PART_LENGTH));
  }

  // Check for " and " + modal or " and " separating complete modal clauses
  const andPattern = /\s+and\s+(?=(?:must not|must|shall|should|will|cannot|may not|may)\s)/i;
  const andMatch = text.match(andPattern);
  if (andMatch && andMatch.index !== undefined) {
    const left = text.slice(0, andMatch.index).trim();
    const right = text.slice(andMatch.index + andMatch[0].length).trim();
    if (left.length >= CONFIG.MIN_SPLIT_PART_LENGTH && right.length >= CONFIG.MIN_SPLIT_PART_LENGTH && hasModal(left)) {
      return carrySubjects([left, right]);
    }
  }

  return [text];
}

const MODAL_START = /^(?:must not|must|shall|should|will|cannot|may not|may)\b/i;
const FIRST_MODAL = /\b(?:must not|must|shall|should|will|cannot|may not|may)\b/i;

/** The subject noun phrase of a clause: everything before its first modal. */
function subjectOf(clause: string): string {
  const m = clause.match(FIRST_MODAL);
  if (!m || m.index === undefined || m.index === 0) return '';
  return clause.slice(0, m.index).trim();
}

/**
 * Carry the subject forward across split conjuncts. A conjunct that begins with a
 * bare modal ("must not exceed 40 characters") lost its subject in the split; give
 * it the most recent preceding subject so it reads "a tag label must not exceed 40
 * characters". Without this, the fragment canonicalizes to a subjectless constraint
 * that binds to nothing — the origin of the §1 mis-binding.
 */
function carrySubjects(parts: string[]): string[] {
  let subject = '';
  return parts.map(part => {
    const p = part.trim();
    if (MODAL_START.test(p) && subject) return `${subject} ${p}`;
    const s = subjectOf(p);
    if (s) subject = s;
    return p;
  });
}

function hasModal(text: string): boolean {
  return /\b(?:must|shall|should|will|cannot|must not|may not)\b/i.test(text);
}
