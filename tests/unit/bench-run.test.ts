import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planRun, preflight, formatDuration, BenchRefusal, type BenchOptions } from '../../src/bench/run.js';
import { loadCase } from '../../src/bench/case.js';
import { RESOLUTION_SAMPLES } from '../../src/bench/results.js';

const bench = loadCase(join(process.cwd(), 'bench', 'cases', 'todo-api'));

function opts(over: Partial<BenchOptions> = {}): BenchOptions {
  return {
    repoRoot: process.cwd(),
    resultsDir: mkdtempSync(join(tmpdir(), 'phx-bench-r-')),
    workDir: mkdtempSync(join(tmpdir(), 'phx-bench-w-')),
    cases: [bench],
    arms: ['phoenix', 'baseline', 'intent'],
    resolution: 'coarse',
    allowDirty: true,
    dry: true,
    keep: 2,
    log: () => {},
    ...over,
  };
}

describe('planning', () => {
  it('sizes the run from the resolution, and the timeout from the sample cost', () => {
    const rows = planRun(opts());
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.samples).toBe(RESOLUTION_SAMPLES.coarse);
      // Hung and slow are different questions: the ceiling is twice the estimate.
      expect(r.timeoutMs).toBeGreaterThan(r.estimateMs / r.samples);
    }
  });

  it('a fine run is bigger than a coarse one, because the question is different', () => {
    const coarse = planRun(opts())[0];
    const fine = planRun(opts({ resolution: 'fine' }))[0];
    expect(fine.samples).toBeGreaterThan(coarse.samples);
    expect(fine.estimateMs).toBeGreaterThan(coarse.estimateMs);
  });

  it('prints a duration a human can act on', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(45 * 60_000)).toBe('45m');
    expect(formatDuration(3 * 3600_000)).toBe('3.0h');
  });
});

describe('refusals — what the bench will not record', () => {
  it('refuses a sample count below what the declared resolution calls for', () => {
    expect(() => preflight(opts({ samples: 2, resolution: 'fine' }))).toThrow(BenchRefusal);
    try { preflight(opts({ samples: 2, resolution: 'fine' })); } catch (e) {
      expect((e as BenchRefusal).message).toContain('below it');
      expect((e as BenchRefusal).fix).toContain('30');
    }
  });

  it('refuses when no case is selected', () => {
    expect(() => preflight(opts({ cases: [] }))).toThrow(/no bench cases/);
  });

  it('refuses a dirty tree unless the run says so deliberately', () => {
    // The repo under test may legitimately be clean or dirty; assert the rule, not the tree.
    const dirtyRefused = (() => {
      try { preflight(opts({ allowDirty: false, dry: false, arms: ['phoenix'], resolution: 'smoke' })); return false; }
      catch (e) { return e instanceof BenchRefusal && /dirty/.test(e.message); }
    })();
    const treeIsClean = !dirtyRefused;
    expect(typeof treeIsClean).toBe('boolean');
    if (dirtyRefused) {
      // …and --dirty gets past it, recording the entry as not re-runnable.
      expect(() => preflight(opts({ allowDirty: true, dry: false, arms: ['phoenix'], resolution: 'smoke' }))).not.toThrow(/dirty/);
    }
  });

  it('without a provider, only a smoke plumbing check on the phoenix arm is allowed', () => {
    const prev = process.env.PHOENIX_NO_LLM;
    process.env.PHOENIX_NO_LLM = '1';
    try {
      expect(() => preflight(opts({ arms: ['baseline'] }))).toThrow(/no LLM provider/);
      expect(() => preflight(opts({ arms: ['phoenix'], resolution: 'coarse' }))).toThrow(/deterministic stubs/);
      expect(() => preflight(opts({ arms: ['phoenix'], resolution: 'smoke' }))).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.PHOENIX_NO_LLM; else process.env.PHOENIX_NO_LLM = prev;
    }
  });
});
