/**
 * Capability demand detection — what SHAPE does the spec demand?
 *
 * Deterministic patterns read the canon graph for distinguishing capabilities
 * (interactive client, real-time presence, audio engine). This is the input to Step
 * 0's architecture-adequacy resolution (`architecture-adequacy.ts`), which decides
 * whether a registered architecture can both EXPRESS and COMPOSE those demands, and
 * halts if none can. (This module used to also host a one-axis "fit" report; that was
 * collapsed into adequacy — one architecture verdict, two axes, delivered once.)
 *
 * The freeqworld lesson that motivated it: a browser-game spec ran the whole pipeline
 * — 131 modules, compile gate green — and produced no game, because nothing detected
 * that the product's shape was outside the target's vocabulary. Silent scope-narrowing
 * is a false green one level up; detecting the demand is how it's closed.
 */

import type { CanonicalNode } from './models/canonical.js';
import { CanonicalType } from './models/canonical.js';

export interface CapabilityDemand {
  capability: string;
  /** Human phrasing for the report. */
  label: string;
  /** Requirement/constraint/invariant nodes demanding it (CONTEXT never counts). */
  nodeCount: number;
  samples: Array<{ statement: string; canon_id: string }>;
}

/** What a service/API target provides when it declares nothing (the baseline floor). */
export const DEFAULT_SERVICE_CAPABILITIES = ['http-api', 'domain-logic', 'persistence'];

/**
 * The demand vocabulary. Deterministic and recall-leaning: a diagnostic that
 * over-fires with receipts beats a silent gap. Tuned on the freeqworld canon.
 */
const CAPABILITY_PATTERNS: Array<{ capability: string; label: string; re: RegExp }> = [
  {
    capability: 'interactive-client',
    label: 'an interactive rendered client (canvas/sprites/world navigation)',
    re: /\b(canvas|pixel[- ]?art|sprite|game[- ]?loop|top[- ]?down|tile[- ]?based|walkable|scanline|render(?:s|ing)? the world|mov(?:e|es|ing) (?:their |the |an? )?(?:avatar|character)|arrow[- ]key|tap[- ]to[- ]move|world view|camera (?:must|follows)|animation frame)\b/i,
  },
  {
    capability: 'realtime-presence',
    label: 'live external integration (connect to a service; subscribe/publish; presence)',
    re: /\b(websocket|web socket|real[- ]?time|live (?:position|presence|cursor|update|chat|data)|subscribe(?:s|d)?\s+to|publish(?:es|ed)?\s+to|over a socket|connect(?:s|ed|ing)?\s+to the (?:service|server|socket|channel)|real client|other (?:connected )?clients?|channel on the|position (?:update|stream|broadcast)|presence|updates? per second)\b/i,
  },
  {
    capability: 'audio-engine',
    label: 'a client-side audio/music engine',
    re: /\b(web audio|audio engine|music engine|chiptune|soundtrack|leitmotif|schedule[sd]? musical|adaptive music|synthesi[sz]e[sd]? (?:audio|music|sound))\b/i,
  },
];

const SAMPLES_PER_CAPABILITY = 3;

/**
 * Detect which DISTINGUISHING capabilities the spec demands (interactive-client,
 * realtime-presence, audio-engine). Only normative nodes create demand — vision
 * context acknowledges an aspiration; a requirement demands construction. The baseline
 * service capabilities (http-api/domain-logic/persistence) are assumed, not detected:
 * they are the floor, not what separates one architecture from another.
 */
export function detectCapabilityDemands(canonNodes: CanonicalNode[]): CapabilityDemand[] {
  const normative = canonNodes.filter(n =>
    n.type === CanonicalType.REQUIREMENT || n.type === CanonicalType.CONSTRAINT || n.type === CanonicalType.INVARIANT);
  const demands: CapabilityDemand[] = [];
  for (const { capability, label, re } of CAPABILITY_PATTERNS) {
    const hits = normative.filter(n => re.test(n.statement));
    if (hits.length === 0) continue;
    demands.push({
      capability, label,
      nodeCount: hits.length,
      samples: hits.slice(0, SAMPLES_PER_CAPABILITY).map(n => ({ statement: n.statement, canon_id: n.canon_id })),
    });
  }
  return demands;
}

