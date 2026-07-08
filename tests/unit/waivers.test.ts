import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WaiverStore, parseExpiry } from '../../src/waivers.js';
import type { StoredWaiver } from '../../src/waivers.js';

function waiver(key: string, kind: StoredWaiver['kind'] = 'waiver'): StoredWaiver {
  return { key, kind, reason: 'because', created_at: new Date().toISOString() };
}

describe('WaiverStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'phoenix-waiver-')); });

  it('adds, gets, and removes waivers', () => {
    const store = new WaiverStore(dir);
    store.add(waiver('src/a.ts'));
    expect(store.get('src/a.ts')?.reason).toBe('because');
    expect(store.remove('src/a.ts')).toBe(true);
    expect(store.get('src/a.ts')).toBeUndefined();
    expect(store.remove('src/a.ts')).toBe(false);
  });

  it('asMap yields DriftWaiver shape for detectDrift', () => {
    const store = new WaiverStore(dir);
    store.add({ ...waiver('src/a.ts', 'temporary_patch'), expires: '2099-01-01T00:00:00Z' });
    const map = store.asMap();
    expect(map.get('src/a.ts')).toMatchObject({ kind: 'temporary_patch', expires: '2099-01-01T00:00:00Z' });
  });

  it('clearForFile removes the file waiver and its region waivers', () => {
    const store = new WaiverStore(dir);
    store.add(waiver('src/a.ts'));
    store.add(waiver('src/a.ts#iu1|migration|tasks'));
    store.add(waiver('src/b.ts'));
    const removed = store.clearForFile('src/a.ts');
    expect(removed.sort()).toEqual(['src/a.ts', 'src/a.ts#iu1|migration|tasks']);
    expect(store.get('src/b.ts')).toBeDefined();
  });

  it('tracks open promotions and resolves them per file', () => {
    const store = new WaiverStore(dir);
    store.addPromotion({ file_path: 'src/a.ts', reason: 'needs flag', created_at: new Date().toISOString() });
    store.addPromotion({ file_path: 'src/b.ts', reason: 'needs cache', created_at: new Date().toISOString() });
    expect(store.openPromotions()).toHaveLength(2);
    expect(store.resolvePromotions('src/a.ts')).toBe(1);
    const open = store.openPromotions();
    expect(open).toHaveLength(1);
    expect(open[0].file_path).toBe('src/b.ts');
  });

  it('survives a corrupt index without throwing', () => {
    const store = new WaiverStore(dir);
    // Overwrite with garbage.
    const fs = require('node:fs');
    fs.writeFileSync(join(dir, 'waivers.json'), '{not json', 'utf8');
    expect(store.getAll()).toEqual([]);
  });
});

describe('parseExpiry', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  it('parses durations', () => {
    expect(parseExpiry('14d', now)).toBe(new Date('2026-01-15T00:00:00Z').toISOString());
    expect(parseExpiry('12h', now)).toBe(new Date('2026-01-01T12:00:00Z').toISOString());
    expect(parseExpiry('30m', now)).toBe(new Date('2026-01-01T00:30:00Z').toISOString());
  });
  it('parses ISO dates', () => {
    expect(parseExpiry('2026-06-01', now)).toBe(new Date('2026-06-01').toISOString());
  });
  it('returns undefined for garbage', () => {
    expect(parseExpiry('soon', now)).toBeUndefined();
    expect(parseExpiry('5y', now)).toBeUndefined();
  });
});
