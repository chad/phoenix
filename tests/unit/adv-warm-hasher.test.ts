import { describe, it, expect } from 'vitest';
import { contextSemhashWarm } from '../../src/warm-hasher.js';
import { CanonicalType } from '../../src/models/canonical.js';
import type { Clause } from '../../src/models/clause.js';
import type { CanonicalNode } from '../../src/models/canonical.js';

const clause = (section_path: string[]): Clause => ({ clause_id: 'c1', normalized_text: 'x', section_path } as unknown as Clause);
const node = (linked: string[], link_types: Record<string, string> = {}): CanonicalNode =>
  ({ canon_id: 'n', type: CanonicalType.REQUIREMENT, source_clause_ids: ['c1'], confidence: 1, linked_canon_ids: linked, link_types } as unknown as CanonicalNode);

describe('adversarial: warm-hasher', () => {
  it('#21 distinct edge sets do not collide via the comma join', () => {
    const a = contextSemhashWarm(clause([]), [node(['a,b'], { 'a,b': 'refines' })]);          // one edge "a,b"
    const b = contextSemhashWarm(clause([]), [node(['a', 'b'], { a: 'refines', b: 'refines' })]); // two edges a, b
    expect(a).not.toBe(b);
  });

  it('#22 distinct section paths do not collide via the slash join', () => {
    const a = contextSemhashWarm(clause(['a/b']), []); // one heading literally "a/b"
    const b = contextSemhashWarm(clause(['a', 'b']), []); // two-level path
    expect(a).not.toBe(b);
  });

  it('#6 an UNTYPED edge is excluded (treated like no edge), per the typed-edges contract', () => {
    const untyped = contextSemhashWarm(clause([]), [node(['weak'])]);           // no link_types
    const noEdges = contextSemhashWarm(clause([]), [node([])]);
    const typed = contextSemhashWarm(clause([]), [node(['weak'], { weak: 'refines' })]);
    expect(untyped).toBe(noEdges);  // untyped edge contributes nothing
    expect(typed).not.toBe(noEdges); // a real typed edge does
  });
});
