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
  },
});
