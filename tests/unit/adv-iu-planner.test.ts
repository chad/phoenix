import { describe, it, expect } from 'vitest';
import { buildIUsFromClusters } from '../../src/iu-planner.js';
import type { CanonCluster } from '../../src/iu-clusterer.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CanonicalType } from '../../src/models/canonical.js';

function node(canon_id: string, statement: string, type: CanonicalType = CanonicalType.REQUIREMENT): CanonicalNode {
  return { canon_id, type, statement } as unknown as CanonicalNode;
}
const cluster = (anchor: string, nodes: CanonicalNode[]): CanonCluster => ({ anchor, nodes } as CanonCluster);

describe('adversarial: iu-planner', () => {
  it('#21 source_canon_ids preserves node order (the hash sort does not mutate it)', () => {
    const ius = buildIUsFromClusters([cluster('svc', [node('c3', 'must do x'), node('c1', 'must do y'), node('c2', 'must do z')])]);
    expect(ius[0].source_canon_ids).toEqual(['c3', 'c1', 'c2']);
  });

  it('#22 an all-non-ASCII / punctuation anchor never yields an empty path segment', () => {
    const ius = buildIUsFromClusters([cluster('!!!', [node('c1', 'must do x')])]);
    expect(ius[0].output_files[0]).not.toContain('//');
    expect(ius[0].output_files[0]).not.toMatch(/\/\.ts$/);
  });

  it('#23 distinct anchors that slugify identically get distinct output files', () => {
    const ius = buildIUsFromClusters([
      cluster('User Account', [node('c1', 'must do x')]),
      cluster('User-Account', [node('c2', 'must do y')]),
    ]);
    const paths = ius.map(i => i.output_files[0]);
    expect(new Set(paths).size).toBe(2);
  });

  it('#45 output ordering is codepoint-stable (svc1 < svc10 < svc2)', () => {
    const ius = buildIUsFromClusters([
      cluster('svc2', [node('a', 'must do')]),
      cluster('svc10', [node('b', 'must do')]),
      cluster('svc1', [node('c', 'must do')]),
    ]);
    const dirs = ius.map(i => i.output_files[0]);
    expect(dirs).toEqual([...dirs].sort()); // default JS sort is codepoint order
    expect(dirs[0]).toContain('svc1/');
    expect(dirs[1]).toContain('svc10/');
    expect(dirs[2]).toContain('svc2/');
  });

  it('#46 deriveContract matches only the whole words notification/message', () => {
    const fp = buildIUsFromClusters([cluster('svc', [node('c1', 'the gateway sends a notificationxyz blob')])]);
    expect(fp[0].contract.inputs).not.toContain('notification');
    const real = buildIUsFromClusters([cluster('svc', [node('c1', 'the system sends a message to users')])]);
    expect(real[0].contract.inputs).toContain('notification');
  });
});
