/**
 * The bench — Phoenix measured against the same model with the pipeline taken away.
 *
 * `phoenix selftest` asks "does Phoenix still do what Phoenix claims?". It is a good
 * instrument and it cannot answer the question a sceptic actually asks: how much of the
 * working application is the pipeline, and how much is a capable model being capable?
 * That question needs a control arm, a shared oracle, and enough samples to have an
 * interval. This module is that.
 *
 * See `bench/README.md` for the discipline, and ACKNOWLEDGEMENTS in the root README for
 * where it came from.
 */

export * from './stats.js';
export * from './case.js';
export * from './behavior.js';
export * from './workspace.js';
export * from './arms.js';
export * from './results.js';
export * from './run.js';
export * from './report.js';
