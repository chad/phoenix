/**
 * The bench runner — plan the cost, refuse what cannot be cited, draw the samples.
 *
 * It prints what a run will cost before spending it, and it refuses three things rather
 * than quietly producing an entry nobody can use:
 *
 *   a dirty tree      the commit would pin nothing, so the entry is not re-runnable
 *   an undersized n   a count below what the declared resolution calls for
 *   an unbuilt CLI    the phoenix arm drives `dist/cli.js`; a stale build is a lie
 *
 * `--dirty` overrides the first deliberately, and the entry records `clean: false`
 * forever after. There is no override for the other two.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveProvider } from '../llm/resolve.js';
import type { LLMProvider } from '../llm/provider.js';
import { armBudget, runArm, type ArmName } from './arms.js';
import { runBehavior } from './behavior.js';
import type { BenchCase } from './case.js';
import {
  appendEntry, RESOLUTION_SAMPLES, RESULTS_SCHEMA, treeState,
  type BenchEntry, type Resolution, type SampleRecord,
} from './results.js';
import { ensureWorkspace, pruneRuns, sampleDir } from './workspace.js';

export interface BenchOptions {
  readonly repoRoot: string;
  readonly resultsDir: string;
  readonly workDir: string;
  readonly cases: readonly BenchCase[];
  readonly arms: readonly ArmName[];
  readonly resolution: Resolution;
  /** Explicit sample count. Below the resolution's own count, the run is refused. */
  readonly samples?: number;
  readonly allowDirty: boolean;
  readonly dry: boolean;
  readonly keep: number;
  readonly log: (line: string) => void;
}

export interface PlanRow {
  readonly bench: BenchCase;
  readonly arm: ArmName;
  readonly samples: number;
  readonly estimateMs: number;
  readonly timeoutMs: number;
}

/** What the run will cost, per (case, arm). Timeout is twice the estimate: hung ≠ slow. */
export function planRun(opts: BenchOptions): PlanRow[] {
  const n = opts.samples ?? (opts.resolution === 'unstated' ? 1 : RESOLUTION_SAMPLES[opts.resolution]);
  const rows: PlanRow[] = [];
  for (const bench of opts.cases) {
    for (const arm of opts.arms) {
      const per = arm === 'phoenix' ? bench.perSampleMs : Math.round(bench.perSampleMs * 0.6);
      rows.push({ bench, arm, samples: n, estimateMs: per * n, timeoutMs: per * 2 });
    }
  }
  return rows;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m}m` : `${(m / 60).toFixed(1)}h`;
}

export class BenchRefusal extends Error {
  constructor(message: string, readonly fix: string) { super(message); this.name = 'BenchRefusal'; }
}

/** Everything checked before a single token is spent. Throws BenchRefusal. */
export function preflight(opts: BenchOptions): { provider: LLMProvider | null; tree: ReturnType<typeof treeState> } {
  if (opts.cases.length === 0) throw new BenchRefusal('no bench cases selected', 'run `phoenix bench --list`');

  const declared = opts.resolution === 'unstated' ? 1 : RESOLUTION_SAMPLES[opts.resolution];
  if (opts.samples !== undefined && opts.samples < declared) {
    throw new BenchRefusal(
      `${opts.resolution} resolution calls for ${declared} samples; -n ${opts.samples} is below it`,
      `draw ${declared} or state a smaller question with --res`,
    );
  }

  const tree = treeState(opts.repoRoot);
  if (!tree.clean && !opts.allowDirty && !opts.dry) {
    throw new BenchRefusal(
      `the tree is dirty (${tree.dirty.length} change(s)) — the commit would pin nothing`,
      'commit first, or pass --dirty to record the entry as not re-runnable',
    );
  }

  if (opts.arms.includes('phoenix') && !existsSync(join(opts.repoRoot, 'dist', 'cli.js'))) {
    throw new BenchRefusal('dist/cli.js is missing — the phoenix arm drives the compiled CLI', 'run `npm run build`');
  }

  const provider = resolveProvider();
  if (!provider) {
    const modelArms = opts.arms.filter(a => a !== 'phoenix');
    if (modelArms.length > 0) {
      throw new BenchRefusal(
        `no LLM provider is available, so the ${modelArms.join(' and ')} arm(s) cannot be drawn`,
        'set a provider key (ANTHROPIC_API_KEY / OPENAI_API_KEY / …) or run only --arm=phoenix',
      );
    }
    if (opts.resolution !== 'smoke') {
      throw new BenchRefusal(
        'no LLM provider: the phoenix arm would generate deterministic stubs, which measures plumbing and nothing else',
        'run with --res=smoke to record it honestly as a plumbing check, or set a provider key',
      );
    }
  }

  return { provider, tree };
}

const STUB_PROVIDER: LLMProvider = {
  name: 'stub',
  model: 'none',
  generate: async () => { throw new Error('no provider'); },
};

/**
 * Draw the samples for one (case, arm) and append exactly one entry.
 *
 * Every sample is: produce an application, then ask the shared oracle about it. The two
 * halves are recorded separately — an arm that produced nothing runnable (`broke` with a
 * producer reason) is a different finding from one whose app booted and answered wrongly.
 */
export async function runOne(
  opts: BenchOptions,
  row: PlanRow,
  provider: LLMProvider | null,
  tree: ReturnType<typeof treeState>,
): Promise<BenchEntry> {
  const { bench, arm, samples, timeoutMs } = row;
  const ws = ensureWorkspace(opts.workDir, { ...bench.runtime.dependencies }, opts.log);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const effective = provider ?? STUB_PROVIDER;

  const runs: SampleRecord[] = [];
  const startedAll = Date.now();

  for (let i = 0; i < samples; i++) {
    const started = Date.now();
    const dir = sampleDir(ws, bench.id, arm, i, stamp);
    const product = await runArm(arm, {
      bench, dir, repoRoot: opts.repoRoot, env: ws.env, provider: effective, timeoutMs,
    });

    if (!product.ok) {
      const unreachable = (product.reason ?? '').startsWith('model call failed');
      runs.push({
        outcome: unreachable ? 'unreachable' : 'broke',
        checks: 0, passed: 0, failed: [], reason: product.reason,
        files: product.files, calls: product.calls, chars: product.chars, ms: Date.now() - started,
      });
      opts.log(`    ${i + 1}/${samples} ${unreachable ? 'unreachable' : 'broke'} — ${product.reason ?? ''}`);
      continue;
    }

    const behavior = await runBehavior(dir, bench, ws.env);
    runs.push({
      outcome: behavior.outcome,
      checks: behavior.checks,
      passed: behavior.passed,
      failed: behavior.failed,
      reason: behavior.reason,
      files: product.files,
      calls: product.calls,
      chars: product.chars,
      ms: Date.now() - started,
    });
    opts.log(
      `    ${i + 1}/${samples} ${behavior.outcome} — ${behavior.passed}/${behavior.checks} checks`
      + (behavior.failed.length ? ` (first failure: ${behavior.failed[0]})` : '')
      + (behavior.reason ? ` — ${behavior.reason}` : ''),
    );
  }

  const count = (o: SampleRecord['outcome']): number => runs.filter(r => r.outcome === o).length;
  const entry: BenchEntry = {
    schema: RESULTS_SCHEMA,
    at: new Date().toISOString(),
    commit: tree.commit,
    clean: tree.clean,
    ...(tree.clean ? {} : { dirty: tree.dirty.slice(0, 20) }),
    case: bench.id,
    fixture_digest: bench.digest,
    arm,
    model: { provider: effective.name, id: effective.model },
    resolution: opts.resolution,
    samples,
    budget: armBudget(arm),
    working: count('working'),
    disagreed: count('disagreed'),
    broke: count('broke'),
    unreachable: count('unreachable'),
    wall_ms: Date.now() - startedAll,
    runs,
  };

  pruneRuns(ws, opts.keep);
  return entry;
}

/** Plan, refuse, draw, record. Returns the entries appended. */
export async function runBench(opts: BenchOptions): Promise<BenchEntry[]> {
  const { provider, tree } = preflight(opts);
  const plan = planRun(opts);

  opts.log('');
  opts.log(`${opts.resolution} resolution, ${plan.length} run(s) — ${provider ? `${provider.name}/${provider.model}` : 'stub (no provider)'}`);
  let total = 0;
  for (const row of plan) {
    total += row.estimateMs;
    opts.log(`  ${row.bench.id.padEnd(18)} ${row.arm.padEnd(9)} ${String(row.samples).padStart(3)} sample(s)  ~${formatDuration(row.estimateMs)}  (timeout ${formatDuration(row.timeoutMs)}/sample)`);
  }
  opts.log(`  ${''.padEnd(18)} ${''.padEnd(9)} ${''.padStart(3)}             ~${formatDuration(total)} in total`);
  opts.log('');
  if (!tree.clean) opts.log('  ⚠ dirty tree — these entries will be recorded as not re-runnable and never cited');
  if (opts.dry) { opts.log('  --dry: nothing was run.'); return []; }

  const written: BenchEntry[] = [];
  for (const row of plan) {
    opts.log(`  ${row.bench.id} · ${row.arm}`);
    const entry = await runOne(opts, row, provider, tree);
    const path = appendEntry(opts.resultsDir, entry);
    written.push(entry);
    opts.log(`    → ${entry.working} working, ${entry.disagreed} disagreed, ${entry.broke} broke, ${entry.unreachable} unreachable  [${path}]`);
  }
  return written;
}
