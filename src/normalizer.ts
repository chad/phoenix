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
  let text = raw;

  // Remove fenced code blocks entirely (preserve that code existed but not its content)
  text = text.replace(/```[\s\S]*?```/g, '(code block)');

  // Remove markdown heading markers
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Remove bold/italic markers
  text = text.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
  text = text.replace(/_{1,3}([^_]+)_{1,3}/g, '$1');

  // Remove inline code backticks (but keep content)
  text = text.replace(/`([^`]+)`/g, '$1');

  // Remove link syntax, keep text: [text](url) → text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

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

    // Detect list items (-, *, •, numbered)
    const listMatch = trimmed.match(/^(?:[-*•]|\d+[.)]\s*)\s*(.*)/);
    if (listMatch) {
      const content = listMatch[1].trim();
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
  // Ordinals: 1st, 2nd, first, second, then, finally
  if (/\b(?:1st|2nd|3rd|\d+th|first|second|third|then|finally|next|after)\b/i.test(text)) return true;
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
