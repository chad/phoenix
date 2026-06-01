import { describe, it, expect } from 'vitest';
import { diffClauses } from '../../src/diff.js';
import { DiffType } from '../../src/models/clause.js';
import type { Clause } from '../../src/models/clause.js';

function mk(id: string, semhash: string, path: string[], line = 1): Clause {
  return {
    clause_id: id, source_doc_id: 'd', source_line_range: [line, line],
    raw_text: 't', normalized_text: 't', section_path: path,
    clause_semhash: semhash, context_semhash_cold: 'c',
  } as unknown as Clause;
}
const counts = (ds: { diff_type: string }[]): Record<string, number> => {
  const c: Record<string, number> = {};
  for (const d of ds) c[d.diff_type] = (c[d.diff_type] ?? 0) + 1;
  return c;
};

describe('adversarial: diff', () => {
  it('#0 duplicate identical clauses are not silently dropped (1 UNCHANGED + 2 REMOVED)', () => {
    const before = [mk('X', 'sX', ['A']), mk('X', 'sX', ['B']), mk('X', 'sX', ['C'])];
    const after = [mk('X', 'sX', ['A'])];
    const ds = diffClauses(before, after);
    expect(ds.filter(d => d.clause_before).length).toBe(3); // every before-clause accounted
    expect(counts(ds)[DiffType.UNCHANGED]).toBe(1);
    expect(counts(ds)[DiffType.REMOVED]).toBe(2);
  });

  it('#7 a surplus duplicate before-clause is MODIFIED/REMOVED, not dropped', () => {
    const before = [mk('X', 'sX', ['A']), mk('X', 'sX', ['B'])];
    const after = [mk('X', 'sX', ['A']), mk('Z', 'sZ', ['B'])];
    const ds = diffClauses(before, after);
    expect(ds.filter(d => d.clause_before).length).toBe(2);
    expect(ds.some(d => d.diff_type === DiffType.UNCHANGED)).toBe(true);
  });

  it('#8 identical clauses that keep their section_path are UNCHANGED, not MOVED', () => {
    const before = [mk('X', 'sX', ['A']), mk('X', 'sX', ['B'])];
    const after = [mk('X', 'sX', ['B']), mk('X', 'sX', ['A'])];
    const ds = diffClauses(before, after);
    expect(counts(ds)[DiffType.UNCHANGED]).toBe(2);
    expect(counts(ds)[DiffType.MOVED] ?? 0).toBe(0);
  });

  it('#22 MOVED pairing is deterministic regardless of after[] order', () => {
    const before = [mk('X', 'sX', ['A']), mk('X', 'sX', ['B'])];
    const map = (after: Clause[]): string[] =>
      diffClauses(before, after).filter(d => d.diff_type === DiffType.MOVED)
        .map(d => `${d.section_path_before!.join('/')}->${d.section_path_after!.join('/')}`).sort();
    expect(map([mk('X', 'sX', ['C']), mk('X', 'sX', ['D'])])).toEqual(map([mk('X', 'sX', ['D']), mk('X', 'sX', ['C'])]));
  });
});
