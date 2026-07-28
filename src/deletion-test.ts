/**
 * The deletion test (book ch9) — "the smallest thing you can delete and replace while
 * still proving the system works." A single deletion reveals four properties:
 *
 *   boundary clarity    — which consumers break that the interface didn't declare
 *   evaluation coverage — does deleting it get noticed by any eval?
 *   coupling depth      — how far does the blast reach?
 *   replaceability      — can it be regenerated + verified without losing identity?
 *
 * This is the analysis core: pure over (IU, canon graph, eval-coverage predicate),
 * deterministic, hermetically testable. It derives consumers from the reference-
 * constraint graph (who references this IU's entities) and the declared dependency
 * graph; the gap between them IS the ch9 finding ("services fail that don't appear in
 * the component's consumer registry"). The CLI command layers an optional EMPIRICAL
 * pass on top — copy the project to a temp dir, delete the files, recompile, and fold
 * any newly-broken modules into the actual-consumer set — catching hidden coupling the
 * graph can't see. The command never touches the real project.
 */

import type { ImplementationUnit } from './models/iu.js';
import type { CanonicalNode } from './models/canonical.js';
import { mineEntityAttributes, extractConstraints } from './constraints/extract.js';
import { singular } from './iu-clusterer.js';

export type Replaceability = 'replaceable' | 'risky' | 'unverifiable';

export interface DeletionFinding {
  property: 'boundary' | 'evaluation' | 'coupling' | 'replaceability';
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface DeletionReport {
  iu: string;
  declaredConsumers: string[];
  actualConsumers: string[];
  /** Consumers the interface never declared — the boundary that exists in the running
   *  system but not in the architecture. */
  undeclaredConsumers: string[];
  evaluationCovered: boolean;
  couplingDepth: number;
  furthestConsumers: string[];
  replaceability: Replaceability;
  findings: DeletionFinding[];
}

function entityTokens(name: string): Set<string> {
  return new Set(name.toLowerCase().split(/[\s_/-]+/).map(t => singular(t)).filter(t => t.length > 2));
}

/**
 * consumersOf: for every IU, which IUs depend on it — via reference constraints
 * (someone constrains a relation targeting this IU's entity) and via declared
 * dependencies. Returns id→Set(id).
 */
function buildConsumerGraph(ius: ImplementationUnit[], canonNodes: CanonicalNode[]): {
  refConsumers: Map<string, Set<string>>;
  declaredConsumers: Map<string, Set<string>>;
} {
  const canonToIu = new Map<string, ImplementationUnit>();
  for (const iu of ius) for (const cid of iu.source_canon_ids) canonToIu.set(cid, iu);
  const tokensByIu = new Map(ius.map(iu => [iu.iu_id, entityTokens(iu.name)]));

  const attrs = mineEntityAttributes(ius, canonNodes, []);
  const { constraints } = extractConstraints(canonNodes, attrs);

  const refConsumers = new Map<string, Set<string>>(); // producer id → consumer ids
  for (const iu of ius) refConsumers.set(iu.iu_id, new Set());
  for (const c of constraints) {
    if (c.assertion.kind !== 'reference' || !c.assertion.target || !c.source.canon_id) continue;
    const target = singular(String(c.assertion.target).toLowerCase());
    const owner = canonToIu.get(c.source.canon_id); // the IU that OWNS this constraint (the consumer)
    if (!owner) continue;
    // Which producer IU owns the referenced entity?
    for (const producer of ius) {
      if (producer.iu_id === owner.iu_id) continue;
      if (tokensByIu.get(producer.iu_id)!.has(target)) refConsumers.get(producer.iu_id)!.add(owner.iu_id);
    }
  }

  const declaredConsumers = new Map<string, Set<string>>();
  for (const iu of ius) declaredConsumers.set(iu.iu_id, new Set());
  for (const iu of ius) {
    for (const dep of iu.dependencies ?? []) {
      const producer = ius.find(x => x.iu_id === dep || x.name === dep);
      if (producer) declaredConsumers.get(producer.iu_id)!.add(iu.iu_id);
    }
  }
  return { refConsumers, declaredConsumers };
}

/** Analyze deleting one IU. Pure and deterministic. */
export function analyzeDeletion(
  target: ImplementationUnit,
  ius: ImplementationUnit[],
  canonNodes: CanonicalNode[],
  isCovered: (iu: ImplementationUnit) => boolean,
): DeletionReport {
  const { refConsumers, declaredConsumers } = buildConsumerGraph(ius, canonNodes);
  const nameOf = new Map(ius.map(iu => [iu.iu_id, iu.name]));

  const actual = refConsumers.get(target.iu_id) ?? new Set<string>();
  const declared = declaredConsumers.get(target.iu_id) ?? new Set<string>();
  const undeclared = [...actual].filter(id => !declared.has(id));

  // Coupling depth: BFS over the reference-consumer graph from the target.
  let depth = 0;
  const furthest: string[] = [];
  {
    const seen = new Set<string>([target.iu_id]);
    let frontier = [...actual];
    let hop = 1;
    while (frontier.length > 0) {
      depth = hop;
      furthest.length = 0;
      const next: string[] = [];
      for (const id of frontier) {
        if (seen.has(id)) continue;
        seen.add(id);
        furthest.push(nameOf.get(id) ?? id);
        for (const c of refConsumers.get(id) ?? []) if (!seen.has(c)) next.push(c);
      }
      frontier = next;
      hop++;
      if (hop > 20) break; // cycle safety
    }
  }

  const covered = isCovered(target);
  const replaceability: Replaceability = !covered ? 'unverifiable' : undeclared.length > 0 ? 'risky' : 'replaceable';

  const findings: DeletionFinding[] = [];
  if (undeclared.length > 0) {
    findings.push({
      property: 'boundary', severity: 'error',
      message: `${undeclared.length} consumer(s) reference this module's entities but are not declared dependents: ${undeclared.map(id => nameOf.get(id) ?? id).join(', ')}. Extract the implicit contract into an explicit one.`,
    });
  }
  if (!covered) {
    findings.push({
      property: 'evaluation', severity: 'warning',
      message: `no evaluation covers this module — deleting it would go unnoticed. Either it's dead weight (compaction candidate) or an evaluation gap; determine which.`,
    });
  }
  if (depth >= 3) {
    findings.push({
      property: 'coupling', severity: 'warning',
      message: `blast reaches ${depth} hops (furthest: ${furthest.slice(0, 3).join(', ')}) — coupling is deeper than direct dependents; introduce explicit interfaces at each hop.`,
    });
  }
  findings.push({
    property: 'replaceability', severity: replaceability === 'replaceable' ? 'info' : 'warning',
    message: replaceability === 'replaceable'
      ? `replaceable: covered by evals, no undeclared consumers — regenerate with confidence.`
      : replaceability === 'risky'
        ? `risky: covered, but undeclared consumers mean a regenerated equivalent could break them silently.`
        : `unverifiable: no eval coverage — a regenerated replacement can't be proven equivalent.`,
  });

  return {
    iu: target.name,
    declaredConsumers: [...declared].map(id => nameOf.get(id) ?? id),
    actualConsumers: [...actual].map(id => nameOf.get(id) ?? id),
    undeclaredConsumers: undeclared.map(id => nameOf.get(id) ?? id),
    evaluationCovered: covered,
    couplingDepth: depth,
    furthestConsumers: furthest,
    replaceability,
    findings,
  };
}

/** Repo-level replaceability scorecard (the ch9 "spectrum of regenerative capability"). */
export function deletionScorecard(
  ius: ImplementationUnit[],
  canonNodes: CanonicalNode[],
  isCovered: (iu: ImplementationUnit) => boolean,
): { replaceable: number; risky: number; unverifiable: number; reports: DeletionReport[] } {
  const reports = ius.map(iu => analyzeDeletion(iu, ius, canonNodes, isCovered));
  return {
    replaceable: reports.filter(r => r.replaceability === 'replaceable').length,
    risky: reports.filter(r => r.replaceability === 'risky').length,
    unverifiable: reports.filter(r => r.replaceability === 'unverifiable').length,
    reports,
  };
}
