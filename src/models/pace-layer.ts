/**
 * Pace Layer & Conservation Layer model.
 *
 * Different parts of a system change at different speeds.
 * A layer's rate of change is a function of its blast radius.
 * Conservation layers are surfaces where external trust accumulates.
 *
 * (See: Fowler, The Phoenix Architecture, Chapters 6 & 15)
 */

/**
 * Pace layer classification — slowest to fastest.
 *
 * Foundation: correctness is load-bearing (billing, fulfillment). Changes yearly.
 * Domain: event schemas, domain models. Changes quarterly.
 * Service: API shapes, integration contracts. Changes monthly.
 * Surface: UI, banners, display logic. Changes days-to-weeks.
 */
export type PaceLayer = 'foundation' | 'domain' | 'service' | 'surface';

/**
 * Extended IU metadata for pace-layer-aware regeneration.
 */
export interface PaceLayerMetadata {
  /** Which pace layer this IU occupies */
  pace_layer: PaceLayer;
  /** Is this a conservation layer? (external trust depends on stability) */
  conservation: boolean;
  /** Why this classification was chosen */
  classification_rationale: string;
  /** How many other IUs depend on this one's interface */
  dependency_weight: number;
  /** Expected change cadence */
  expected_change_cadence: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  /** Last classification review date */
  last_reviewed: string;
}

/**
 * Pace layer violation diagnostic
 */
export interface PaceLayerViolation {
  iu_id: string;
  iu_name: string;
  current_layer: PaceLayer;
  violation_type: 'regen_too_fast' | 'dependency_crosses_layer' | 'conservation_unprotected';
  message: string;
  recommended_action: string;
}

/**
 * Default pace layer metadata for an IU
 */
export function defaultPaceLayerMetadata(): PaceLayerMetadata {
  return {
    pace_layer: 'service',
    conservation: false,
    classification_rationale: 'Default classification — needs review',
    dependency_weight: 0,
    expected_change_cadence: 'monthly',
    last_reviewed: new Date().toISOString(),
  };
}

/**
 * Infer pace layer from dependency weight heuristic.
 * High dependency weight → slower layer.
 */
export function inferPaceLayer(dependencyWeight: number, hasExternalDependents: boolean): PaceLayer {
  if (hasExternalDependents || dependencyWeight >= 5) return 'foundation';
  if (dependencyWeight >= 3) return 'domain';
  if (dependencyWeight >= 1) return 'service';
  return 'surface';
}

/**
 * Check if a regeneration speed is appropriate for a pace layer.
 */
export function isPaceAppropriate(
  layer: PaceLayer,
  daysSinceLastRegen: number,
): boolean {
  const minimums: Record<PaceLayer, number> = {
    surface: 1,        // can regen daily
    service: 7,        // at most weekly
    domain: 30,        // at most monthly
    foundation: 90,    // at most quarterly
  };
  return daysSinceLastRegen >= minimums[layer];
}

/**
 * Layer ordering for comparison (lower = slower = more stable)
 */
const LAYER_ORDER: Record<PaceLayer, number> = {
  foundation: 0,
  domain: 1,
  service: 2,
  surface: 3,
};

/**
 * Check if a dependency crosses pace layers in the wrong direction
 * (fast layer depending on slow layer is fine; slow layer depending on fast layer is a violation)
 */
export function detectLayerCrossing(
  sourceLayer: PaceLayer,
  targetLayer: PaceLayer,
): PaceLayerViolation | null {
  if (LAYER_ORDER[sourceLayer] < LAYER_ORDER[targetLayer]) {
    return {
      iu_id: '',
      iu_name: '',
      current_layer: sourceLayer,
      violation_type: 'dependency_crosses_layer',
      message: `Slow layer (${sourceLayer}) depends on fast layer (${targetLayer}). ` +
        `This couples slow-changing logic to fast-changing implementation.`,
      recommended_action: `Introduce an interface boundary between the ${sourceLayer} and ${targetLayer} layers.`,
    };
  }
  return null;
}
