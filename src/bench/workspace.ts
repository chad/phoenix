/**
 * The bench workspace — one dependency install, many samples.
 *
 * Every sample writes a whole application into its own directory. Installing that
 * application's dependencies per sample would cost minutes of npm per model call and
 * would let a slow registry look like a broken generator, so the workspace installs the
 * union of every case's declared dependencies ONCE at its root and runs the samples in
 * subdirectories beneath it, where Node's own resolution finds them.
 *
 * What this shares between samples is the dependency tree — nothing else. Each sample
 * gets a fresh directory, and the live harness gives each boot a fresh temp database, so
 * no sample can observe another's state.
 *
 * The workspace is disposable build state, not a result: it lives under `.phoenix-bench/`
 * and is gitignored. Results go somewhere else entirely (see results.ts) because they
 * are the only thing here worth keeping.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Workspace {
  readonly root: string;
  readonly runsDir: string;
  /** Env additions every sample and every boot inherits (toolchain on PATH). */
  readonly env: Record<string, string>;
}

const TOOLCHAIN: Record<string, string> = {
  tsx: '^4.23.1',
  typescript: '^5.9.3',
};

/**
 * Create the workspace and install dependencies if the declared set changed.
 *
 * The install is keyed by a hash of the dependency map, so adding a case with new
 * dependencies re-installs and re-running an unchanged bench does not.
 */
export function ensureWorkspace(
  root: string,
  dependencies: Record<string, string>,
  log: (msg: string) => void = () => {},
): Workspace {
  mkdirSync(root, { recursive: true });
  const runsDir = join(root, 'runs');
  mkdirSync(runsDir, { recursive: true });

  const deps = { ...dependencies, ...TOOLCHAIN };
  const sorted = Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
  const hash = createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
  const stampPath = join(root, '.deps-hash');
  const installed = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : '';

  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'phoenix-bench-workspace', private: true, type: 'module', dependencies: sorted }, null, 2) + '\n',
    'utf8',
  );
  writeFileSync(join(root, '.gitignore'), '*\n', 'utf8');

  if (installed !== hash || !existsSync(join(root, 'node_modules'))) {
    log(`installing bench dependencies (${Object.keys(sorted).length} packages) — once per dependency set`);
    const res = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    if (res.status !== 0) {
      throw new Error(`bench workspace install failed (npm exit ${res.status}) — the bench cannot run without it`);
    }
    writeFileSync(stampPath, hash + '\n', 'utf8');
  }

  const binDir = join(root, 'node_modules', '.bin');
  return {
    root,
    runsDir,
    env: { PATH: `${binDir}:${process.env.PATH ?? ''}` },
  };
}

/** A fresh, empty directory for one sample. */
export function sampleDir(ws: Workspace, caseId: string, arm: string, index: number, stamp: string): string {
  const dir = join(ws.runsDir, `${caseId}--${arm}--${stamp}--${String(index).padStart(3, '0')}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Keep the most recent sample directories and delete the rest.
 *
 * Sample directories are evidence while you are reading a failure and litter afterwards;
 * a bench run of 50 samples writes 50 applications. Pruning is by mtime, newest kept.
 */
export function pruneRuns(ws: Workspace, keep = 20): void {
  if (!existsSync(ws.runsDir)) return;
  const dirs = readdirSync(ws.runsDir)
    .map(d => join(ws.runsDir, d))
    .filter(p => { try { return statSync(p).isDirectory(); } catch { return false; } })
    .map(p => ({ p, m: statSync(p).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  for (const { p } of dirs.slice(keep)) rmSync(p, { recursive: true, force: true });
}
