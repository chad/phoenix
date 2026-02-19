/**
 * Sentence Segmenter — splits clause text into semantic units.
 *
 * Rules:
 * - List items (-, *, •, numbered) are each one sentence
 * - Prose is split on sentence-ending punctuation
 * - Compound modals ("must A and must B") are split into two
 * - Lines with sequence indicators (→, ->) are kept atomic
 */

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

    // Skip headings
    if (/^#{1,6}\s/.test(trimmed)) continue;

    // Skip empty lines — flush prose buffer
    if (!trimmed) {
      if (proseBuffer) {
        flushProse(proseBuffer, sentences, idx);
        idx = sentences.length;
        proseBuffer = '';
      }
      continue;
    }

    // Detect list items
    const listMatch = trimmed.match(/^(?:[-*•]|\d+[.)]\s*)\s*(.*)/);
    if (listMatch) {
      // Flush any pending prose
      if (proseBuffer) {
        flushProse(proseBuffer, sentences, idx);
        idx = sentences.length;
        proseBuffer = '';
      }
      const content = listMatch[1].trim();
      if (content.length >= 3) {
        // Split compound modals within list items
        const subs = splitCompoundModals(content);
        for (const sub of subs) {
          sentences.push({ text: sub, index: idx++, fromList: true });
        }
      }
    } else {
      // Prose line — accumulate
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
    if (trimmed.length < 3) continue;
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
  if (text.length < 80) return [text];

  const results: string[] = [];
  // Split on '. ', '! ', '? ' followed by uppercase letter
  const pattern = /([.!?])\s+(?=[A-Z])/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
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
function splitCompoundModals(text: string): string[] {
  // Check for semicolons with modals on both sides
  const semiParts = text.split(/\s*;\s*/);
  if (semiParts.length > 1 && semiParts.every(p => hasModal(p))) {
    return semiParts.filter(p => p.length >= 3);
  }

  // Check for " and " + modal or " and " separating complete modal clauses
  const andPattern = /\s+and\s+(?=(?:must|shall|should|will|cannot|must not)\s)/i;
  const andMatch = text.match(andPattern);
  if (andMatch && andMatch.index !== undefined) {
    const left = text.slice(0, andMatch.index).trim();
    const right = text.slice(andMatch.index + andMatch[0].length).trim();
    if (left.length >= 3 && right.length >= 3 && hasModal(left)) {
      return [left, right];
    }
  }

  return [text];
}

function hasModal(text: string): boolean {
  return /\b(?:must|shall|should|will|cannot|must not|may not)\b/i.test(text);
}
