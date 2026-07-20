/**
 * Architecture fit — can the chosen target EXPRESS what the spec demands?
 *
 * The freeqworld lesson: a spec for a browser game went through the whole pipeline —
 * 131 modules, compile gate green, 100% extraction — and produced no game, because
 * every target in the vocabulary generates services and domain logic. The pipeline
 * built the checkable substrate and said NOTHING about the category of thing it
 * couldn't build. That is silent scope-narrowing: the same disease as a false green,
 * one level up.
 *
 * This gate closes it. Deterministic patterns detect requirement demands for
 * capabilities (interactive client, real-time presence, audio engine); the target
 * declares what it provides; the gap is reported as first-class diagnostics with
 * counts, samples, and spec provenance — BEFORE codegen spends a token. It never
 * blocks (warn-first, like the regeneration gate in alpha); it makes the narrowing
 * impossible to miss.
 */

import type { CanonicalNode } from './models/canonical.js';
import { CanonicalType } from './models/canonical.js';
import type { ResolvedTarget } from './models/architecture.js';

export interface CapabilityDemand {
  capability: string;
  /** Human phrasing for the report. */
  label: string;
  /** Requirement/constraint/invariant nodes demanding it (CONTEXT never counts). */
  nodeCount: number;
  samples: Array<{ statement: string; canon_id: string }>;
}

export interface ArchitectureFitReport {
  targetName: string;
  provided: string[];
  /** Demanded AND provided — fine. */
  covered: CapabilityDemand[];
  /** Demanded and NOT provided — the loud part. */
  outOfTarget: CapabilityDemand[];
}

/** What a service/API target provides when it declares nothing. */
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
    label: 'real-time bidirectional presence (live positions, websockets)',
    re: /\b(websocket|real[- ]?time|live (?:position|presence|cursor|update)|position (?:update|stream|broadcast)|presence (?:update|stream|channel)|updates? per second)\b/i,
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

/**
 * Assess fit: which demanded capabilities does the target not provide?
 */
export function assessArchitectureFit(
  canonNodes: CanonicalNode[],
  target: ResolvedTarget | null,
): ArchitectureFitReport {
  const provided = target?.architecture.capabilities ?? DEFAULT_SERVICE_CAPABILITIES;
  const targetName = target ? `${target.architecture.name}/${target.runtime.name}` : `(default service scaffold: ${DEFAULT_SERVICE_CAPABILITIES.join(', ')})`;
  const covered: CapabilityDemand[] = [];
  const outOfTarget: CapabilityDemand[] = [];
  for (const demand of detectCapabilityDemands(canonNodes)) {
    (provided.includes(demand.capability) ? covered : outOfTarget).push(demand);
  }
  return { targetName, provided, covered, outOfTarget };
}

/** Render the report as CLI lines (caller owns colors); empty array = full fit. */
export function formatFitReport(report: ArchitectureFitReport): string[] {
  if (report.outOfTarget.length === 0) return [];
  const lines: string[] = [];
  const total = report.outOfTarget.reduce((s, d) => s + d.nodeCount, 0);
  lines.push(`OUT OF TARGET: ${total} requirement(s) demand capabilities ${report.targetName} cannot express.`);
  lines.push(`These will NOT be satisfied by generated code — they remain open obligations, not silent omissions.`);
  for (const d of report.outOfTarget) {
    lines.push(`  ✖ ${d.label} — ${d.nodeCount} requirement(s)`);
    for (const s of d.samples) lines.push(`      · "${s.statement.slice(0, 100)}"`);
  }
  lines.push(`  → add an architecture that provides: ${report.outOfTarget.map(d => d.capability).join(', ')} (e.g. \`phoenix init --arch=browser-game\` for client-shaped specs)`);
  return lines;
}
