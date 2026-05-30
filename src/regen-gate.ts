/**
 * Regeneration Gate — the accept decision between "generated" and "committed".
 *
 * Converts the Replacement Audit (audit.ts) and the regenerative-grain models
 * from after-the-fact *reports* into a *gate* in the regeneration path. Composes:
 *   - auditIU         → readiness + blockers (boundary, eval, blast, deletion, pace, mass, NK)
 *   - conceptual mass → ratchet check vs the previous cycle's stamped mass
 *
 * Alpha policy is WARN-FIRST: the gate never refuses a commit. It returns a
 * verdict that the caller stamps into the manifest and surfaces as warnings, so
 * readiness scores earn trust before the gate gains teeth. Flip `mode` to
 * 'block' per risk tier once scores are calibrated.
 * (See: Fowler, The Phoenix Architecture — "Trust > cleverness".)
 */

import type { ImplementationUnit } from './models/iu.js';
import type { EvaluationCoverage } from './models/evaluation.js';
import type { NegativeKnowledge } from './models/negative-knowledge.js';
import type { PaceLayerMetadata } from './models/pace-layer.js';
import { auditIU } from './audit.js';
import type { ReadinessLevel, AuditBlocker } from './audit.js';
import { computeConceptualMass, checkRatchet } from './models/conceptual-mass.js';

export type GateMode = 'warn' | 'block';

export interface GateVerdict {
  iu_id: string;
  iu_name: string;
  readiness: ReadinessLevel;
  score: number;
  mass: number;
  previous_mass?: number;
  mass_delta?: number;
  ratchet_violation: boolean;
  blockers: AuditBlocker[];
  /** Warn-first: always true in 'warn' mode. In 'block' mode, false on error blockers. */
  accepted: boolean;
}

export interface GateInput {
  iu: ImplementationUnit;
  allIUs: ImplementationUnit[];
  evalCoverage: EvaluationCoverage;
  negativeKnowledge: NegativeKnowledge[];
  paceLayer?: PaceLayerMetadata;
  /** Conceptual mass from the previous regeneration cycle (for the ratchet). */
  previousMass?: number;
  mode?: GateMode;
}

/**
 * Compute the conceptual mass of an IU from its contract, dependencies,
 * side channels, mapped canonical nodes, and output files.
 */
export function massOfIU(iu: ImplementationUnit): number {
  const sc = iu.boundary_policy.side_channels;
  const sideChannelCount =
    sc.databases.length + sc.queues.length + sc.caches.length +
    sc.config.length + sc.external_apis.length + sc.files.length;
  return computeConceptualMass({
    contract_inputs: iu.contract.inputs.length,
    contract_outputs: iu.contract.outputs.length,
    contract_invariants: iu.contract.invariants.length,
    dependency_count: iu.dependencies.length,
    side_channel_count: sideChannelCount,
    canon_node_count: iu.source_canon_ids.length,
    file_count: iu.output_files.length,
  });
}

/**
 * Run the regeneration gate on a single freshly-generated IU.
 */
export function gateIU(input: GateInput): GateVerdict {
  const mode = input.mode ?? 'warn';

  const audit = auditIU({
    iu: input.iu,
    allIUs: input.allIUs,
    evalCoverage: input.evalCoverage,
    paceLayer: input.paceLayer,
    negativeKnowledge: input.negativeKnowledge,
    previousMass: input.previousMass,
  });

  const mass = massOfIU(input.iu);
  const ratchetViolation = checkRatchet(mass, input.previousMass);
  const errorBlockers = audit.blockers.filter(b => b.severity === 'error');
  const accepted = mode === 'warn' ? true : errorBlockers.length === 0;

  return {
    iu_id: input.iu.iu_id,
    iu_name: input.iu.name,
    readiness: audit.readiness,
    score: audit.score,
    mass,
    previous_mass: input.previousMass,
    mass_delta: input.previousMass === undefined ? undefined : mass - input.previousMass,
    ratchet_violation: ratchetViolation,
    blockers: audit.blockers,
    accepted,
  };
}
