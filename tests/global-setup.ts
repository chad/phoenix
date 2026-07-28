/**
 * Build the CLI exactly once, before any test file runs.
 *
 * The e2e suites drive the real compiled `dist/cli.js` as a child process. Each used to
 * run `npm run build` in its own `beforeAll`, which meant five concurrent `tsc` invocations
 * rewriting the SHARED `dist/` while other forks were spawning `node dist/cli.js`. A test
 * could observe a truncated or momentarily absent entrypoint and fail with
 * "Not a Phoenix project" or an ESM loader crash — a flake with nothing to do with the
 * behavior under test.
 *
 * Compiling once here makes the artifact a precondition of the suite rather than a race
 * between its members, and drops four redundant `tsc` runs.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

export default function setup(): void {
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });

  const cli = join(ROOT, 'dist', 'cli.js');
  if (!existsSync(cli)) {
    throw new Error(`build completed but ${cli} is missing — the e2e suites cannot run`);
  }
}
