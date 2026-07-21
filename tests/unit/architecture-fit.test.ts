/**
 * Capability demand detection — the input to Step 0's adequacy resolution.
 *
 * (The one-axis "fit" report this module used to host was collapsed into
 * architecture-adequacy — see architecture-adequacy.test.ts. What remains here is
 * the deterministic detector: which distinguishing capabilities does the spec demand?)
 */

import { describe, it, expect } from 'vitest';
import { detectCapabilityDemands } from '../../src/architecture-fit.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CanonicalType } from '../../src/models/canonical.js';

let seq = 0;
const node = (type: CanonicalType, statement: string): CanonicalNode =>
  ({ canon_id: `c${seq++}`, type, statement, tags: [], source_clause_ids: [], linked_canon_ids: [] } as unknown as CanonicalNode);

describe('detectCapabilityDemands', () => {
  it('detects interactive-client, realtime-presence, and audio-engine from normative nodes', () => {
    const demands = detectCapabilityDemands([
      node(CanonicalType.REQUIREMENT, 'the client must render the world as a top-down pixel-art view'),
      node(CanonicalType.REQUIREMENT, 'a participant must move their avatar with arrow keys'),
      node(CanonicalType.REQUIREMENT, 'the server must accept position updates per second in real-time'),
      node(CanonicalType.REQUIREMENT, 'the music engine must schedule musical events using the web audio api'),
    ]);
    expect(demands.map(d => d.capability).sort()).toEqual(['audio-engine', 'interactive-client', 'realtime-presence']);
    const client = demands.find(d => d.capability === 'interactive-client')!;
    expect(client.nodeCount).toBe(2);
    expect(client.samples[0].statement).toContain('top-down');
  });

  it('a plain CRUD spec demands no distinguishing capabilities (baseline service shape)', () => {
    const demands = detectCapabilityDemands([
      node(CanonicalType.REQUIREMENT, 'a task must have a unique title'),
      node(CanonicalType.REQUIREMENT, 'users can delete a completed task'),
    ]);
    expect(demands).toEqual([]);
  });

  it('CONTEXT nodes never create demand — vision acknowledges, requirements demand', () => {
    const demands = detectCapabilityDemands([
      node(CanonicalType.CONTEXT, 'a pixel-art world with sprites and a game loop'),
    ]);
    expect(demands).toEqual([]);
  });
});
