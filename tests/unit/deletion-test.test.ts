/**
 * The deletion test (book ch9) — the four properties from a single deletion.
 *
 * Pins the analysis core: it derives consumers from the reference graph, flags the ones
 * the interface never declared (boundary clarity), measures coupling depth, and grades
 * replaceability against eval coverage. No project boot — pure over (IU, canon, covered).
 */

import { describe, it, expect } from 'vitest';
import { analyzeDeletion, deletionScorecard } from '../../src/deletion-test.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CanonicalType } from '../../src/models/canonical.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

let seq = 0;
function iu(name: string, canonIds: string[] = [], deps: string[] = []): ImplementationUnit {
  return {
    iu_id: 'iu-' + name, kind: 'module', name, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: canonIds, dependencies: deps,
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: [`src/generated/${name}/${name}.ts`],
  };
}
const canon = (statement: string): CanonicalNode =>
  ({ canon_id: 'n' + seq++, type: CanonicalType.CONSTRAINT, statement, source_clause_ids: ['cl'], linked_canon_ids: [], tags: [] } as unknown as CanonicalNode);

describe('analyzeDeletion', () => {
  it('flags a consumer that references the deleted module but was never declared', () => {
    const roomNode = canon('a room must have a unique name');
    const bookingRef = canon('a booking must reference an existing room');
    const room = iu('room', [roomNode.canon_id]);
    const booking = iu('booking', [bookingRef.canon_id]); // references room, declares nothing
    const r = analyzeDeletion(room, [room, booking], [roomNode, bookingRef], () => false);
    expect(r.actualConsumers).toContain('booking');
    expect(r.undeclaredConsumers).toContain('booking');
    expect(r.findings.some(f => f.property === 'boundary' && f.severity === 'error')).toBe(true);
  });

  it('a declared dependency is NOT an undeclared consumer', () => {
    const roomNode = canon('a room must have a unique name');
    const bookingRef = canon('a booking must reference an existing room');
    const room = iu('room', [roomNode.canon_id]);
    const booking = iu('booking', [bookingRef.canon_id], ['iu-room']); // declares the dep
    const r = analyzeDeletion(room, [room, booking], [roomNode, bookingRef], () => true);
    expect(r.actualConsumers).toContain('booking');
    expect(r.undeclaredConsumers).not.toContain('booking');
  });

  it('replaceability grades on coverage + undeclared consumers', () => {
    const roomNode = canon('a room must have a unique name');
    const ref = canon('a booking must reference an existing room');
    const room = iu('room', [roomNode.canon_id]);
    const booking = iu('booking', [ref.canon_id]);
    const nodes = [roomNode, ref];
    // uncovered → unverifiable
    expect(analyzeDeletion(room, [room, booking], nodes, () => false).replaceability).toBe('unverifiable');
    // covered but undeclared consumer → risky
    expect(analyzeDeletion(room, [room, booking], nodes, () => true).replaceability).toBe('risky');
    // covered, no consumers → replaceable
    const leaf = iu('formatter', [canon('a label must be short').canon_id]);
    expect(analyzeDeletion(leaf, [leaf], [], () => true).replaceability).toBe('replaceable');
  });

  it('deletionScorecard tallies the replaceability spectrum', () => {
    const roomNode = canon('a room must have a unique name');
    const ref = canon('a booking must reference an existing room');
    const room = iu('room', [roomNode.canon_id]);
    const booking = iu('booking', [ref.canon_id]);
    const card = deletionScorecard([room, booking], [roomNode, ref], () => false);
    expect(card.replaceable + card.risky + card.unverifiable).toBe(2);
    expect(card.unverifiable).toBe(2); // nothing covered
  });
});
