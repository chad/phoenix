/**
 * Canonical Stability — a first-class trust metric (PRD §20).
 *
 * "If re-running canonicalization on an unchanged spec reshuffles the graph,
 *  every downstream hash churns and selective invalidation is meaningless."
 *
 * Stability is measured on the STABLE identity layer (canon_anchor = type +
 * domain tags), not on content hashes. Between two canonicalizations we ask:
 * what fraction of the previous run's anchors still exist? A spec that didn't
 * change should score ~1.0; a churny extractor (or a genuine large edit) scores
 * lower. Because the anchor survives rewording, a cosmetic edit does NOT tank
 * the score — only real structural change does.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CanonicalNode } from './models/canonical.js';

export interface StabilitySnapshot {
  computed_at: string;
  /** Multiset of canon_anchor values from the last canonicalization. */
  anchors: string[];
  /** The stability result of the most recent canonicalization (for status). */
  last_result?: StabilityResult;
}

export interface StabilityResult {
  /** Fraction of previous anchors still present (0..1). 1 = perfectly stable. */
  retention: number;
  /** Fraction of current anchors that are new (churn). */
  novelty: number;
  previous_count: number;
  current_count: number;
  kept: number;
  added: number;
  dropped: number;
  /** No prior snapshot to compare against (first canonicalization). */
  first_run: boolean;
}

export class CanonStabilityStore {
  private path: string;
  constructor(phoenixRoot: string) {
    mkdirSync(phoenixRoot, { recursive: true });
    this.path = join(phoenixRoot, 'canon-stability.json');
  }

  loadSnapshot(): StabilitySnapshot | null {
    if (!existsSync(this.path)) return null;
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as StabilitySnapshot;
    } catch {
      return null;
    }
  }

  saveSnapshot(anchors: string[], lastResult?: StabilityResult, now: () => string = () => new Date().toISOString()): void {
    const snap: StabilitySnapshot = { computed_at: now(), anchors, last_result: lastResult };
    writeFileSync(this.path, JSON.stringify(snap, null, 2), 'utf8');
  }

  /**
   * Update the snapshot from a fresh set of canonical nodes: compute stability
   * against the prior snapshot, persist the new anchors + result, return the result.
   */
  update(nodes: CanonicalNode[], now?: () => string): StabilityResult {
    const prev = this.loadSnapshot();
    const current = anchorsOf(nodes);
    const result = computeStability(prev?.anchors ?? null, current);
    this.saveSnapshot(current, result, now);
    return result;
  }
}

/** Anchors for the non-CONTEXT nodes (the ones that become IUs). */
export function anchorsOf(nodes: CanonicalNode[]): string[] {
  return nodes
    .filter(n => n.type !== 'CONTEXT')
    .map(n => n.canon_anchor)
    .filter((a): a is string => Boolean(a));
}

/**
 * Compare the current anchor set against a previous snapshot. Uses multiset
 * semantics so duplicate anchors (genuinely repeated concepts) are counted.
 */
export function computeStability(previous: string[] | null, current: string[]): StabilityResult {
  if (previous === null) {
    return { retention: 1, novelty: 0, previous_count: 0, current_count: current.length, kept: 0, added: current.length, dropped: 0, first_run: true };
  }
  const prevCounts = multiset(previous);
  const currCounts = multiset(current);

  let kept = 0;
  for (const [anchor, pc] of prevCounts) {
    kept += Math.min(pc, currCounts.get(anchor) ?? 0);
  }
  const dropped = previous.length - kept;
  const added = current.length - kept;

  return {
    retention: previous.length === 0 ? 1 : kept / previous.length,
    novelty: current.length === 0 ? 0 : added / current.length,
    previous_count: previous.length,
    current_count: current.length,
    kept,
    added,
    dropped,
    first_run: false,
  };
}

function multiset(items: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
}
