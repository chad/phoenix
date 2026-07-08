import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChangeStore } from '../../src/store/change-store.js';
import { ChangeClass } from '../../src/models/classification.js';
import type { ChangeClassification } from '../../src/models/classification.js';

function cls(c: ChangeClass): ChangeClassification {
  return { change_class: c, confidence: 0.9, signals: { norm_diff: 0, semhash_delta: true, context_cold_delta: false, term_ref_delta: 0, section_structure_delta: false, canon_impact: 0 } };
}

describe('ChangeStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'phoenix-changes-')); });

  it('persists the window across store instances (survives process boundary)', () => {
    const s1 = new ChangeStore(dir);
    s1.record([cls(ChangeClass.B), cls(ChangeClass.D)], 'spec/a.md');
    const s2 = new ChangeStore(dir);
    expect(s2.getWindow()).toEqual(['B', 'D']);
    expect(s2.getLog()).toHaveLength(2);
  });

  it('evicts oldest entries beyond the window size', () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'phoenix-changes2-'));
    const store = new ChangeStore(dir2);
    // Default window is 100; push 105 and confirm only the last 100 remain.
    const many = Array.from({ length: 105 }, (_, i) => cls(i < 5 ? ChangeClass.A : ChangeClass.B));
    store.record(many, 'spec/a.md');
    const window = store.getWindow();
    expect(window).toHaveLength(100);
    // The 5 leading A's were evicted.
    expect(window.every(c => c === 'B')).toBe(true);
    // The full log is not windowed.
    expect(store.getLog()).toHaveLength(105);
  });

  it('records the doc id and confidence in the log', () => {
    const store = new ChangeStore(dir);
    store.record([cls(ChangeClass.C)], 'spec/auth.md', () => '2026-01-01T00:00:00Z');
    const [entry] = store.getLog();
    expect(entry).toMatchObject({ doc_id: 'spec/auth.md', change_class: 'C', timestamp: '2026-01-01T00:00:00Z' });
  });

  it('is a no-op for an empty batch', () => {
    const store = new ChangeStore(dir);
    store.record([], 'spec/a.md');
    expect(store.getWindow()).toEqual([]);
  });
});
