import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NegativeKnowledgeStore } from '../../src/store/negative-knowledge-store.js';
import { hasRelevantNegativeKnowledge } from '../../src/models/negative-knowledge.js';
import type { NegativeKnowledge } from '../../src/models/negative-knowledge.js';

function makeNK(overrides: Partial<NegativeKnowledge> = {}): NegativeKnowledge {
  return {
    nk_id: 'nk-1',
    kind: 'failed_generation',
    subject_id: 'iu-auth',
    subject_type: 'iu',
    what_was_tried: 'Async token refresh',
    why_it_failed: 'Race condition caused token reuse',
    constraint_for_future: 'Token refresh must be synchronous',
    recorded_at: new Date().toISOString(),
    active: true,
    ...overrides,
  };
}

describe('NegativeKnowledgeStore', () => {
  let dir: string;
  let store: NegativeKnowledgeStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'phoenix-nk-'));
    store = new NegativeKnowledgeStore(dir);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('starts empty', () => {
    expect(store.getAll()).toEqual([]);
  });

  it('adds and retrieves records', () => {
    store.add(makeNK());
    expect(store.getAll()).toHaveLength(1);
    expect(store.getBySubject('iu-auth')).toHaveLength(1);
    expect(store.getBySubject('iu-other')).toHaveLength(0);
  });

  it('replaces on duplicate nk_id', () => {
    store.add(makeNK({ nk_id: 'nk-1', what_was_tried: 'v1' }));
    store.add(makeNK({ nk_id: 'nk-1', what_was_tried: 'v2' }));
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0].what_was_tried).toBe('v2');
  });

  it('marks records stale', () => {
    store.add(makeNK());
    expect(store.markStale('nk-1')).toBe(true);
    expect(store.getActive()).toHaveLength(0);
    expect(store.getAll()).toHaveLength(1); // still in store, just inactive
  });

  it('getBySubject only returns active records', () => {
    store.add(makeNK({ nk_id: 'nk-1', active: false }));
    expect(store.getBySubject('iu-auth')).toHaveLength(0);
  });
});

describe('hasRelevantNegativeKnowledge', () => {
  it('returns matching active records', () => {
    const records = [
      makeNK({ nk_id: 'nk-1', subject_id: 'iu-auth' }),
      makeNK({ nk_id: 'nk-2', subject_id: 'iu-other' }),
      makeNK({ nk_id: 'nk-3', subject_id: 'iu-auth', active: false }),
    ];
    const relevant = hasRelevantNegativeKnowledge(records, 'iu-auth');
    expect(relevant).toHaveLength(1);
    expect(relevant[0].nk_id).toBe('nk-1');
  });
});
