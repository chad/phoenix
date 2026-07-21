/**
 * Compaction proposals (book ch10–11) — reduce conceptual mass, propose never apply.
 *
 * Pins the three detectors and the mass budget. Proposals carry evidence + a
 * verification plan; nothing is ever merged or deleted by this code.
 */

import { describe, it, expect } from 'vitest';
import { proposeCompactions } from '../../src/compaction-proposals.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CanonicalType } from '../../src/models/canonical.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

let seq = 0;
function iu(name: string, canonIds: string[] = []): ImplementationUnit {
  return {
    iu_id: 'iu-' + name.replace(/\s+/g, '-') + '-' + seq++, kind: 'module', name, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: canonIds, dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: [`src/generated/x/x.ts`],
  };
}
let nid = 0;
const canon = (statement: string): CanonicalNode =>
  ({ canon_id: 'n' + nid++, type: CanonicalType.CONSTRAINT, statement, source_clause_ids: ['cl'], linked_canon_ids: [], tags: [] } as unknown as CanonicalNode);

describe('proposeCompactions', () => {
  it('proposes consolidating an over-fragmented entity', () => {
    const n = [canon('a room must have a name')];
    const ids = n.map(x => x.canon_id);
    const ius = [iu('room agent', ids), iu('room channel', ids), iu('room display', ids), iu('room music', ids)];
    const { proposals } = proposeCompactions(ius, n, () => true);
    const merge = proposals.find(p => p.kind === 'merge-over-fragmented' && p.subject === 'room');
    expect(merge).toBeDefined();
    expect(merge!.evidence).toMatch(/spread across 4 IUs/);
    expect(merge!.verification).toMatch(/eval/);
  });

  it('flags dead weight: an IU nothing references and no eval covers', () => {
    const n = [canon('a formatter trims whitespace')];
    const orphanIU = iu('formatter', n.map(x => x.canon_id));
    const { proposals } = proposeCompactions([orphanIU], n, () => false);
    expect(proposals.some(p => p.kind === 'dead-weight' && p.subject === 'formatter')).toBe(true);
  });

  it('a covered, referenced IU is NOT dead weight', () => {
    const roomNode = canon('a room must have a name');
    const ref = canon('a booking must reference an existing room');
    const room = iu('room', [roomNode.canon_id]);
    const booking = iu('booking', [ref.canon_id]);
    const { proposals } = proposeCompactions([room, booking], [roomNode, ref], () => true);
    expect(proposals.some(p => p.kind === 'dead-weight' && p.subject === 'room')).toBe(false);
  });

  it('flags orphan canon nodes owned by no IU', () => {
    const owned = canon('a room must have a name');
    const orphan = canon('a message must not exceed 500 chars');
    const { proposals } = proposeCompactions([iu('room', [owned.canon_id])], [owned, orphan], () => true);
    expect(proposals.some(p => p.kind === 'orphan-canon')).toBe(true);
  });

  it('mass budget flags an over-budget plan', () => {
    const n = [canon('a room must have a name')];
    const ius = Array.from({ length: 10 }, (_, i) => iu('e' + i, n.map(x => x.canon_id)));
    const { mass } = proposeCompactions(ius, n, () => true, { budgetIUs: 5 });
    expect(mass.overBudget).toBe(true);
    expect(mass.ius).toBe(10);
  });
});
