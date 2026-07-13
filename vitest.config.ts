import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    // The e2e suites boot many real child processes (live harness, seeding, cold-starts).
    // The default worker-thread pool oversubscribes and starves those spawns under load,
    // making the suite flaky; process forks isolate them and run deterministically.
    pool: 'forks',
  },
});
