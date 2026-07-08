import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Journal } from '../../src/journal.js';

describe('Journal', () => {
  let dir: string;
  let clock = 0;
  const now = () => `2026-01-01T00:00:${String(clock++).padStart(2, '0')}.000Z`;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'phoenix-journal-')); clock = 0; });

  it('appends chained events with increasing seq and linked hashes', () => {
    const j = new Journal(dir);
    const e1 = j.append({ type: 'ingest', outputs: ['c1'] }, now);
    const e2 = j.append({ type: 'canonicalize', inputs: ['c1'], outputs: ['n1'] }, now);
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e1.prev_hash).toBe('');
    expect(e2.prev_hash).toBe(e1.event_hash);
  });

  it('verifies an intact chain', () => {
    const j = new Journal(dir);
    j.append({ type: 'ingest' }, now);
    j.append({ type: 'plan' }, now);
    expect(j.verify()).toEqual({ ok: true });
  });

  it('detects tampering with an event body', () => {
    const j = new Journal(dir);
    j.append({ type: 'regen', outputs: ['src/a.ts'], meta: { model_id: 'stub' } }, now);
    j.append({ type: 'regen', outputs: ['src/b.ts'] }, now);
    // Tamper: rewrite the first event's meta but keep its hash.
    const path = join(dir, 'journal.jsonl');
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const first = JSON.parse(lines[0]);
    first.meta.model_id = 'evil';
    lines[0] = JSON.stringify(first);
    writeFileSync(path, lines.join('\n') + '\n', 'utf8');

    const result = j.verify();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.brokenSeq).toBe(1);
  });

  it('detects a reordered / missing event (broken chain link)', () => {
    const j = new Journal(dir);
    j.append({ type: 'ingest' }, now);
    j.append({ type: 'canonicalize' }, now);
    j.append({ type: 'plan' }, now);
    const path = join(dir, 'journal.jsonl');
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    // Drop the middle event — now event #3's prev_hash points at a missing link.
    writeFileSync(path, [lines[0], lines[2]].join('\n') + '\n', 'utf8');
    const result = j.verify();
    expect(result.ok).toBe(false);
  });

  it('eventsTouching finds events by input, output, or meta value', () => {
    const j = new Journal(dir);
    j.append({ type: 'canonicalize', inputs: ['c1'], outputs: ['n1'] }, now);
    j.append({ type: 'regen', inputs: ['n1'], outputs: ['src/a.ts'], meta: { iu_id: 'iu-1' } }, now);
    expect(j.eventsTouching(['n1']).map(e => e.type)).toEqual(['canonicalize', 'regen']);
    expect(j.eventsTouching(['src/a.ts']).map(e => e.type)).toEqual(['regen']);
    expect(j.eventsTouching(['iu-1']).map(e => e.type)).toEqual(['regen']);
  });

  it('survives a torn final line', () => {
    const j = new Journal(dir);
    j.append({ type: 'ingest' }, now);
    const path = join(dir, 'journal.jsonl');
    writeFileSync(path, readFileSync(path, 'utf8') + '{partial', 'utf8');
    expect(j.readAll()).toHaveLength(1); // torn line skipped
  });
});
