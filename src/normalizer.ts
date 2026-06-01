/**
 * Text normalization for stable semantic hashing.
 *
 * Goals:
 * - Formatting-only changes produce identical normalized output
 * - Unordered list items are sorted for hash stability
 * - Ordered/sequence lists are preserved (arrows, ordinals, numbered)
 * - Deterministic and idempotent
 */

/**
 * Normalize a block of text for semantic hashing.
 */
export function normalizeText(raw: string): string {
  // Unicode canonical normalization so canonically-equivalent inputs (NFC 'café' from
  // Windows/Linux vs NFD from macOS) converge to the same hash.
  let text = raw.normalize('NFC');

  // Remove fenced code blocks entirely (preserve that code existed but not its content)
  text = text.replace(/```[\s\S]*?```/g, '(code block)');

  // Remove markdown heading markers
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Remove bold/italic markers — only when the markers HUG non-space content with a
  // balanced marker count, so multiplication ('3 * 4') and globs ('*.ts') survive.
  text = text.replace(/(\*{1,3})(\S(?:[^*]*\S)?|\S)\1/g, '$2');
  // NOTE: underscore-emphasis stripping is intentionally NOT done — in technical specs
  // snake_case (user_id) and dunders (__init__) vastly outnumber `_italic_`, and the
  // two are indistinguishable, so stripping corrupts identifiers (changes the hash).

  // Remove inline code backticks (but keep content)
  text = text.replace(/`([^`]+)`/g, '$1');

  // Remove link/image syntax, keep text: [text](url) → text, ![alt](url) → alt
  text = text.replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Lowercase
  text = text.toLowerCase();

  // Process lines
  const lines = text.split('\n');
  const processed: string[] = [];
  let listBuffer: string[] = [];
  let listIsOrdered = false;

  for (const line of lines) {
    const trimmed = line.replace(/\s+/g, ' ').trim();
    if (trimmed === '') {
      // Flush list buffer on blank line
      if (listBuffer.length > 0) {
        flushList(listBuffer, listIsOrdered, processed);
        listBuffer = [];
        listIsOrdered = false;
      }
      continue;
    }

    // Detect list items (-, *, •, numbered). Require whitespace AFTER the marker so a
    // decimal/version ('3.14'), a negative number ('-5'), or a dash-opener is not eaten.
    const listMatch = trimmed.match(/^(?:[-*•]|\d+[.)])\s+(.*)/);
    if (listMatch) {
      const content = listMatch[1].trim();
      if (content === '') continue; // empty bullet — don't emit a blank line (idempotency)
      // Detect if this is a numbered list (ordered) on first item
      if (listBuffer.length === 0) {
        listIsOrdered = /^\d+[.)]/.test(trimmed);
      }
      // Detect sequence indicators in any item
      if (isSequenceContent(content)) {
        listIsOrdered = true;
      }
      listBuffer.push(content);
    } else {
      // Flush any pending list
      if (listBuffer.length > 0) {
        flushList(listBuffer, listIsOrdered, processed);
        listBuffer = [];
        listIsOrdered = false;
      }
      processed.push(trimmed);
    }
  }

  // Flush remaining list
  if (listBuffer.length > 0) {
    flushList(listBuffer, listIsOrdered, processed);
  }

  return processed.join('\n');
}

/**
 * Check if list item content contains sequence/order indicators
 * that should prevent sorting.
 */
function isSequenceContent(text: string): boolean {
  // Arrows: →, ->, =>, ←
  if (/[→←⇒⇐]|->|<-|=>/.test(text)) return true;
  // Numeric ordinals anywhere are unambiguous.
  if (/\b(?:1st|2nd|3rd|\d+th)\b/i.test(text)) return true;
  // Positional/sequence words count only when they LEAD the item (bare 'next'/'after'
  // in ordinary bullet content must not suppress sorting).
  if (/^(?:first|second|third|then|finally)\b/i.test(text)) return true;
  // Comma-delimited sequence with 3+ items that look like states/steps
  if (/\w+\s*,\s*\w+\s*,\s*\w+/.test(text)) return true;
  return false;
}

/**
 * Flush a list buffer to processed lines.
 * Unordered lists are sorted; ordered/sequence lists preserve order.
 */
function flushList(items: string[], isOrdered: boolean, out: string[]): void {
  if (!isOrdered) {
    items.sort();
  }
  out.push(...items);
}
