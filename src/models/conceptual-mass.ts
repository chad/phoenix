/**
 * Conceptual Mass model — cognitive burden measurement.
 *
 * "Volume is cheap. Cognitive load compounds."
 * Conceptual mass is the total cognitive burden a system imposes:
 * distinct concepts, interdependencies, and hidden behaviors that
 * a person must hold in mind to work safely.
 *
 * (See: Fowler, The Phoenix Architecture, Chapter 10)
 */

export interface ConceptualMassReport {
  iu_id: string;
  iu_name: string;
  /** Count of distinct types/interfaces in the IU contract */
  contract_concepts: number;
  /** Count of dependencies (other IUs) */
  dependency_count: number;
  /** Count of side-channel dependencies */
  side_channel_count: number;
  /** Count of canonical nodes mapped to this IU */
  canon_node_count: number;
  /** Count of output files */
  file_count: number;
  /** Total conceptual mass score */
  mass: number;
  /** Pairwise interaction potential: mass * (mass - 1) / 2 */
  interaction_potential: number;
  /** Previous mass (from last regen cycle), if available */
  previous_mass?: number;
  /** Delta from previous cycle */
  mass_delta?: number;
  /** Whether this violates the ratchet rule */
  ratchet_violation: boolean;
}

/**
 * Compute conceptual mass for an IU.
 * Mass = contract_concepts + dependency_count + side_channel_count + canon_node_count
 *
 * This is a proxy for "how many distinct concepts must someone hold in mind
 * to change this safely?"
 */
export function computeConceptualMass(params: {
  contract_inputs: number;
  contract_outputs: number;
  contract_invariants: number;
  dependency_count: number;
  side_channel_count: number;
  canon_node_count: number;
  file_count: number;
}): number {
  const contractConcepts = params.contract_inputs + params.contract_outputs + params.contract_invariants;
  return contractConcepts + params.dependency_count + params.side_channel_count + params.canon_node_count;
}

/**
 * Compute pairwise interaction potential.
 * n concepts → n*(n-1)/2 potential interactions.
 */
export function interactionPotential(mass: number): number {
  return mass > 1 ? (mass * (mass - 1)) / 2 : 0;
}

/**
 * Check the ratchet rule: mass cannot grow across two consecutive
 * regeneration cycles without explicit justification.
 */
export function checkRatchet(currentMass: number, previousMass: number | undefined): boolean {
  if (previousMass === undefined) return false; // no previous data, no violation
  return currentMass > previousMass;
}

/**
 * Default mass budget thresholds.
 * Based on working memory limits (~4-7 chunks).
 */
export const MASS_THRESHOLDS = {
  /** Ideal: one person can hold it all */
  healthy: 7,
  /** Caution: approaching cognitive limit */
  warning: 12,
  /** Danger: exceeds working memory */
  danger: 20,
} as const;
