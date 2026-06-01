/**
 * Cascade Engine — propagates evidence failures through the IU dependency graph.
 *
 * When IU-X fails, dependent IU-Y must re-run:
 * - typecheck
 * - boundary checks
 * - relevant tagged tests
 */

import type { ImplementationUnit } from './models/iu.js';
import type { PolicyEvaluation, CascadeEvent, CascadeAction } from './models/evidence.js';

/**
 * Compute cascade effects from policy evaluation failures.
 */
export function computeCascade(
  evaluations: PolicyEvaluation[],
  ius: ImplementationUnit[],
): CascadeEvent[] {
  const events: CascadeEvent[] = [];
  const iuMap = new Map(ius.map(iu => [iu.iu_id, iu]));

  for (const eval_ of evaluations) {
    if (eval_.verdict === 'PASS') continue;

    const sourceIU = iuMap.get(eval_.iu_id);
    if (!sourceIU) continue;

    // Propagate through the FULL transitive closure (not just direct dependents);
    // getTransitiveDependents uses a visited set so dependents are de-duplicated.
    const affected = getTransitiveDependents(eval_.iu_id, ius)
      .map(id => iuMap.get(id))
      .filter((iu): iu is ImplementationUnit => iu !== undefined);
    if (affected.length === 0 && eval_.verdict !== 'FAIL') continue;

    const actions: CascadeAction[] = [];

    // Actions on the failed IU itself
    if (eval_.verdict === 'FAIL') {
      actions.push({
        iu_id: eval_.iu_id,
        iu_name: eval_.iu_name,
        action: 'BLOCK',
        reason: `Evidence failed: ${eval_.failed.join(', ')}`,
      });
    }

    // Actions on dependents
    for (const dep of affected) {
      actions.push({
        iu_id: dep.iu_id,
        iu_name: dep.name,
        action: 'RE_VALIDATE',
        reason: `Dependency ${eval_.iu_name} ${eval_.verdict === 'FAIL' ? 'failed' : 'incomplete'}; re-run typecheck + boundary + tagged tests`,
      });
    }

    events.push({
      source_iu_id: eval_.iu_id,
      source_iu_name: eval_.iu_name,
      failure_kind: eval_.verdict,
      affected_iu_ids: affected.map(a => a.iu_id),
      actions,
    });
  }

  return events;
}

/**
 * Get all IU IDs that are transitively affected by a failure.
 */
export function getTransitiveDependents(
  iuId: string,
  ius: ImplementationUnit[],
): string[] {
  const dependents = new Map<string, string[]>();
  for (const iu of ius) {
    for (const depId of iu.dependencies) {
      const list = dependents.get(depId) ?? [];
      list.push(iu.iu_id);
      dependents.set(depId, list);
    }
  }

  const visited = new Set<string>();
  const queue = [iuId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dep of (dependents.get(current) ?? [])) {
      queue.push(dep);
    }
  }

  visited.delete(iuId); // don't include the source
  return [...visited];
}
