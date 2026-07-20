/**
 * Architecture adequacy — Step 0. Derive the system's SHAPE from the spec and resolve
 * an architecture that fits, BEFORE a single module is generated.
 *
 * This is the step Phoenix was missing. Architecture was a human flag or a silent
 * default, so the most consequential decision — what kind of system this is — was the
 * one thing NOT derived from the spec. The freeqworld run cascaded from exactly that:
 * a game spec generated against a service scaffold (131 services, no game), then
 * against an architecture that could express an interactive client but not compose one
 * (137 modules, soup). Both failures were an inadequate architecture, chosen blind.
 *
 * Adequacy has two axes, unifying the two downstream gates into one upstream question:
 *   - EXPRESSION  (was: architecture-fit gate) — can a module hold code for this demand?
 *   - COMPOSITION (was: assembly gate)          — is there a mechanism to assemble a
 *                                                 coherent whole for it?
 * An architecture is adequate for a spec iff every DEMANDED distinguishing capability
 * is both expressed AND composed. Anything less halts with a precise gap — Phoenix does
 * not generate against an architecture it knows cannot produce the thing.
 *
 * It never SYNTHESIZES an architecture (that is trust-critical, hand-authored
 * infrastructure — the LLM must not write the thing that verifies the LLM). On no fit
 * it emits the SPECIFICATION of the architecture a human must author, and stops.
 */

import type { CanonicalNode } from './models/canonical.js';
import type { Architecture } from './models/architecture.js';
import { listArchitectureDefs } from './architectures/index.js';
import { detectCapabilityDemands, type CapabilityDemand } from './architecture-fit.js';

export interface ArchitectureAdequacy {
  name: string;
  adequate: boolean;
  /** Demanded, not even expressible by this architecture. */
  expressionGaps: CapabilityDemand[];
  /** Expressible by this architecture, but it has no composition mechanism for it —
   *  the soup case (generate modules, cannot assemble a coherent whole). */
  compositionGaps: CapabilityDemand[];
  /** Demanded distinguishing capabilities fully satisfied (expressed AND composed). */
  coveredCount: number;
  /** Capabilities it provides that the spec doesn't demand (tie-break: prefer minimal). */
  excess: number;
}

export interface NeededArchitectureSpec {
  shape: string;
  mustExpress: string[];
  mustCompose: string[];
  /** The nearest existing architecture to extend (most demanded capabilities expressed). */
  closest: string | null;
  closestGap: string;
}

export type AdequacyVerdict =
  | 'selected'           // no arch configured; a fitting one was derived and chosen
  | 'chosen-adequate'    // human configured an arch and it fits
  | 'chosen-inadequate'  // human configured an arch that cannot express/compose the spec
  | 'none-adequate';     // no registered architecture fits — one must be authored

export interface AdequacyResolution {
  demanded: CapabilityDemand[];
  candidates: ArchitectureAdequacy[];
  /** The architecture to build with, or null when none is adequate / chosen one isn't. */
  selected: string | null;
  /** What the human configured (may differ from selected). */
  configured: string | null;
  verdict: AdequacyVerdict;
  /** Present when verdict is 'none-adequate' (or the chosen one is inadequate). */
  needed?: NeededArchitectureSpec;
}

const BASELINE_DEFAULT = 'web-api';

function scoreArchitecture(arch: Architecture, demands: CapabilityDemand[]): ArchitectureAdequacy {
  const expressionGaps: CapabilityDemand[] = [];
  const compositionGaps: CapabilityDemand[] = [];
  for (const d of demands) {
    if (!arch.capabilities.includes(d.capability)) expressionGaps.push(d);
    else if (!arch.composes.includes(d.capability)) compositionGaps.push(d);
  }
  return {
    name: arch.name,
    adequate: expressionGaps.length === 0 && compositionGaps.length === 0,
    expressionGaps,
    compositionGaps,
    coveredCount: demands.length - expressionGaps.length - compositionGaps.length,
    excess: arch.capabilities.filter(c => !demands.some(d => d.capability === c)).length,
  };
}

function neededSpec(demands: CapabilityDemand[], candidates: ArchitectureAdequacy[]): NeededArchitectureSpec {
  // Closest = expresses the most demanded capabilities (best base to extend).
  const ranked = [...candidates].sort((a, b) =>
    (b.coveredCount + (demands.length - b.expressionGaps.length)) - (a.coveredCount + (demands.length - a.expressionGaps.length)));
  const closest = ranked[0];
  const gapText = closest
    ? [
        closest.expressionGaps.length ? `must add expression for ${closest.expressionGaps.map(d => d.capability).join(', ')}` : '',
        closest.compositionGaps.length ? `must add a composition mechanism for ${closest.compositionGaps.map(d => d.capability).join(', ')}` : '',
      ].filter(Boolean).join('; ')
    : 'no near architecture — author from scratch';
  return {
    shape: demands.map(d => d.label).join(' + '),
    mustExpress: demands.map(d => d.capability),
    mustCompose: demands.map(d => d.capability),
    closest: closest?.name ?? null,
    closestGap: gapText,
  };
}

/**
 * Resolve the architecture for a spec. Pure over (canon graph, configured arch name,
 * the registry). Deterministic; no LLM, no IO.
 */
export function resolveArchitectureAdequacy(
  canonNodes: CanonicalNode[],
  configured: string | null,
  archs: Architecture[] = listArchitectureDefs(),
): AdequacyResolution {
  const demanded = detectCapabilityDemands(canonNodes);
  const candidates = archs.map(a => scoreArchitecture(a, demanded));
  const byName = new Map(candidates.map(c => [c.name, c]));

  // Human configured an architecture: honor adequacy, don't override their choice.
  if (configured) {
    const c = byName.get(configured);
    if (c?.adequate) return { demanded, candidates, selected: configured, configured, verdict: 'chosen-adequate' };
    return {
      demanded, candidates, selected: null, configured, verdict: 'chosen-inadequate',
      needed: neededSpec(demanded, candidates),
    };
  }

  // No configured arch: derive one. Adequate set, best fit wins.
  const adequate = candidates.filter(c => c.adequate);
  if (adequate.length > 0) {
    adequate.sort((a, b) =>
      b.coveredCount - a.coveredCount ||          // most demand covered
      (a.name === BASELINE_DEFAULT ? -1 : b.name === BASELINE_DEFAULT ? 1 : 0) || // baseline wins ties (esp. the no-demand service case)
      a.excess - b.excess ||                      // then leanest fit
      (a.name < b.name ? -1 : 1));
    return { demanded, candidates, selected: adequate[0].name, configured: null, verdict: 'selected' };
  }

  return {
    demanded, candidates, selected: null, configured: null, verdict: 'none-adequate',
    needed: neededSpec(demanded, candidates),
  };
}

/** Render the resolution as CLI lines (caller owns color). */
export function formatAdequacy(res: AdequacyResolution): string[] {
  const lines: string[] = [];
  const demandStr = res.demanded.length ? res.demanded.map(d => d.capability).join(', ') : 'baseline service shape (no distinguishing capabilities)';
  lines.push(`Spec shape: ${demandStr}`);

  if (res.verdict === 'selected') {
    lines.push(`✔ Derived architecture: ${res.selected} (expresses and composes every demanded capability).`);
    return lines;
  }
  if (res.verdict === 'chosen-adequate') {
    lines.push(`✔ Configured architecture ${res.configured} is adequate (expresses and composes every demanded capability).`);
    return lines;
  }

  // Inadequate — the halting cases.
  const n = res.needed!;
  if (res.verdict === 'chosen-inadequate') {
    const c = res.candidates.find(x => x.name === res.configured)!;
    lines.push(`✖ Configured architecture ${res.configured} is NOT adequate for this spec:`);
    if (c.expressionGaps.length) lines.push(`    cannot EXPRESS: ${c.expressionGaps.map(d => `${d.capability} (${d.nodeCount} req)`).join(', ')}`);
    if (c.compositionGaps.length) lines.push(`    can express but cannot COMPOSE: ${c.compositionGaps.map(d => `${d.capability} (${d.nodeCount} req)`).join(', ')}`);
  } else {
    lines.push(`✖ No registered architecture is adequate for this spec's shape.`);
  }
  lines.push(`The architecture this spec needs:`);
  lines.push(`    shape:        ${n.shape}`);
  lines.push(`    must express: ${n.mustExpress.join(', ')}`);
  lines.push(`    must compose: ${n.mustCompose.join(', ')}`);
  if (n.closest) lines.push(`    nearest base: ${n.closest} — ${n.closestGap}`);
  lines.push(`Author it as a reusable architecture (as browser-game was), then re-run. Phoenix does not synthesize architectures — they are trust infrastructure.`);
  lines.push(`To generate anyway against the inadequate architecture (known-incoherent output), pass --accept-inadequate-architecture.`);
  return lines;
}
