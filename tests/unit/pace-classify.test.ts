/**
 * Pace-layer classification (book ch6/ch16) — derived from the graph, deterministic.
 *
 * The model existed and was never populated; every regen-gate said "no pace layer
 * classification." These tests pin the derivation: dependency weight (reference
 * constraints pointing INTO an entity) + load-bearing invariants set the pace, and
 * the user-facing surface is the conservation layer.
 */

import { describe, it, expect } from 'vitest';
import { classifyPaceLayers, filterConservationProtected } from '../../src/pace-classify.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CanonicalType } from '../../src/models/canonical.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

let seq = 0;
function iu(name: string, invariants: string[] = []): ImplementationUnit {
  return {
    iu_id: 'iu-' + name.replace(/\s+/g, '-'), kind: 'module', name, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants },
    source_canon_ids: [], dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: [`src/generated/${name}/${name}.ts`],
  };
}
const canon = (statement: string): CanonicalNode =>
  ({ canon_id: 'c' + seq++, type: CanonicalType.CONSTRAINT, statement, source_clause_ids: ['cl'], linked_canon_ids: [], tags: [] } as unknown as CanonicalNode);

describe('classifyPaceLayers', () => {
  it('a heavily-referenced entity with invariants is foundation; a UI is a conservation surface', () => {
    const ius = [
      iu('room', ['a room must have a unique name']),          // referenced by others + invariant
      iu('message'),                                            // references room
      iu('booking'),                                            // references room
      iu('web ui'),                                             // the surface
    ];
    // reference constraints pointing INTO "room"
    const nodes = [
      canon('a message must reference an existing room'),
      canon('a booking must reference an existing room'),
      canon('a room must have a unique name'),
    ];
    const m = classifyPaceLayers(ius, nodes);
    const room = m.get('iu-room')!;
    expect(room.dependency_weight).toBeGreaterThanOrEqual(1);
    expect(['foundation', 'domain']).toContain(room.pace_layer); // depended-upon + load-bearing → slow
    expect(room.conservation).toBe(false);

    const ui = m.get('iu-web-ui')!;
    expect(ui.pace_layer).toBe('surface');
    expect(ui.conservation).toBe(true);                          // ch16: UI is the conservation layer
    expect(ui.classification_rationale).toMatch(/conservation/);
  });

  it('a leaf module nobody references is a fast (surface) layer', () => {
    const m = classifyPaceLayers([iu('formatter')], [canon('a habit must have a name')]);
    expect(m.get('iu-formatter')!.pace_layer).toBe('surface');
    expect(m.get('iu-formatter')!.dependency_weight).toBe(0);
  });

  it('is deterministic and never stamps a review date (auto-classification is not a human review)', () => {
    const ius = [iu('room', ['inv'])];
    const nodes = [canon('a message must reference an existing room')];
    const a = classifyPaceLayers(ius, nodes);
    const b = classifyPaceLayers(ius, nodes);
    expect(a.get('iu-room')).toEqual(b.get('iu-room'));
    expect(a.get('iu-room')!.last_reviewed).toBe('');
    // rationale must differ from the model's "needs review" sentinel so audit treats it as classified
    expect(a.get('iu-room')!.classification_rationale).not.toBe('Default classification — needs review');
  });
});

describe('filterConservationProtected (ch16 regen refusal)', () => {
  it('refuses an uncovered conservation IU, allows it when covered or overridden', () => {
    const filter = filterConservationProtected;
    const ui = iu('web ui');
    const room = iu('room', ['a room must have a name']);
    const pace = classifyPaceLayers([ui, room], [canon('a room must have a name')]);
    expect(pace.get(ui.iu_id)!.conservation).toBe(true);

    // uncovered conservation → refused; the entity IU passes through
    const uncovered = filter([ui, room], pace, () => false, false);
    expect(uncovered.refused.map((i: any) => i.name)).toEqual(['web ui']);
    expect(uncovered.allowed.map((i: any) => i.name)).toEqual(['room']);

    // covered → allowed
    expect(filter([ui], pace, () => true, false).refused).toHaveLength(0);
    // explicit override → allowed even uncovered
    expect(filter([ui], pace, () => false, true).refused).toHaveLength(0);
  });
});
