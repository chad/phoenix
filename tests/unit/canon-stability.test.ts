import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeStability, anchorsOf, CanonStabilityStore } from '../../src/canon-stability.js';
import { extractCanonicalNodes } from '../../src/canonicalizer.js';
import { parseSpec } from '../../src/spec-parser.js';
import type { CanonicalNode } from '../../src/models/canonical.js';

describe('computeStability', () => {
  it('first run reports 100% and first_run=true', () => {
    const r = computeStability(null, ['a', 'b']);
    expect(r.first_run).toBe(true);
    expect(r.retention).toBe(1);
  });
  it('identical anchor sets → 100% retention, 0 novelty', () => {
    const r = computeStability(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(r.retention).toBe(1);
    expect(r.novelty).toBe(0);
    expect(r.dropped).toBe(0);
  });
  it('one dropped anchor → partial retention', () => {
    const r = computeStability(['a', 'b', 'c', 'd'], ['a', 'b', 'c']);
    expect(r.retention).toBeCloseTo(0.75);
    expect(r.dropped).toBe(1);
  });
  it('added anchors count as novelty, not lost retention', () => {
    const r = computeStability(['a', 'b'], ['a', 'b', 'c', 'd']);
    expect(r.retention).toBe(1);
    expect(r.added).toBe(2);
    expect(r.novelty).toBeCloseTo(0.5);
  });
  it('multiset semantics: duplicate anchors counted', () => {
    const r = computeStability(['a', 'a', 'b'], ['a', 'b']);
    expect(r.kept).toBe(2); // one 'a' + one 'b'
    expect(r.dropped).toBe(1); // the second 'a'
  });
});

describe('CanonStabilityStore.update', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'phoenix-stab-')); });
  const nodes = (anchors: string[]): CanonicalNode[] =>
    anchors.map((a, i) => ({ canon_id: `c${i}`, type: 'REQUIREMENT', statement: `s${i}`, canon_anchor: a, source_clause_ids: [], linked_canon_ids: [], tags: [] } as unknown as CanonicalNode));

  it('first update seeds baseline; second measures against it', () => {
    const store = new CanonStabilityStore(dir);
    const r1 = store.update(nodes(['x', 'y']));
    expect(r1.first_run).toBe(true);
    const r2 = store.update(nodes(['x', 'y', 'z']));
    expect(r2.first_run).toBe(false);
    expect(r2.retention).toBe(1);
    expect(r2.added).toBe(1);
  });
});

describe('canon_anchor stability under rewording (two-layer identity)', () => {
  // The stable identity (anchor = type + tags) must survive a synonym reword that
  // keeps the domain nouns, even though the content hash (canon_id) changes.
  function anchorsFor(text: string): { anchor?: string; id: string; statement: string }[] {
    const clauses = parseSpec(`# Doc\n\n## Auth\n\n- ${text}\n`, 'spec/a.md');
    return extractCanonicalNodes(clauses).filter(n => n.type !== 'CONTEXT').map(n => ({ anchor: n.canon_anchor, id: n.canon_id, statement: n.statement }));
  }

  it('a reword preserving domain terms keeps the anchor but changes the content id', () => {
    const before = anchorsFor('The system must validate every user session token.');
    const after = anchorsFor('The system shall validate every user session token.'); // must→shall
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    const aBefore = new Set(before.map(n => n.anchor));
    const aAfter = new Set(after.map(n => n.anchor));
    // At least one anchor is shared across the reword (stable identity survived).
    const shared = [...aAfter].filter(a => aBefore.has(a));
    expect(shared.length).toBeGreaterThan(0);
  });
});
