/**
 * The repair loop (P1) — the judge coaches the contestant.
 *
 * Today the pipeline is generate → verify → tell the human; the fix already sits in the
 * diagnostics and the human applies it. This closes the loop: verifier findings feed
 * regeneration automatically. After codegen + the compile gate, run the verifiers, route
 * each ERROR finding to the generated artifact that owns it, regenerate exactly those
 * artifacts with the findings (+ recommended actions, VERBATIM) in the prompt, and
 * re-verify — bounded, journaled, and honest about what remains.
 *
 * HARD RULE: the verifiers are the ORACLE and are FROZEN to the loop. Repair changes
 * GENERATED CODE only. Nothing here may edit a checker, a constraint, the spec, or an
 * eval to reach green. Termination is bounded (default 3 rounds); not-green-after-N is a
 * reportable outcome, never a silent success and never an infinite loop.
 *
 * The mechanics (finding→artifact routing, prompt assembly, re-verify, stop conditions,
 * journaling) are fully decoupled from the LLM: `runRepairLoop` takes an injected
 * `verify`, an injected `repairer`, and injected source read/write. Unit tests drive it
 * with a scripted repairer over fault-injected projects; the real path injects the LLM
 * generator as the repairer. Same loop, different repairer.
 */

import type { ImplementationUnit } from './models/iu.js';
import type { RepairFinding } from './models/repair.js';
import { MIGRATIONS_TARGET } from './models/repair.js';

/** A repairer takes an IU, the findings against it, and its current source, and returns
 *  the corrected source. Injectable so the loop is testable without an LLM. */
export type Repairer = (
  iu: RepairTarget,
  findings: RepairFinding[],
  source: string,
) => Promise<string> | string;

/**
 * A thing the loop can regenerate: a real IU, or the synthetic migrations artifact. Both
 * expose an id and the file the repairer rewrites, so routing is uniform.
 */
export interface RepairTarget {
  id: string;
  /** Repo-relative primary file this target owns. */
  file: string;
  /** The real IU when this target is a module; absent for the migrations artifact. */
  iu?: ImplementationUnit;
}

export interface RepairRound {
  round: number;
  findingsBefore: number;
  /** Ids of the targets regenerated this round. */
  regenerated: string[];
  /** Per-target artifact identity before→after (provenance, gate 5). */
  changes: Array<{ id: string; file: string; before: string; after: string; findings: number }>;
  findingsAfter: number;
}

export interface RepairLoopResult {
  rounds: RepairRound[];
  /** ERROR findings remaining after the final round (the honest residual). */
  residual: RepairFinding[];
  /** True iff the final verify produced zero ERROR findings. */
  green: boolean;
  /** Why the loop stopped: 'green' | 'budget' | 'unroutable' | 'stalled'. */
  stop: 'green' | 'budget' | 'unroutable' | 'stalled';
}

export interface RepairLoopContext {
  targets: RepairTarget[];
  /** Run every verifier and return the current ERROR findings. FROZEN — never mutated. */
  verify: () => RepairFinding[] | Promise<RepairFinding[]>;
  /** Read a target's current source. */
  readSource: (t: RepairTarget) => string;
  /** Persist a target's repaired source (and any per-write bookkeeping). */
  writeSource: (t: RepairTarget, source: string) => void | Promise<void>;
  /** The repairer (scripted in tests, LLM in production). */
  repairer: Repairer;
  /** Content identity of a target's current artifact (for the before→after journal). */
  artifactHash: (t: RepairTarget) => string;
  /** Max rounds (default 3). Not-green-after-N is honest, not a failure to hide. */
  maxRounds?: number;
  /** Journal one repair round (provenance). */
  onRound?: (round: RepairRound) => void;
  /** Progress reporting (per round, per target). */
  onProgress?: (event: { kind: 'round-start' | 'target' | 'round-end'; round: number; message: string }) => void;
}

/**
 * Route ERROR findings to the target that owns them. Schema/constraint findings carry an
 * `iu_id`; build findings carry a `file`; migration-artifact findings carry the synthetic
 * MIGRATIONS_TARGET id (or the migrations file). Findings that route to no known target
 * are returned as `unroutable` — an honest dead end, not a silent drop.
 */
export function routeFindings(
  findings: RepairFinding[],
  targets: RepairTarget[],
): { byTarget: Map<string, RepairFinding[]>; unroutable: RepairFinding[] } {
  const byId = new Map(targets.map(t => [t.id, t]));
  const byFile = new Map(targets.map(t => [t.file, t]));
  const byTarget = new Map<string, RepairFinding[]>();
  const unroutable: RepairFinding[] = [];
  const push = (id: string, f: RepairFinding) => {
    (byTarget.get(id) ?? byTarget.set(id, []).get(id)!).push(f);
  };
  for (const f of findings) {
    let t: RepairTarget | undefined;
    if (f.iu_id === MIGRATIONS_TARGET) t = byId.get(MIGRATIONS_TARGET);
    else if (f.iu_id) t = byId.get(f.iu_id);
    if (!t && f.file) t = byFile.get(f.file);
    if (t) push(t.id, f);
    else unroutable.push(f);
  }
  return { byTarget, unroutable };
}

/**
 * Run the bounded repair loop. Each round: verify → route ERROR findings → regenerate
 * each offending target with its findings → re-verify. Stops when findings hit zero
 * (green), when no finding routes to a target (unroutable), when a round changed nothing
 * (stalled), or at the round budget (budget).
 */
export async function runRepairLoop(ctx: RepairLoopContext): Promise<RepairLoopResult> {
  const maxRounds = ctx.maxRounds ?? 3;
  const rounds: RepairRound[] = [];
  let residual = await Promise.resolve(ctx.verify());
  let stop: RepairLoopResult['stop'] = 'green';

  for (let round = 1; round <= maxRounds; round++) {
    if (residual.length === 0) { stop = 'green'; break; }

    const { byTarget, unroutable } = routeFindings(residual, ctx.targets);
    if (byTarget.size === 0) {
      // Nothing the loop can act on — every remaining finding is unroutable.
      stop = 'unroutable';
      break;
    }
    ctx.onProgress?.({ kind: 'round-start', round, message: `${residual.length} finding(s) → ${byTarget.size} target(s)` });

    // Snapshot every target this round will rewrite, so a round that makes things WORSE
    // can be rolled back (the finding count must never grow round over round).
    const snapshots = new Map<string, string>();
    for (const [id] of byTarget) snapshots.set(id, ctx.readSource(ctx.targets.find(t => t.id === id)!));

    const changes: RepairRound['changes'] = [];
    for (const [id, findings] of byTarget) {
      const target = ctx.targets.find(t => t.id === id)!;
      const before = ctx.artifactHash(target);
      const source = ctx.readSource(target);
      const repaired = await Promise.resolve(ctx.repairer(target, findings, source));
      await Promise.resolve(ctx.writeSource(target, repaired));
      const after = ctx.artifactHash(target);
      changes.push({ id, file: target.file, before, after, findings: findings.length });
      ctx.onProgress?.({ kind: 'target', round, message: `${target.iu?.name ?? target.file}: ${findings.length} finding(s)` });
    }

    const findingsAfter = await Promise.resolve(ctx.verify());

    // Oscillation guard (false-green=0's convergence invariant): a round that INCREASED the
    // finding count is not progress — it is the afterimage-style oscillation where a
    // regeneration clears some findings and surfaces more. Roll the round back to its
    // snapshot so the count can never grow, and stop honestly rather than thrash the budget.
    if (findingsAfter.length > residual.length) {
      for (const [id, src] of snapshots) await Promise.resolve(ctx.writeSource(ctx.targets.find(t => t.id === id)!, src));
      const reverted: RepairRound = { round, findingsBefore: residual.length, regenerated: changes.map(c => c.id), changes, findingsAfter: residual.length };
      rounds.push(reverted);
      ctx.onRound?.(reverted);
      ctx.onProgress?.({ kind: 'round-end', round, message: `${residual.length} → ${findingsAfter.length} finding(s) — round REVERTED (count increased), stopping` });
      stop = 'stalled';
      break;
    }

    const roundResult: RepairRound = {
      round,
      findingsBefore: residual.length,
      regenerated: changes.map(c => c.id),
      changes,
      findingsAfter: findingsAfter.length,
    };
    rounds.push(roundResult);
    ctx.onRound?.(roundResult);
    ctx.onProgress?.({ kind: 'round-end', round, message: `${roundResult.findingsBefore} → ${roundResult.findingsAfter} finding(s), ${changes.length} regenerated` });

    // Stalled: a full round changed no artifact AND the finding count did not drop — the
    // repairer is not making progress, so stop rather than burn the remaining budget.
    const noArtifactChange = changes.every(c => c.before === c.after);
    if (noArtifactChange && findingsAfter.length >= residual.length) {
      residual = findingsAfter;
      stop = 'stalled';
      break;
    }

    residual = findingsAfter;
    if (residual.length === 0) { stop = 'green'; break; }
    if (round === maxRounds) stop = 'budget';
  }

  return { rounds, residual, green: residual.length === 0, stop };
}
