/**
 * Bench results — append-only observations.
 *
 * One JSON object per run, appended to `bench/results/<case>.jsonl` and never edited.
 * A result file is a log of what happened, not a scoreboard someone maintains: a bad run
 * stays in it, a smoke run stays in it, a run taken against a dirty tree stays in it.
 * What varies is whether an entry may be *cited*.
 *
 * Three kinds of entry are shown but never aggregated or compared:
 *
 *   smoke     drawn at n≤2 to prove the plumbing works. Not a measurement.
 *   dirty     uncommitted changes at run time, so the commit pins nothing. Not re-runnable.
 *   unstated  drawn before the run declared what its sample size was for.
 *
 * And two hard partitions. Entries with different **fixture digests** were not asked the
 * same question: the digest covers the spec, the checks and the runtime contract, and
 * changing any of them means the old numbers describe a different bench. Entries from
 * different **commits** were not the same answerer: the commit pins Phoenix's own code,
 * and the pipeline is the thing under test, so pooling a run from before a fix with a run
 * from after it would average away the only effect anybody wanted to measure.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ArmName } from './arms.js';
import type { BehaviorOutcome } from './behavior.js';
import { wilson, type Interval } from './stats.js';

export const RESULTS_SCHEMA = 1;

export type Resolution = 'smoke' | 'coarse' | 'fine' | 'unstated';

/** Samples a resolution calls for. The question decides the size, not the other way round. */
export const RESOLUTION_SAMPLES: Record<Exclude<Resolution, 'unstated'>, number> = {
  smoke: 2,   // does the plumbing work at all?
  coarse: 5,  // differences that are enormous
  fine: 30,   // moving a rate that is already high
};

export const RESOLUTION_QUESTION: Record<Resolution, string> = {
  smoke: 'does the plumbing work at all?',
  coarse: 'differences that are enormous',
  fine: 'moving a rate that is already high',
  unstated: 'no question was declared',
};

/** What one sample did. `unreachable` is infrastructure, not a measurement of anything. */
export type SampleOutcome = BehaviorOutcome | 'unreachable';

export interface SampleRecord {
  readonly outcome: SampleOutcome;
  /** Checks attempted / passed — 0/0 when nothing booted. */
  readonly checks: number;
  readonly passed: number;
  readonly failed: readonly string[];
  readonly reason?: string;
  readonly files: number;
  readonly calls: number | null;
  readonly chars: number;
  readonly ms: number;
}

export interface BenchEntry {
  readonly schema: number;
  readonly at: string;
  readonly commit: string;
  readonly clean: boolean;
  readonly dirty?: readonly string[];
  readonly case: string;
  readonly fixture_digest: string;
  readonly arm: ArmName;
  readonly model: { readonly provider: string; readonly id: string };
  readonly resolution: Resolution;
  readonly samples: number;
  readonly budget: { readonly calls: 'pipeline-internal' | 1; readonly retries: 'pipeline-internal' | 0 };
  readonly working: number;
  readonly disagreed: number;
  readonly broke: number;
  readonly unreachable: number;
  readonly wall_ms: number;
  readonly runs: readonly SampleRecord[];
}

// ─── Git provenance ──────────────────────────────────────────────────────────

export interface TreeState { commit: string; clean: boolean; dirty: string[] }

export function treeState(repoRoot: string): TreeState {
  const git = (args: string[]): string => {
    try {
      return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
    } catch { return ''; }
  };
  const commit = git(['rev-parse', '--short', 'HEAD']) || 'unknown';
  const porcelain = git(['status', '--porcelain']);
  const dirty = porcelain ? porcelain.split('\n').map(l => l.trim()).filter(Boolean) : [];
  return { commit, clean: dirty.length === 0, dirty };
}

// ─── Reading and writing ─────────────────────────────────────────────────────

export function appendEntry(resultsDir: string, entry: BenchEntry): string {
  mkdirSync(resultsDir, { recursive: true });
  const path = join(resultsDir, `${entry.case}.jsonl`);
  appendFileSync(path, JSON.stringify(entry) + '\n', 'utf8');
  return path;
}

export function loadEntries(resultsDir: string): BenchEntry[] {
  if (!existsSync(resultsDir)) return [];
  const out: BenchEntry[] = [];
  for (const file of readdirSync(resultsDir).filter(f => f.endsWith('.jsonl')).sort()) {
    for (const line of readFileSync(join(resultsDir, file), 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { out.push(JSON.parse(t) as BenchEntry); } catch { /* a truncated append is not a result */ }
    }
  }
  return out;
}

// ─── Citability ──────────────────────────────────────────────────────────────

export type Flag = 'smoke' | 'dirty' | 'unstated';

export function flagsOf(e: BenchEntry): Flag[] {
  const flags: Flag[] = [];
  if (e.resolution === 'smoke') flags.push('smoke');
  if (!e.clean) flags.push('dirty');
  if (e.resolution === 'unstated') flags.push('unstated');
  return flags;
}

/** May this entry appear in an aggregate or a comparison? */
export function isCitable(e: BenchEntry): boolean {
  return flagsOf(e).length === 0;
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

export interface Aggregate {
  readonly case: string;
  readonly fixture_digest: string;
  /** The Phoenix commit under test. Never pooled across — the tool is the treatment. */
  readonly commit: string;
  readonly arm: ArmName;
  readonly model: string;
  readonly entries: number;
  /** Samples drawn, including unreachable ones. */
  readonly drawn: number;
  /** Denominator: samples that actually reached the model. Unreachable ones are excluded. */
  readonly eligible: number;
  readonly working: number;
  readonly disagreed: number;
  readonly broke: number;
  readonly unreachable: number;
  /** working / eligible, with its interval. Never one without the other. */
  readonly works: Interval;
  /** Checks passed / checks attempted, over samples that booted. A partial-credit view. */
  readonly checks: Interval;
}

export function modelLabel(e: BenchEntry): string {
  return `${e.model.provider}/${e.model.id}`;
}

function aggKey(e: BenchEntry): string {
  return [e.case, e.fixture_digest, e.commit, e.arm, modelLabel(e)].join('\u0000');
}

/**
 * Pool citable entries by (case, fixture digest, commit, arm, model).
 *
 * Pooling across *models*, *digests* or *commits* is not offered, because none of them is
 * the same question repeated — it is two questions averaged, which is how a headline
 * number stops meaning anything.
 */
export function aggregate(entries: readonly BenchEntry[]): Aggregate[] {
  const groups = new Map<string, BenchEntry[]>();
  for (const e of entries) {
    if (!isCitable(e)) continue;
    const k = aggKey(e);
    const g = groups.get(k);
    if (g) g.push(e); else groups.set(k, [e]);
  }

  const out: Aggregate[] = [];
  for (const g of groups.values()) {
    const first = g[0];
    let drawn = 0, working = 0, disagreed = 0, broke = 0, unreachable = 0, checks = 0, passed = 0;
    for (const e of g) {
      drawn += e.samples;
      working += e.working;
      disagreed += e.disagreed;
      broke += e.broke;
      unreachable += e.unreachable;
      for (const r of e.runs) { checks += r.checks; passed += r.passed; }
    }
    const eligible = working + disagreed + broke;
    out.push({
      case: first.case,
      fixture_digest: first.fixture_digest,
      commit: first.commit,
      arm: first.arm,
      model: modelLabel(first),
      entries: g.length,
      drawn,
      eligible,
      working,
      disagreed,
      broke,
      unreachable,
      works: wilson(working, eligible),
      checks: wilson(passed, checks),
    });
  }
  return out.sort((a, b) =>
    a.case.localeCompare(b.case) || a.model.localeCompare(b.model) || armOrder(a.arm) - armOrder(b.arm));
}

function armOrder(a: ArmName): number {
  return a === 'phoenix' ? 0 : a === 'baseline' ? 1 : 2;
}
