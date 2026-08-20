import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  appendEntry, loadEntries, flagsOf, isCitable, aggregate, RESULTS_SCHEMA,
  type BenchEntry, type SampleRecord, type Resolution,
} from '../../src/bench/results.js';
import type { ArmName } from '../../src/bench/arms.js';
import { renderTerminal, renderHtml } from '../../src/bench/report.js';

function sample(outcome: SampleRecord['outcome'], passed = 0, checks = 20): SampleRecord {
  return { outcome, checks, passed, failed: [], files: 5, calls: 1, chars: 100, ms: 1000 };
}

function entry(over: Partial<BenchEntry> = {}): BenchEntry {
  const runs = over.runs ?? [sample('working', 20), sample('disagreed', 18), sample('broke')];
  const count = (o: string): number => runs.filter(r => r.outcome === o).length;
  return {
    schema: RESULTS_SCHEMA,
    at: '2026-08-20T10:00:00.000Z',
    commit: 'abc1234',
    clean: true,
    case: 'todo-api',
    fixture_digest: 'digest-1',
    arm: 'phoenix' as ArmName,
    model: { provider: 'anthropic', id: 'claude-sonnet-5' },
    resolution: 'coarse' as Resolution,
    samples: runs.length,
    budget: { calls: 'pipeline-internal', retries: 'pipeline-internal' },
    working: count('working'),
    disagreed: count('disagreed'),
    broke: count('broke'),
    unreachable: count('unreachable'),
    wall_ms: 3000,
    runs,
    ...over,
  };
}

describe('append-only results', () => {
  it('round-trips entries through the JSONL log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phx-bench-results-'));
    appendEntry(dir, entry());
    appendEntry(dir, entry({ arm: 'baseline' }));
    const loaded = loadEntries(dir);
    expect(loaded).toHaveLength(2);
    expect(loaded.map(e => e.arm)).toEqual(['phoenix', 'baseline']);
  });

  it('a truncated line is skipped, not treated as a result', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phx-bench-trunc-'));
    appendEntry(dir, entry());
    const { appendFileSync } = require('node:fs') as typeof import('node:fs');
    appendFileSync(join(dir, 'todo-api.jsonl'), '{"schema":1,"case":"tru', 'utf8');
    expect(loadEntries(dir)).toHaveLength(1);
  });
});

describe('citability', () => {
  it('clean + declared resolution is citable', () => {
    expect(flagsOf(entry())).toEqual([]);
    expect(isCitable(entry())).toBe(true);
  });

  it('smoke, dirty and unstated runs are flagged and excluded', () => {
    expect(flagsOf(entry({ resolution: 'smoke' }))).toContain('smoke');
    expect(flagsOf(entry({ clean: false, dirty: ['M src/cli.ts'] }))).toContain('dirty');
    expect(flagsOf(entry({ resolution: 'unstated' }))).toContain('unstated');
    for (const e of [entry({ resolution: 'smoke' }), entry({ clean: false }), entry({ resolution: 'unstated' })]) {
      expect(isCitable(e)).toBe(false);
      expect(aggregate([e])).toEqual([]);
    }
  });
});

describe('aggregation', () => {
  it('pools entries with the same case, digest, arm and model', () => {
    const aggs = aggregate([entry(), entry()]);
    expect(aggs).toHaveLength(1);
    expect(aggs[0].entries).toBe(2);
    expect(aggs[0].working).toBe(2);
    expect(aggs[0].eligible).toBe(6);
  });

  it('never pools across fixture digests — a changed question is a different bench', () => {
    const aggs = aggregate([entry(), entry({ fixture_digest: 'digest-2' })]);
    expect(aggs).toHaveLength(2);
  });

  it('never pools across models', () => {
    const aggs = aggregate([entry(), entry({ model: { provider: 'openai', id: 'gpt-4o' } })]);
    expect(aggs).toHaveLength(2);
  });

  it('excludes unreachable samples from the denominator but keeps the count', () => {
    const runs = [sample('working', 20), sample('unreachable'), sample('unreachable')];
    const aggs = aggregate([entry({ runs })]);
    expect(aggs[0].drawn).toBe(3);
    expect(aggs[0].eligible).toBe(1);
    expect(aggs[0].unreachable).toBe(2);
    expect(aggs[0].works.n).toBe(1);
  });

  it('reports checks passed as its own rate, over the checks actually attempted', () => {
    const aggs = aggregate([entry({ runs: [sample('working', 20), sample('disagreed', 10)] })]);
    expect(aggs[0].checks.k).toBe(30);
    expect(aggs[0].checks.n).toBe(40);
  });
});

describe('reporting', () => {
  it('the terminal report prints every rate with an interval and no verdict', () => {
    const out = renderTerminal([entry(), entry({ arm: 'baseline' })]);
    expect(out).toMatch(/\d+\/\d+ \[\d\.\d\d, \d\.\d\d\]/);
    expect(out).toContain('distinguish');
    expect(out.toLowerCase()).not.toContain('p-value');
    expect(out.toLowerCase()).not.toContain('winner');
  });

  it('non-citable runs are shown but never counted', () => {
    const out = renderTerminal([entry({ resolution: 'smoke' })]);
    expect(out).toContain('No citable runs yet');
    expect(out).toContain('Shown, never counted');
  });

  it('the published page discloses the retry asymmetry and inlines its data', () => {
    const html = renderHtml([entry()], { generatedAt: '2026-08-20T10:00:00Z', commit: 'abc1234' });
    expect(html).toContain('pipeline\u2019s internal retries'.replace('\u2019', "'"));
    expect(html).toContain('bench-data');
    expect(html).toContain('Sedum eval harness');
    expect(html).not.toContain('<script>alert');
  });
});
