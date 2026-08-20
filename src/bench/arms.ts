/**
 * The arms — a ladder of what the producer was given.
 *
 * The whole experiment is the difference between the rungs. A rate for the pipeline with
 * nothing to compare it to is unfalsifiable: "Phoenix produced a working to-do API" is a
 * claim about Phoenix only if the same model, given the same intent and no pipeline,
 * does worse. So the tooling is taken away in two steps rather than one.
 *
 *   phoenix    the full pipeline as shipped: spec → clauses → canonical graph → IUs →
 *              generated code, with the architecture target, the compile gate and the
 *              pipeline's own internal retries.
 *   baseline   the same spec text, the same model, ONE call, no pipeline. Not "a model
 *              without tooling" — a model handed a precise specification.
 *   intent     one sentence and the runtime contract. Nothing else: no requirement list,
 *              no routes. What a sentence alone produces.
 *
 * Every arm is told the runtime contract verbatim (entrypoint, env vars, permitted
 * dependencies). That is the harness's requirement, not the pipeline's convention;
 * withholding it would measure "did the model guess our boot command".
 *
 * Asymmetry that must be disclosed rather than hidden: the phoenix arm gets whatever
 * retries the pipeline performs internally (typecheck-and-retry, repair loop), and the
 * lower rungs get one call and no retry. That is a real advantage of the tool and it is
 * recorded on every entry (`budget`), printed in the report, and stated on the results
 * page. It is not corrected for, because "the pipeline minus its retry loop" is not a
 * thing anyone can run.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import type { LLMProvider } from '../llm/provider.js';
import { specText, type BenchCase } from './case.js';

export type ArmName = 'phoenix' | 'baseline' | 'intent';
export const ARMS: readonly ArmName[] = ['phoenix', 'baseline', 'intent'];

export function isArmName(s: string): s is ArmName {
  return (ARMS as readonly string[]).includes(s);
}

export interface ArmContext {
  readonly bench: BenchCase;
  /** Fresh directory the arm writes its application into. */
  readonly dir: string;
  /** Phoenix repo root (for the compiled CLI the phoenix arm drives). */
  readonly repoRoot: string;
  /** Workspace env (toolchain on PATH). */
  readonly env: Record<string, string>;
  /** The model every arm uses. */
  readonly provider: LLMProvider;
  readonly timeoutMs: number;
}

export interface ArmProduct {
  readonly ok: boolean;
  /** Files written into the sample directory. */
  readonly files: number;
  /** Model calls the arm is *known* to have made; null when the tool decides. */
  readonly calls: number | null;
  /** Characters of model output (a token proxy — providers here do not return usage). */
  readonly chars: number;
  /** Why the arm produced nothing runnable. Distinct from the app failing to boot. */
  readonly reason?: string;
}

/** Disclosure recorded alongside every sample. */
export function armBudget(arm: ArmName): { calls: 'pipeline-internal' | 1; retries: 'pipeline-internal' | 0 } {
  return arm === 'phoenix'
    ? { calls: 'pipeline-internal', retries: 'pipeline-internal' }
    : { calls: 1, retries: 0 };
}

// ─── phoenix ─────────────────────────────────────────────────────────────────

/**
 * Drive the shipped CLI, exactly as a user would: write the spec, `init`, `bootstrap`.
 *
 * Deliberately a subprocess against `dist/cli.js` rather than an in-process call into
 * the pipeline. An arm that imported Phoenix's internals could take a path no user can
 * reach, and the number would then be about the internals rather than about the product.
 */
export async function runPhoenixArm(ctx: ArmContext): Promise<ArmProduct> {
  const { bench, dir, repoRoot, env, provider, timeoutMs } = ctx;

  const specDir = join(dir, 'spec');
  mkdirSync(specDir, { recursive: true });
  for (const [rel, text] of bench.spec) {
    const target = join(specDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, 'utf8');
  }

  const cli = join(repoRoot, 'dist', 'cli.js');
  const childEnv = {
    ...process.env,
    ...env,
    PHOENIX_LLM_PROVIDER: provider.name,
    PHOENIX_LLM_MODEL: provider.model,
  };

  const started = Date.now();
  const init = spawnSync('node', [cli, 'init', `--arch=${bench.arch}`], {
    cwd: dir, env: childEnv, encoding: 'utf8', timeout: timeoutMs,
  });
  if (init.status !== 0) {
    return { ok: false, files: 0, calls: null, chars: 0, reason: `phoenix init failed: ${tail(init.stderr || init.stdout)}` };
  }

  const boot = spawnSync('node', [cli, 'bootstrap'], {
    cwd: dir, env: childEnv, encoding: 'utf8', timeout: Math.max(1000, timeoutMs - (Date.now() - started)),
  });
  if (boot.status !== 0) {
    return { ok: false, files: 0, calls: null, chars: 0, reason: `phoenix bootstrap failed: ${tail(boot.stderr || boot.stdout)}` };
  }

  return { ok: true, files: countFiles(dir), calls: null, chars: (boot.stdout ?? '').length };
}

// ─── baseline / intent ───────────────────────────────────────────────────────

const FORMAT_RULES = `
Reply with ONE fenced JSON code block and nothing else. The JSON is an array of files:

\`\`\`json
[
  { "path": "src/server.ts", "contents": "…the complete file…" },
  { "path": "src/db.ts",     "contents": "…" }
]
\`\`\`

Every file must be complete — no ellipses, no "rest unchanged", no placeholders.
Paths are relative to the project root and must not escape it.`.trim();

function baselinePrompt(bench: BenchCase, brief: string, body: string, kind: 'spec' | 'intent'): string {
  const header = kind === 'spec'
    ? 'Build the application described by the specification below.'
    : 'Build the application described by the one-line intent below. Decide the rest yourself.';
  return [
    header,
    '',
    '## Runtime contract (how your output will be run)',
    brief,
    '',
    kind === 'spec' ? '## Specification' : '## Intent',
    body,
    '',
    '## Output format',
    FORMAT_RULES,
  ].join('\n');
}

const BASELINE_SYSTEM =
  'You are an expert TypeScript engineer. You produce complete, runnable applications in one shot. '
  + 'You never emit partial files and you never explain outside the requested JSON block.';

/** One call, no retry, then write whatever came back. */
export async function runSingleCallArm(ctx: ArmContext, arm: 'baseline' | 'intent'): Promise<ArmProduct> {
  const { bench, dir, provider, timeoutMs } = ctx;
  const body = arm === 'baseline' ? specText(bench) : bench.intent;
  const prompt = baselinePrompt(bench, bench.runtime.brief, body, arm === 'baseline' ? 'spec' : 'intent');

  let text: string;
  try {
    text = await withTimeout(
      provider.generate(prompt, { system: BASELINE_SYSTEM, maxTokens: 16_000, temperature: 0.2 }),
      timeoutMs,
      'model call',
    );
  } catch (e) {
    return { ok: false, files: 0, calls: 1, chars: 0, reason: `model call failed: ${(e as Error).message}` };
  }

  const files = extractFiles(text);
  if (files.length === 0) {
    return { ok: false, files: 0, calls: 1, chars: text.length, reason: 'response_shape: no files could be read from the reply' };
  }

  let written = 0;
  for (const f of files) {
    const rel = normalize(f.path).replace(/^(\.\.[/\\])+/, '');
    if (isAbsolute(rel) || rel.startsWith('..')) continue; // never write outside the sample dir
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.contents, 'utf8');
    written++;
  }
  return { ok: written > 0, files: written, calls: 1, chars: text.length, reason: written > 0 ? undefined : 'response_shape: every path was rejected' };
}

/**
 * Read files out of a model reply.
 *
 * Two accepted shapes: the JSON envelope the prompt asks for, and — as a fallback —
 * markdown fences preceded by a path. The fallback exists because generosity to the
 * CONTROL arm is the safe direction to be wrong in: a baseline penalised for formatting
 * would flatter the pipeline, and flattering the pipeline is the failure mode this whole
 * harness exists to prevent.
 */
export function extractFiles(text: string): { path: string; contents: string }[] {
  const json = extractJsonFiles(text);
  if (json.length > 0) return json;
  return extractFencedFiles(text);
}

function extractJsonFiles(text: string): { path: string; contents: string }[] {
  const candidates: string[] = [];
  for (const m of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) candidates.push(m[1]);
  candidates.push(text);
  for (const c of candidates) {
    const start = c.indexOf('[');
    const end = c.lastIndexOf(']');
    if (start < 0 || end <= start) continue;
    try {
      const parsed = JSON.parse(c.slice(start, end + 1)) as unknown;
      if (!Array.isArray(parsed)) continue;
      const files = parsed
        .filter((f): f is { path: string; contents: string } =>
          !!f && typeof f === 'object'
          && typeof (f as { path?: unknown }).path === 'string'
          && typeof (f as { contents?: unknown }).contents === 'string')
        .map(f => ({ path: f.path, contents: f.contents }));
      if (files.length > 0) return files;
    } catch { /* try the next candidate */ }
  }
  return [];
}

function extractFencedFiles(text: string): { path: string; contents: string }[] {
  const out: { path: string; contents: string }[] = [];
  const re = /(?:^|\n)[^\n]*?[`*#\s]?((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|mjs|json|html|css|sql))[^\n]*\n+```[\w-]*\n([\s\S]*?)```/g;
  for (const m of text.matchAll(re)) out.push({ path: m[1], contents: m[2] });
  return out;
}

// ─── shared ──────────────────────────────────────────────────────────────────

export async function runArm(arm: ArmName, ctx: ArmContext): Promise<ArmProduct> {
  return arm === 'phoenix' ? runPhoenixArm(ctx) : runSingleCallArm(ctx, arm);
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} exceeded ${Math.round(ms / 1000)}s`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e as Error); });
  });
}

function tail(s: string | null | undefined): string {
  return (s ?? '').trim().split('\n').slice(-3).join(' | ').slice(0, 400);
}

function countFiles(dir: string): number {
  let n = 0;
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      if (e === 'node_modules' || e === '.phoenix' || e === '.git') continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p); else n++;
    }
  };
  walk(dir);
  return n;
}
