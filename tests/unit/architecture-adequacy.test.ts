/**
 * Architecture adequacy — Step 0, the decision Phoenix used to make blind.
 *
 * Derive the spec's shape; resolve an architecture that both EXPRESSES and COMPOSES it;
 * select it, or halt with the spec of the architecture that must be authored. These
 * tests pin the two-axis logic that would have stopped the freeqworld cascade at the
 * door: a game spec finds NO adequate architecture, because the only one that can
 * express an interactive client cannot compose one.
 */

import { describe, it, expect } from 'vitest';
import { resolveArchitectureAdequacy, formatAdequacy } from '../../src/architecture-adequacy.js';
import type { Architecture } from '../../src/models/architecture.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CanonicalType } from '../../src/models/canonical.js';

let seq = 0;
const node = (statement: string): CanonicalNode =>
  ({ canon_id: `c${seq++}`, type: CanonicalType.REQUIREMENT, statement, tags: [], source_clause_ids: [], linked_canon_ids: [] } as unknown as CanonicalNode);

// A minimal registry mirroring the real one's ADEQUACY shape.
const REGISTRY: Architecture[] = [
  { name: 'web-api', capabilities: ['http-api', 'domain-logic', 'persistence'], composes: ['http-api', 'domain-logic', 'persistence'] } as Architecture,
  { name: 'browser-game', capabilities: ['interactive-client', 'domain-logic'], composes: ['domain-logic'] } as Architecture,
];

const GAME = [
  node('the client must render the world as a top-down pixel-art view'),
  node('a participant must move their avatar with arrow keys'),
];
const CRUD = [node('a task must have a unique title'), node('users can delete a completed task')];

describe('resolveArchitectureAdequacy', () => {
  it('CRUD spec (no distinguishing demand) → derives the baseline service architecture', () => {
    const r = resolveArchitectureAdequacy(CRUD, null, REGISTRY);
    expect(r.verdict).toBe('selected');
    expect(r.selected).toBe('web-api');
  });

  it('game spec, nothing configured → NONE adequate, and the needed architecture is specified', () => {
    const r = resolveArchitectureAdequacy(GAME, null, REGISTRY);
    expect(r.verdict).toBe('none-adequate');
    expect(r.selected).toBeNull();
    expect(r.needed!.mustCompose).toContain('interactive-client');
    expect(r.needed!.closest).toBe('browser-game'); // nearest base to extend
    expect(r.needed!.closestGap).toMatch(/composition mechanism for interactive-client/);
  });

  it('the two axes are distinguished: web-api cannot EXPRESS, browser-game cannot COMPOSE', () => {
    const r = resolveArchitectureAdequacy(GAME, null, REGISTRY);
    const web = r.candidates.find(c => c.name === 'web-api')!;
    const game = r.candidates.find(c => c.name === 'browser-game')!;
    expect(web.expressionGaps.map(d => d.capability)).toContain('interactive-client');
    expect(game.expressionGaps).toHaveLength(0);            // it CAN express it
    expect(game.compositionGaps.map(d => d.capability)).toEqual(['interactive-client']); // but not compose it
  });

  it('human-configured but inadequate architecture → chosen-inadequate (halt), not silent proceed', () => {
    const r = resolveArchitectureAdequacy(GAME, 'browser-game', REGISTRY);
    expect(r.verdict).toBe('chosen-inadequate');
    expect(r.selected).toBeNull();
    expect(r.needed).toBeDefined();
  });

  it('an architecture that expresses AND composes the demand is adequate', () => {
    const full: Architecture[] = [
      ...REGISTRY,
      { name: 'game-2', capabilities: ['interactive-client', 'domain-logic'], composes: ['interactive-client', 'domain-logic'] } as Architecture,
    ];
    expect(resolveArchitectureAdequacy(GAME, null, full).selected).toBe('game-2');
    expect(resolveArchitectureAdequacy(GAME, 'game-2', full).verdict).toBe('chosen-adequate');
  });

  it('formatAdequacy speaks the halt in the open (shape, must-express, must-compose, nearest)', () => {
    const lines = formatAdequacy(resolveArchitectureAdequacy(GAME, null, REGISTRY)).join('\n');
    expect(lines).toMatch(/No registered architecture is adequate/);
    expect(lines).toMatch(/must compose: interactive-client/);
    expect(lines).toMatch(/nearest base: browser-game/);
    expect(lines).toMatch(/does not synthesize architectures/);
  });
});
