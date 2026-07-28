/**
 * Regenerative grain assessment (book ch12) — measured, conservative, deterministic.
 *
 * Pins: monolith (too big / too many entities) and fragment (nothing to verify) are
 * flagged; a small sharp single-entity module is NOT a fragment (no false positives on
 * legit small specs); and the over-fragmentation pathology (one entity spread across
 * many IUs — freeqworld's actual grain failure) is caught at the plan level.
 */

import { describe, it, expect } from 'vitest';
import { assessGrain, assessPlanGrain, GRAIN_MAX_NODES } from '../../src/grain-policy.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CanonicalType } from '../../src/models/canonical.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

let seq = 0;
function iu(name: string, nodeIds: string[]): ImplementationUnit {
  return {
    iu_id: 'iu-' + name.replace(/\s+/g, '-') + '-' + seq++, kind: 'module', name, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: nodeIds, dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: [`src/generated/x/x.ts`],
  };
}
let nid = 0;
function nodes(type: CanonicalType, n: number): CanonicalNode[] {
  return Array.from({ length: n }, () => ({ canon_id: 'n' + nid++, type, statement: 's', source_clause_ids: [], linked_canon_ids: [], tags: [] } as unknown as CanonicalNode));
}

describe('assessGrain (per IU)', () => {
  it('a small single-entity module with a constraint is OK, not a fragment', () => {
    const ns = nodes(CanonicalType.CONSTRAINT, 2);
    const a = assessGrain(iu('habit', ns.map(n => n.canon_id)), new Map(ns.map(n => [n.canon_id, n])));
    expect(a.verdict).toBe('ok');
  });

  it('a lone node with nothing normative is a fragment', () => {
    const ns = nodes(CanonicalType.CONTEXT, 1);
    const a = assessGrain(iu('blurb', ns.map(n => n.canon_id)), new Map(ns.map(n => [n.canon_id, n])));
    expect(a.verdict).toBe('fragment');
  });

  it('exceeding the node ceiling is a monolith', () => {
    const ns = nodes(CanonicalType.REQUIREMENT, GRAIN_MAX_NODES + 5);
    const a = assessGrain(iu('everything', ns.map(n => n.canon_id)), new Map(ns.map(n => [n.canon_id, n])));
    expect(a.verdict).toBe('monolith');
    expect(a.reason).toMatch(/blast-radius ceiling/);
  });

  it('owning too many distinct entities is a monolith', () => {
    const ns = nodes(CanonicalType.REQUIREMENT, 4);
    const a = assessGrain(iu('room channel avatar message', ns.map(n => n.canon_id)), new Map(ns.map(n => [n.canon_id, n])));
    expect(a.verdict).toBe('monolith');
    expect(a.reason).toMatch(/distinct entities/);
  });
});

describe('assessPlanGrain (cross-IU over-fragmentation)', () => {
  it("flags an entity spread across many IUs — freeqworld's real pathology", () => {
    const ns = nodes(CanonicalType.REQUIREMENT, 2);
    const nodeIds = ns.map(n => n.canon_id);
    const ius = [
      iu('agent event', nodeIds), iu('agent room', nodeIds), iu('agent message', nodeIds), iu('agent object', nodeIds),
      iu('room', nodeIds), // a single-entity IU, not over-fragmented
    ];
    const report = assessPlanGrain(ius, ns);
    const agent = report.overFragmented.find(e => e.entity === 'agent');
    expect(agent).toBeDefined();
    expect(agent!.ius.length).toBe(4);
    expect(report.overFragmented.find(e => e.entity === 'room')).toBeUndefined(); // 1 IU → not flagged
  });

  it('a clean small plan (one IU per entity) reports zero grain issues — no false positives', () => {
    const ns = nodes(CanonicalType.CONSTRAINT, 2);
    const ids = ns.map(n => n.canon_id);
    const report = assessPlanGrain([iu('habit', ids), iu('user', ids), iu('reminder', ids)], ns);
    expect(report.ok).toBe(3);
    expect(report.fragments).toHaveLength(0);
    expect(report.monoliths).toHaveLength(0);
    expect(report.overFragmented).toHaveLength(0);
  });
});
