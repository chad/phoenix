import { describe, it, expect } from 'vitest';
import { resolveGraph } from '../../src/resolution.js';
import { CanonicalType } from '../../src/models/canonical.js';
import type { CandidateNode } from '../../src/models/canonical.js';

function cand(id: string, type: CanonicalType, tags: string[], statement: string): CandidateNode {
  return { candidate_id: id, type, statement, confidence: 1, source_clause_ids: [id], tags, sentence_index: 0, extraction_method: 'rule' };
}

describe('adversarial: resolution', () => {
  it('#4 enforceMaxDegree keeps the graph symmetric (no dangling half-edges)', () => {
    const cands = [cand('HUB', CanonicalType.REQUIREMENT, ['hub', ...Array.from({ length: 15 }, (_, k) => `u${k}`)], 'hub statement zero')];
    for (let k = 0; k < 15; k++) cands.push(cand(`N${k}`, CanonicalType.REQUIREMENT, ['hub', `u${k}`], `neighbor statement number ${k}`));
    const g = resolveGraph(cands, []);
    for (const n of g) {
      for (const id of n.linked_canon_ids) {
        const t = g.find(x => x.canon_id === id)!;
        expect(t.linked_canon_ids).toContain(n.canon_id); // reverse edge exists
      }
    }
    const hub = g.find(x => x.canon_id === 'HUB')!;
    expect(hub.linked_canon_ids.filter(id => hub.link_types?.[id] !== 'duplicates').length).toBeLessThanOrEqual(12);
  });

  it('#20 the reverse edge of a DEFINITION→REQUIREMENT is not also "defines"', () => {
    const g = resolveGraph([
      cand('D', CanonicalType.DEFINITION, ['sharedtag'], 'a definition of the thing'),
      cand('R', CanonicalType.REQUIREMENT, ['sharedtag'], 'a requirement about the thing'),
    ], []);
    const d = g.find(x => x.canon_id === 'D')!;
    const r = g.find(x => x.canon_id === 'R')!;
    expect(d.link_types?.['R']).toBe('defines');
    expect(r.link_types?.['D']).not.toBe('defines'); // a REQUIREMENT does not 'define' a DEFINITION
  });

  it('#3 a tag at exactly the document-frequency cutoff still forms an edge', () => {
    const g = resolveGraph([
      cand('A', CanonicalType.REQUIREMENT, ['t', 'a'], 'statement alpha unique words'),
      cand('B', CanonicalType.REQUIREMENT, ['t', 'b'], 'statement bravo other words'),
      cand('C', CanonicalType.REQUIREMENT, ['c', 'd'], 'statement charlie separate words'),
    ], []);
    expect(g.find(x => x.canon_id === 'A')!.linked_canon_ids).toContain('B');
  });
});
