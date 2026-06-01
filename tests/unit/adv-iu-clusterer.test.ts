import { describe, it, expect } from 'vitest';
import { singular, clusterCanonNodes } from '../../src/iu-clusterer.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CanonicalType } from '../../src/models/canonical.js';

let seq = 0;
const node = (tags: string[]): CanonicalNode =>
  ({ canon_id: `c${seq++}`, type: CanonicalType.REQUIREMENT, statement: `s ${tags.join(' ')}`, tags, source_clause_ids: [], linked_canon_ids: [] } as unknown as CanonicalNode);

describe('adversarial: iu-clusterer', () => {
  it('#4/#5/#17 singular() leaves non-plural -us/-is/-ics/-ss words intact', () => {
    expect(singular('status')).toBe('status');
    expect(singular('analysis')).toBe('analysis');
    expect(singular('analytics')).toBe('analytics');
    expect(singular('class')).toBe('class');
    expect(singular('bus')).toBe('bus');
    // real plurals still singularize
    expect(singular('cards')).toBe('card');
    expect(singular('categories')).toBe('category');
  });

  it('#19 an oversized cluster of all-unique-tag nodes does not explode into singletons', () => {
    seq = 0;
    const nodes = Array.from({ length: 25 }, (_, i) => node(['issue', `attr${i}`]));
    const clusters = clusterCanonNodes(nodes);
    // must not produce 25 singleton clusters — MIN_CLUSTER is preserved
    const singletons = clusters.filter(c => c.nodes.length < 2).length;
    expect(singletons).toBeLessThan(clusters.length); // not ALL singletons
    expect(clusters.length).toBeLessThan(25);
  });
});
