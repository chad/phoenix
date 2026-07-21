/**
 * Pace-layer classification — derived from the spec, not guessed.
 *
 * The book (ch6): "pace-layer identification becomes the first architectural act...
 * A layer's rate of change is a function of its blast radius." (ch16): the user-facing
 * layer is a CONSERVATION layer — where external trust accumulates; it changes slowest.
 *
 * Phoenix had the model (`models/pace-layer.ts`) and never populated it — every
 * regeneration-gate report said "no pace layer classification." This computes it
 * deterministically from signals already in the graph:
 *
 *   - dependency weight = how many reference constraints across the whole spec point
 *     INTO an IU's entities (the book's "how many components depend on its behavior").
 *   - load-bearing correctness = the IU carries invariants (ch6's fulfillment-engine
 *     signal: correctness others rely on → slow layer).
 *   - conservation = the IU is the user-facing surface (ch16).
 *
 * No LLM, no dates, no IO — pure over (IUs, canon graph), so it is hermetically
 * testable and stable across runs.
 */

import type { ImplementationUnit } from './models/iu.js';
import type { CanonicalNode } from './models/canonical.js';
import type { PaceLayer, PaceLayerMetadata } from './models/pace-layer.js';
import { inferPaceLayer } from './models/pace-layer.js';
import { mineEntityAttributes, extractConstraints } from './constraints/extract.js';
import { isUiIU } from './regen.js';
import { singular } from './iu-clusterer.js';

const CADENCE: Record<PaceLayer, PaceLayerMetadata['expected_change_cadence']> = {
  foundation: 'yearly',
  domain: 'quarterly',
  service: 'monthly',
  surface: 'weekly',
};

/** Split an IU name into singularized entity tokens ("room channel" → [room, channel]). */
function entityTokens(name: string): string[] {
  return name.toLowerCase().split(/[\s_/-]+/).map(t => singular(t)).filter(t => t.length > 2);
}

/**
 * Classify every IU's pace layer + conservation status. Returns the map the audit and
 * regeneration gate consume (previously always empty).
 */
export function classifyPaceLayers(
  ius: ImplementationUnit[],
  canonNodes: CanonicalNode[],
): Map<string, PaceLayerMetadata> {
  // Reference in-weight per entity: how many constraints reference each entity.
  const attrs = mineEntityAttributes(ius, canonNodes, []);
  const { constraints } = extractConstraints(canonNodes, attrs);
  const refWeight = new Map<string, number>();
  for (const c of constraints) {
    if (c.assertion.kind === 'reference' && c.assertion.target) {
      const t = singular(String(c.assertion.target).toLowerCase());
      refWeight.set(t, (refWeight.get(t) ?? 0) + 1);
    }
  }

  const out = new Map<string, PaceLayerMetadata>();
  for (const iu of ius) {
    const tokens = entityTokens(iu.name);
    const weight = tokens.reduce((s, t) => s + (refWeight.get(t) ?? 0), 0);
    const invariantCount = iu.contract?.invariants?.length ?? 0;
    const ui = isUiIU(iu);

    let layer: PaceLayer;
    let rationale: string;
    if (ui) {
      // ch16: the user-facing surface is the conservation layer — trust lives here.
      layer = 'surface';
      rationale = 'user-facing surface — the conservation layer (ch16): external trust depends on its visible stability';
    } else {
      // ch6: dependency weight + load-bearing correctness set the pace.
      const loadBearing = invariantCount > 0 && weight >= 1;
      layer = inferPaceLayer(weight, loadBearing);
      rationale = `${weight} reference(s) point into this module's entit${weight === 1 ? 'y' : 'ies'}`
        + (invariantCount > 0 ? `; carries ${invariantCount} invariant(s) — load-bearing correctness` : '');
    }

    out.set(iu.iu_id, {
      pace_layer: layer,
      conservation: ui,
      classification_rationale: rationale,
      dependency_weight: weight,
      expected_change_cadence: CADENCE[layer],
      last_reviewed: '', // auto-classification is not a human review (ch6: recurring work)
    });
  }
  return out;
}
