/**
 * Provenance Journal — the append-only, hash-chained record of every
 * transformation (PRD §0: "Every transformation emits provenance edges").
 *
 * "Provenance is the new version control." Git records what changed line by
 * line; Phoenix records WHY — which spec change flowed through which canonical
 * nodes into which IUs and which generated files, produced by which model and
 * promptpack. The journal is the unified provenance graph the architecture
 * always claimed but never had: one event per transformation, each chained to
 * the last by hash so the history is tamper-evident and replayable.
 *
 * It is authoritative and additive: the graph JSON indexes remain the working
 * state, but every mutation is also journaled, so `phoenix why` can walk any
 * artifact back to the spec lines and decisions that produced it, and the chain
 * can be verified end to end.
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export type JournalEventType =
  | 'ingest'        // spec document parsed into clauses
  | 'canonicalize'  // clauses extracted into canonical nodes
  | 'plan'          // canonical nodes clustered into IUs
  | 'regen'         // an IU regenerated into files
  | 'schema-plan'   // the shared schema derived BEFORE module generation (P0)
  | 'repair'        // a bounded repair round fed verifier findings into regeneration (P1)
  | 'adapt-spec'    // an LLM drafted a derived spec (provenance + coverage receipted)
  | 'repair:template' // deterministic guard synthesis closed a mechanical finding (P1)
  | 'adequacy'      // Step 0: architecture shape derived, a fit resolved or halted
  | 'assembly-gate' // the assembled product was checked for coherence as a whole
  | 'deletion-test' // the ch9 deletion diagnostic ran over an IU or the whole plan
  | 'evidence'      // evidence recorded for an IU
  | 'invalidate'    // a spec change marked IUs stale
  | 'label'         // a manual edit labeled (waiver/promotion)
  | 'compaction';   // cold data packed

export interface JournalEvent {
  seq: number;
  timestamp: string;
  type: JournalEventType;
  /** Content ids / hashes consumed by this transformation. */
  inputs: string[];
  /** Content ids / hashes produced by this transformation. */
  outputs: string[];
  /** Free-form metadata: model_id, promptpack_hash, tool versions, cause chains. */
  meta: Record<string, unknown>;
  /** event_hash of the previous event (chain link); '' for the genesis event. */
  prev_hash: string;
  /** sha256 over the canonical event body + prev_hash. */
  event_hash: string;
}

/** The fields hashed to form event_hash (everything except event_hash itself). */
function canonicalBody(e: Omit<JournalEvent, 'event_hash'>): string {
  return JSON.stringify({
    seq: e.seq, timestamp: e.timestamp, type: e.type,
    inputs: e.inputs, outputs: e.outputs, meta: e.meta, prev_hash: e.prev_hash,
  });
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export interface AppendInput {
  type: JournalEventType;
  inputs?: string[];
  outputs?: string[];
  meta?: Record<string, unknown>;
}

export class Journal {
  private path: string;

  constructor(phoenixRoot: string) {
    mkdirSync(phoenixRoot, { recursive: true });
    this.path = join(phoenixRoot, 'journal.jsonl');
  }

  /** Read every event in order. Skips malformed lines defensively. */
  readAll(): JournalEvent[] {
    if (!existsSync(this.path)) return [];
    const events: JournalEvent[] = [];
    for (const line of readFileSync(this.path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as JournalEvent);
      } catch { /* skip a torn final line */ }
    }
    return events;
  }

  private lastHash(): { seq: number; hash: string } {
    const all = this.readAll();
    if (all.length === 0) return { seq: 0, hash: '' };
    const last = all[all.length - 1];
    return { seq: last.seq, hash: last.event_hash };
  }

  /**
   * Append one transformation event, chaining it to the previous. Returns the
   * event. `now` is injectable for deterministic tests.
   */
  append(input: AppendInput, now: () => string = () => new Date().toISOString()): JournalEvent {
    const { seq, hash } = this.lastHash();
    const body: Omit<JournalEvent, 'event_hash'> = {
      seq: seq + 1,
      timestamp: now(),
      type: input.type,
      inputs: input.inputs ?? [],
      outputs: input.outputs ?? [],
      meta: input.meta ?? {},
      prev_hash: hash,
    };
    const event: JournalEvent = { ...body, event_hash: sha256(canonicalBody(body)) };
    appendFileSync(this.path, JSON.stringify(event) + '\n', 'utf8');
    return event;
  }

  /**
   * Verify the hash chain end to end: each event's hash recomputes, and each
   * links to the prior event's hash. Returns the first break, or null if intact.
   */
  verify(): { ok: true } | { ok: false; brokenSeq: number; reason: string } {
    const all = this.readAll();
    let prev = '';
    for (const e of all) {
      const recomputed = sha256(canonicalBody({
        seq: e.seq, timestamp: e.timestamp, type: e.type,
        inputs: e.inputs, outputs: e.outputs, meta: e.meta, prev_hash: e.prev_hash,
      }));
      if (recomputed !== e.event_hash) {
        return { ok: false, brokenSeq: e.seq, reason: 'event content does not match its hash (tampered)' };
      }
      if (e.prev_hash !== prev) {
        return { ok: false, brokenSeq: e.seq, reason: 'chain link broken (missing or reordered event)' };
      }
      prev = e.event_hash;
    }
    return { ok: true };
  }

  /** Events whose outputs OR inputs reference any of the given ids/hashes. */
  eventsTouching(ids: Iterable<string>): JournalEvent[] {
    const set = new Set(ids);
    return this.readAll().filter(e =>
      e.outputs.some(o => set.has(o)) || e.inputs.some(i => set.has(i)) ||
      Object.values(e.meta).some(v => typeof v === 'string' && set.has(v)),
    );
  }

  /** Most recent event of a given type, or null. */
  latest(type: JournalEventType): JournalEvent | null {
    const all = this.readAll().filter(e => e.type === type);
    return all.length ? all[all.length - 1] : null;
  }
}
