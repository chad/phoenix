/**
 * Invalidation Store — persists the current staleness set between commands.
 *
 * `phoenix ingest` computes which IUs a spec change invalidated and writes the
 * set here; `phoenix status` reads it to show the pending regeneration work;
 * `phoenix regen` reads it to regenerate only the affected subtree. Entries are
 * cleared per-IU as they are regenerated, so the set always reflects
 * outstanding work — the live answer to "what does production owe the spec?".
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { InvalidationResult, StaleIU, InvalidationCause } from '../invalidation.js';

export interface PersistedInvalidation {
  computed_at: string;
  stale: StaleIU[];
  revalidate: StaleIU[];
  canon_stale: boolean;
  causes: InvalidationCause[];
}

export class InvalidationStore {
  private path: string;

  constructor(phoenixRoot: string) {
    mkdirSync(phoenixRoot, { recursive: true });
    this.path = join(phoenixRoot, 'invalidation.json');
  }

  load(): PersistedInvalidation | null {
    if (!existsSync(this.path)) return null;
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as PersistedInvalidation;
    } catch {
      return null;
    }
  }

  /**
   * Merge a freshly computed result into the persisted set (accumulate stale
   * work across successive ingests rather than overwriting — an IU marked stale
   * by an earlier edit stays stale until it is regenerated). De-duplicated by
   * IU key.
   */
  record(result: InvalidationResult, now: () => string = () => new Date().toISOString()): void {
    const existing = this.load();
    const staleByKey = new Map<string, StaleIU>();
    const revalByKey = new Map<string, StaleIU>();
    if (existing) {
      for (const s of existing.stale) staleByKey.set(s.key, s);
      for (const r of existing.revalidate) revalByKey.set(r.key, r);
    }
    for (const s of result.stale) staleByKey.set(s.key, s);
    // A key that is now directly stale should not also linger as revalidate-only.
    for (const r of result.revalidate) if (!staleByKey.has(r.key)) revalByKey.set(r.key, r);
    for (const key of staleByKey.keys()) revalByKey.delete(key);

    const merged: PersistedInvalidation = {
      computed_at: now(),
      stale: [...staleByKey.values()],
      revalidate: [...revalByKey.values()],
      canon_stale: (existing?.canon_stale ?? false) || result.canon_stale,
      causes: [...(existing?.causes ?? []), ...result.causes],
    };
    writeFileSync(this.path, JSON.stringify(merged, null, 2), 'utf8');
  }

  /** Remove regenerated IU keys from the stale/revalidate sets. */
  clearKeys(keys: Iterable<string>): void {
    const existing = this.load();
    if (!existing) return;
    const drop = new Set(keys);
    existing.stale = existing.stale.filter(s => !drop.has(s.key));
    existing.revalidate = existing.revalidate.filter(r => !drop.has(r.key));
    if (existing.stale.length === 0 && existing.revalidate.length === 0) {
      existing.canon_stale = false;
      existing.causes = [];
    }
    writeFileSync(this.path, JSON.stringify(existing, null, 2), 'utf8');
  }

  /** The stable keys currently marked stale (need regeneration). */
  staleKeys(): Set<string> {
    const existing = this.load();
    return new Set((existing?.stale ?? []).map(s => s.key));
  }

  clearAll(): void {
    if (existsSync(this.path)) {
      writeFileSync(this.path, JSON.stringify({ computed_at: new Date().toISOString(), stale: [], revalidate: [], canon_stale: false, causes: [] }, null, 2), 'utf8');
    }
  }
}
