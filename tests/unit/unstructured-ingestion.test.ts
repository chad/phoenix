import { describe, it, expect } from 'vitest';
import { parseSpec } from '../../src/spec-parser.js';
import { extractCanonicalNodes } from '../../src/canonicalizer.js';

/**
 * The domain-driven premise: input may be raw, unstructured notes (no headings,
 * full of chatter). The signal gate must keep the intent and drop the noise, and
 * canonicalization must not depend on document structure.
 */
describe('unstructured ingestion', () => {
  const meetingNotes = `Standup notes 2026-05-30

Ada: morning everyone, thanks for joining
[09:02] ok let's get started

Ada: the system must let users create a task with at least a title
Grace: agreed. a task should also have a priority of urgent, high, normal, or low
Linus: I think we should circle back on notifications later
Grace: a task title must not exceed 200 characters
Ada: users can mark a task complete or reopen it
Linus: lol nice
Grace: we decided to use SQLite for storage
Ada: anyway, moving on — overdue tasks must be visually highlighted
Linus: action items: Grace to spike the schema`;

  it('keeps intent and drops noise with no heading structure', () => {
    const clauses = parseSpec(meetingNotes, 'notes.md');
    const canon = extractCanonicalNodes(clauses).filter(n => n.type !== 'CONTEXT');
    const joined = canon.map(n => n.statement.toLowerCase()).join(' || ');

    // Intent survives:
    expect(joined).toMatch(/create .*task|task .*title/);
    expect(joined).toMatch(/200 characters/);
    expect(joined).toMatch(/overdue|highlighted/);

    // Noise does not become a canonical node:
    expect(joined).not.toMatch(/thanks for joining|let's get started/);
    expect(joined).not.toMatch(/circle back|moving on|action items|lol/);
  });
});
