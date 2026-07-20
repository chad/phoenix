/**
 * Architecture-fit gate — silent scope-narrowing is a false green one level up.
 *
 * The freeqworld lesson, pinned: a game spec through a service target must produce a
 * loud OUT OF TARGET report naming the missing capabilities with counts and samples —
 * and the same spec through browser-game must show interactive-client as covered
 * while STILL honestly flagging what v0 does not provide (realtime, audio).
 */

import { describe, it, expect } from 'vitest';
import { assessArchitectureFit, formatFitReport } from '../../src/architecture-fit.js';
import { resolveTarget } from '../../src/architectures/index.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CanonicalType } from '../../src/models/canonical.js';

let seq = 0;
function node(type: CanonicalType, statement: string): CanonicalNode {
  return { canon_id: `c${seq++}`, type, statement, tags: [], source_clause_ids: [], linked_canon_ids: [] } as unknown as CanonicalNode;
}

const gameNodes = [
  node(CanonicalType.REQUIREMENT, 'the client must render the world as a top-down pixel-art view'),
  node(CanonicalType.REQUIREMENT, 'a participant must move their avatar with arrow keys'),
  node(CanonicalType.REQUIREMENT, 'the server must accept at most 15 position updates per second'),
  node(CanonicalType.REQUIREMENT, 'the music engine must schedule musical events using the web audio api'),
  node(CanonicalType.REQUIREMENT, 'a room must have a unique name'), // plain domain — never flagged
  node(CanonicalType.CONTEXT, 'the world evokes a canvas of possibility'), // context NEVER demands
];

describe('assessArchitectureFit', () => {
  it('a game spec against web-api: three capabilities OUT OF TARGET, with counts and samples', () => {
    const report = assessArchitectureFit(gameNodes, resolveTarget('web-api'));
    const caps = report.outOfTarget.map(d => d.capability).sort();
    expect(caps).toEqual(['audio-engine', 'interactive-client', 'realtime-presence']);
    const client = report.outOfTarget.find(d => d.capability === 'interactive-client')!;
    expect(client.nodeCount).toBe(2);
    expect(client.samples[0].statement).toContain('top-down');
  });

  it('the same spec against browser-game: interactive-client covered, realtime/audio still honestly out (v0)', () => {
    const report = assessArchitectureFit(gameNodes, resolveTarget('browser-game'));
    expect(report.covered.map(d => d.capability)).toContain('interactive-client');
    expect(report.outOfTarget.map(d => d.capability).sort()).toEqual(['audio-engine', 'realtime-presence']);
  });

  it('a plain CRUD spec fits any target — no false alarms', () => {
    const crud = [
      node(CanonicalType.REQUIREMENT, 'a task must have a title of at most 200 characters'),
      node(CanonicalType.REQUIREMENT, 'users can delete a completed task'),
    ];
    expect(assessArchitectureFit(crud, resolveTarget('web-api')).outOfTarget).toHaveLength(0);
  });

  it('CONTEXT nodes never create demand — vision acknowledges, requirements demand', () => {
    const visionOnly = [node(CanonicalType.CONTEXT, 'a pixel-art world with sprites and a game loop')];
    expect(assessArchitectureFit(visionOnly, resolveTarget('web-api')).outOfTarget).toHaveLength(0);
  });

  it('formatFitReport: empty for full fit; loud with totals and the arch hint otherwise', () => {
    expect(formatFitReport(assessArchitectureFit([], resolveTarget('web-api')))).toEqual([]);
    const lines = formatFitReport(assessArchitectureFit(gameNodes, resolveTarget('web-api')));
    expect(lines[0]).toMatch(/OUT OF TARGET: 4 requirement/);
    expect(lines.at(-1)).toMatch(/browser-game/);
  });
});
