import { describe, it, expect } from 'vitest';
import { wilson, formatInterval, formatRate, overlaps, compareSentence } from '../../src/bench/stats.js';

describe('wilson', () => {
  it('a perfect score at n=5 is still consistent with a much lower true rate', () => {
    const iv = wilson(5, 5);
    expect(iv.rate).toBe(1);
    // The whole reason the fraction never appears alone.
    expect(iv.lo).toBeLessThan(0.6);
    expect(iv.hi).toBe(1);
  });

  it('the same rate at n=50 is a much narrower claim', () => {
    const small = wilson(4, 5);
    const large = wilson(40, 50);
    expect(small.rate).toBeCloseTo(large.rate!, 10);
    expect(large.hi - large.lo).toBeLessThan(small.hi - small.lo);
  });

  it('0/n has a lower bound of 0 and a positive upper bound — never "zero, full stop"', () => {
    const iv = wilson(0, 50);
    expect(iv.lo).toBe(0);
    expect(iv.hi).toBeGreaterThan(0);
    expect(iv.hi).toBeLessThan(0.1);
  });

  it('n=0 is absent, not zero', () => {
    const iv = wilson(0, 0);
    expect(iv.rate).toBeNull();
    expect([iv.lo, iv.hi]).toEqual([0, 1]);
    expect(formatInterval(iv)).toContain('no samples');
  });

  it('never returns an impossible rate', () => {
    for (const n of [1, 2, 5, 30, 50]) {
      for (let k = 0; k <= n; k++) {
        const iv = wilson(k, n);
        expect(iv.lo).toBeGreaterThanOrEqual(0);
        expect(iv.hi).toBeLessThanOrEqual(1);
        expect(iv.lo).toBeLessThanOrEqual(iv.hi);
      }
    }
  });

  it('refuses nonsense counts rather than inventing an interval', () => {
    expect(() => wilson(6, 5)).toThrow();
    expect(() => wilson(-1, 5)).toThrow();
  });
});

describe('formatting', () => {
  it('always prints the fraction and the interval together', () => {
    expect(formatRate(34, 50)).toMatch(/^34\/50 \[0\.\d\d, 0\.\d\d\]$/);
  });
});

describe('comparison', () => {
  it('overlapping intervals license only "does not distinguish"', () => {
    const a = wilson(34, 50);
    const b = wilson(32, 50);
    expect(overlaps(a, b)).toBe(true);
    const s = compareSentence('phoenix', a, 'baseline', b);
    expect(s).toContain('do NOT distinguish');
    expect(s.toLowerCase()).not.toContain('better');
  });

  it('disjoint intervals are reported as distinguished, still without a winner', () => {
    const s = compareSentence('phoenix', wilson(45, 50), 'intent', wilson(3, 50));
    expect(s).toContain('distinguish');
    expect(s).not.toContain('do NOT');
    expect(s.toLowerCase()).not.toContain('better');
  });

  it('nothing is distinguished by nothing', () => {
    expect(overlaps(wilson(0, 0), wilson(50, 50))).toBe(true);
    expect(compareSentence('a', wilson(0, 0), 'b', wilson(5, 5))).toContain('cannot be compared');
  });
});
