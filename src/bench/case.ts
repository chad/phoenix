/**
 * Bench cases — the vendored fixtures every arm is measured against.
 *
 * A case is a directory under `bench/cases/<id>/`:
 *
 *   case.json     metadata: the architecture, the runtime contract, the intent sentence
 *   spec/*.md     the specification — the phoenix and baseline arms both see this text
 *   checks.json   the behavioural oracle: real HTTP traffic against the booted app
 *
 * Everything is in the repository, so the commit pins the spec, the checks and Phoenix's
 * own code — everything except the model's sampling. The fixture digest is a hash over
 * exactly those files; two runs with different digests were not asked the same question
 * and are never aggregated together.
 *
 * The checks are deliberately expressed as data rather than code. A check written in TS
 * could import Phoenix, and an oracle that can see the generator is not an oracle.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// ─── The behavioural check language ──────────────────────────────────────────

/** A JSON assertion against a response body. `path` is a dotted path; `[0]` indexes. */
export interface JsonAssertion {
  readonly path: string;
  readonly op: 'equals' | 'gte' | 'lte' | 'contains' | 'type' | 'notEmpty' | 'absent' | 'oneOf';
  /** The comparand. Absent for `notEmpty` / `absent`. */
  readonly value?: unknown;
}

export interface BenchCheck {
  /** Stable, human-readable. Appears verbatim in results, so it must never be reworded. */
  readonly name: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** May interpolate `{var}` from earlier `save` bindings. */
  readonly path: string;
  readonly body?: unknown;
  /** Expected HTTP status. */
  readonly status?: number | number[];
  readonly json?: readonly JsonAssertion[];
  /** Bind values out of the response body for later checks: { id: 'id' }. */
  readonly save?: Readonly<Record<string, string>>;
}

// ─── The case ────────────────────────────────────────────────────────────────

export interface RuntimeContract {
  /** Boot argv, run in the sample directory. */
  readonly command: readonly string[];
  /** Route that must answer 200 once the app is up. */
  readonly healthPath: string;
  /** How long a boot may take before it is called broke. */
  readonly readyTimeoutMs: number;
  /**
   * The contract EVERY arm is told, verbatim. It describes the harness's requirements
   * (entrypoint, env vars, permitted dependencies) — not the pipeline's conventions.
   * Withholding it would measure "did the model guess our boot command", which is not
   * the question.
   */
  readonly brief: string;
  /** Dependencies installed once into the shared bench workspace. */
  readonly dependencies: Readonly<Record<string, string>>;
}

export interface BenchCase {
  readonly id: string;
  readonly title: string;
  /** Phoenix architecture target for the `phoenix` arm. */
  readonly arch: string;
  /** The one sentence the `intent` arm gets. Nothing else. */
  readonly intent: string;
  readonly runtime: RuntimeContract;
  /** Typical wall clock of one sample. Declared per case; the planner doubles it. */
  readonly perSampleMs: number;
  /** Loaded spec documents, in a stable order: [relative path, text]. */
  readonly spec: readonly (readonly [string, string])[];
  readonly checks: readonly BenchCheck[];
  /** sha256 over case.json + spec/** + checks.json. */
  readonly digest: string;
  readonly dir: string;
}

/** Concatenated spec text — what the phoenix arm writes to disk and baseline is shown. */
export function specText(c: BenchCase): string {
  return c.spec.map(([, text]) => text).join('\n\n');
}

// ─── Loading ─────────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * Hash the files that define the question. Paths are included, normalised to `/`, so a
 * renamed spec file changes the digest — it is a different question even if the bytes
 * are the same.
 */
export function fixtureDigest(dir: string): string {
  const h = createHash('sha256');
  for (const file of walk(dir)) {
    h.update(relative(dir, file).split(sep).join('/'));
    h.update('\0');
    h.update(readFileSync(file));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

export function loadCase(dir: string): BenchCase {
  const metaPath = join(dir, 'case.json');
  if (!existsSync(metaPath)) throw new Error(`bench case has no case.json: ${dir}`);
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Omit<Partial<BenchCase>, 'runtime'> & {
    runtime?: Partial<RuntimeContract>;
  };

  const specDir = join(dir, 'spec');
  if (!existsSync(specDir)) throw new Error(`bench case has no spec/: ${dir}`);
  const spec = walk(specDir)
    .filter(f => f.endsWith('.md'))
    .map(f => [relative(specDir, f).split(sep).join('/'), readFileSync(f, 'utf8')] as const);
  if (spec.length === 0) throw new Error(`bench case has no spec documents: ${dir}`);

  const checksPath = join(dir, 'checks.json');
  if (!existsSync(checksPath)) throw new Error(`bench case has no checks.json: ${dir}`);
  const checks = JSON.parse(readFileSync(checksPath, 'utf8')) as BenchCheck[];
  if (!Array.isArray(checks) || checks.length === 0) throw new Error(`bench case has no checks: ${dir}`);

  const names = new Set<string>();
  for (const c of checks) {
    if (!c.name) throw new Error(`bench case ${dir}: a check has no name`);
    if (names.has(c.name)) throw new Error(`bench case ${dir}: duplicate check name "${c.name}"`);
    names.add(c.name);
  }

  const rt: Partial<RuntimeContract> = meta.runtime ?? {};
  const required = (v: unknown, field: string): void => {
    if (v === undefined || v === null) throw new Error(`bench case ${dir}: case.json is missing "${field}"`);
  };
  required(meta.id, 'id');
  required(meta.arch, 'arch');
  required(meta.intent, 'intent');
  required(rt.command, 'runtime.command');
  required(rt.brief, 'runtime.brief');

  return {
    id: meta.id as string,
    title: meta.title ?? (meta.id as string),
    arch: meta.arch as string,
    intent: meta.intent as string,
    runtime: {
      command: rt.command as readonly string[],
      healthPath: rt.healthPath ?? '/health',
      readyTimeoutMs: rt.readyTimeoutMs ?? 60_000,
      brief: rt.brief as string,
      dependencies: rt.dependencies ?? {},
    },
    perSampleMs: meta.perSampleMs ?? 120_000,
    spec,
    checks,
    digest: fixtureDigest(dir),
    dir,
  };
}

/** Load every case under a directory, sorted by id. */
export function loadCases(root: string): BenchCase[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter(d => statSync(join(root, d)).isDirectory())
    .sort()
    .map(d => loadCase(join(root, d)));
}
