/**
 * Regenerative grain assessment (book ch12).
 *
 * "The regenerative grain isn't the smallest thing you can deploy. It's the smallest
 * thing you can delete and replace while still proving the system works." Three
 * properties: evaluability at the boundary, bounded blast radius, no shared mutable
 * state.
 *
 * Phoenix set grain by a token budget (`MAX_CLUSTER` in iu-clusterer.ts) and produced
 * 130 one-module services and 137 game fragments. This makes grain a MEASURED,
 * reported dimension with book-faithful verdicts — the honest first move (the same
 * discipline as pace layers: measure before you mutate). Re-clustering by these
 * verdicts (merge fragments, split monoliths by owned entity) is the documented
 * follow-on; doing it blind risks false-positiving legit small IUs, so this v1 only
 * FLAGS the two unambiguous pathologies and leaves the operator (or the next
 * workstream) to act.
 *
 * Pure over (IU, canon graph). Deterministic. Conservative on purpose: a 2–3 node
 * entity IU with a constraint is a fine grain, NOT a fragment.
 */

import type { ImplementationUnit } from './models/iu.js';
import type { CanonicalNode } from './models/canonical.js';
import { CanonicalType } from './models/canonical.js';
import { singular } from './iu-clusterer.js';

export type GrainVerdict = 'ok' | 'fragment' | 'monolith';

export interface GrainAssessment {
  iu_id: string;
  name: string;
  verdict: GrainVerdict;
  nodeCount: number;
  normativeCount: number;
  entityCount: number;
  reason: string;
}

// Blast-radius ceiling — above this a module can't be reasoned about or regenerated
// as one prompt (mirrors iu-clusterer's MAX_CLUSTER; kept in sync deliberately).
export const GRAIN_MAX_NODES = 24;
// A module owning more than this many distinct domain entities is doing too much.
export const GRAIN_MAX_ENTITIES = 3;

const NORMATIVE = new Set([CanonicalType.REQUIREMENT, CanonicalType.CONSTRAINT, CanonicalType.INVARIANT]);

/** Distinct singularized entity tokens an IU's name lays claim to. */
function entityCountOf(name: string): number {
  return new Set(name.toLowerCase().split(/[\s_/-]+/).map(t => singular(t)).filter(t => t.length > 2)).size;
}

/**
 * Assess one IU's grain. Conservative: flags only clear pathologies —
 *   monolith  = too many nodes, or owns too many distinct entities (blast radius);
 *   fragment  = a lone node with nothing to form an evaluable boundary contract;
 *   ok        = everything else (including small, sharp, single-entity modules).
 */
export function assessGrain(iu: ImplementationUnit, canonById: Map<string, CanonicalNode>): GrainAssessment {
  const nodes = iu.source_canon_ids.map(id => canonById.get(id)).filter((n): n is CanonicalNode => !!n);
  const nodeCount = nodes.length;
  const normativeCount = nodes.filter(n => NORMATIVE.has(n.type)).length;
  const entityCount = entityCountOf(iu.name);

  let verdict: GrainVerdict = 'ok';
  let reason = `${nodeCount} node(s), ${normativeCount} normative, ${entityCount} entit${entityCount === 1 ? 'y' : 'ies'}`;

  if (nodeCount > GRAIN_MAX_NODES || entityCount > GRAIN_MAX_ENTITIES) {
    verdict = 'monolith';
    reason = nodeCount > GRAIN_MAX_NODES
      ? `${nodeCount} nodes exceeds the ${GRAIN_MAX_NODES}-node blast-radius ceiling — split by owned entity`
      : `owns ${entityCount} distinct entities (>${GRAIN_MAX_ENTITIES}) — split so each module owns one`;
  } else if (nodeCount <= 1 || normativeCount === 0) {
    verdict = 'fragment';
    reason = normativeCount === 0
      ? `no normative nodes — nothing to verify at its boundary; fold into the entity it concerns`
      : `a single node — too little to form an evaluable boundary contract; fold into a neighbor`;
  }
  return { iu_id: iu.iu_id, name: iu.name, verdict, nodeCount, normativeCount, entityCount, reason };
}

/** The head (primary) entity token of an IU name ("agent event" → "agent"). */
export function headEntity(name: string): string {
  const toks = name.toLowerCase().split(/[\s_/-]+/).map(t => singular(t)).filter(t => t.length > 2);
  return toks[0] ?? name.toLowerCase();
}

// A domain entity split across more than this many IUs is over-fragmented — the
// facets ("agent event", "agent room", "agent message") likely belong to fewer,
// evaluable modules. Reported, not auto-merged.
export const GRAIN_MAX_IUS_PER_ENTITY = 2;

export interface OverFragmentedEntity {
  entity: string;
  ius: string[];
  totalNodes: number;
}

export interface GrainReport {
  assessments: GrainAssessment[];
  ok: number;
  fragments: GrainAssessment[];
  monoliths: GrainAssessment[];
  /** Entities spread across too many IUs — the over-fragmentation pathology. */
  overFragmented: OverFragmentedEntity[];
}

/** Assess the whole plan: per-IU verdicts + cross-IU entity spread. */
export function assessPlanGrain(ius: ImplementationUnit[], canonNodes: CanonicalNode[]): GrainReport {
  const byId = new Map(canonNodes.map(n => [n.canon_id, n]));
  const assessments = ius.map(iu => assessGrain(iu, byId));

  // Cross-IU: group by head entity; flag entities spread across many IUs.
  const byEntity = new Map<string, ImplementationUnit[]>();
  for (const iu of ius) {
    const h = headEntity(iu.name);
    (byEntity.get(h) ?? byEntity.set(h, []).get(h)!).push(iu);
  }
  const overFragmented: OverFragmentedEntity[] = [];
  for (const [entity, group] of byEntity) {
    if (group.length > GRAIN_MAX_IUS_PER_ENTITY) {
      overFragmented.push({
        entity,
        ius: group.map(i => i.name),
        totalNodes: group.reduce((s, i) => s + i.source_canon_ids.length, 0),
      });
    }
  }
  overFragmented.sort((a, b) => b.ius.length - a.ius.length);

  return {
    assessments,
    ok: assessments.filter(a => a.verdict === 'ok').length,
    fragments: assessments.filter(a => a.verdict === 'fragment'),
    monoliths: assessments.filter(a => a.verdict === 'monolith'),
    overFragmented,
  };
}
