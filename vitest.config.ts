import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Compile dist/ once, before any fork starts. The e2e suites drive the real compiled
    // CLI; letting each build it concurrently races tsc against other forks' spawns.
    globalSetup: ['tests/global-setup.ts'],
    // The e2e suites boot many real child processes (live harness, seeding, cold-starts).
    // The default worker-thread pool oversubscribes and starves those spawns under load,
    // making the suite flaky; process forks isolate them and run deterministically.
    pool: 'forks',

    // Vitest's 5s default assumes in-process unit tests. Most of this suite is not that: the
    // e2e specs spawn the compiled CLI, run tsc, and boot real servers, so a single case
    // legitimately takes seconds. Individual tests already declared 30s/60s/120s where the
    // author remembered, but the ones that didn't were silently depending on fast hardware —
    // 'selective regen rewrites ONLY the affected entity subtree' ran 1.2s locally and 6.9s
    // on a 2-core CI runner, and failed the 5s default. A realistic floor makes the suite
    // portable; it stays low enough that a genuine hang still fails rather than hanging CI,
    // and any test needing longer can still override per-case.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
