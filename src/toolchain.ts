/**
 * The canonical pinned toolchain for GENERATED projects.
 *
 * Every architecture target that emits a `package.json` sources its versions from here.
 * Before this module the same three facts ("we build with TypeScript 5.x", "we test with
 * vitest", "we target Node's type surface") were spelled out independently in
 * `architectures/node-typescript.ts`, `architectures/browser-typescript.ts`, and
 * `scaffold.ts`. Three copies of one fact is three chances to drift, and it meant a
 * security bump had to be applied — and remembered — in three places.
 *
 * `tests/unit/toolchain.test.ts` gates the collapse: it fails if a literal version range
 * reappears in an architecture or the scaffold, so the duplication cannot grow back.
 *
 * Bump policy: these are the versions Phoenix hands to users, so they must be free of
 * known advisories at release. `npm audit` in a generated example is a Phoenix bug.
 */

/** Shared build/test tooling — every TypeScript architecture gets these. */
export const TS_TOOLCHAIN = {
  typescript: '^5.9.3',
  vitest: '^4.1.10',
} as const;

/** Node's type surface. Browser-only targets deliberately omit this. */
export const NODE_TYPES = {
  '@types/node': '^25.9.5',
} as const;

/** Direct-execution helper for Node targets that run TS entrypoints. */
export const TSX = {
  tsx: '^4.23.1',
} as const;

/**
 * Runtime libraries for the sqlite-web-api shape (Hono + better-sqlite3 + Zod).
 *
 * Generated code calls these APIs directly (`serve`, `z.object`, `db.prepare`), so a major
 * bump here is an architecture migration with codegen-template consequences, not a routine
 * security bump. Each major crossing must be verified against a real generated app before
 * it lands. Current state:
 *
 * - `@hono/node-server` 2.x: ADOPTED. v1 carries GHSA-frvp-7c67-39w9 (Windows `serve-static`
 *   path traversal) with no v1 fix. Generated servers only ever call `serve({ fetch, port })`,
 *   which v2 leaves unchanged — verified by booting a generated app on v2 and round-tripping
 *   create/read plus a 400 validation rejection.
 * - `zod` 4.x and `better-sqlite3` 13.x: NOT adopted. No advisory forces them, and both
 *   change APIs the codegen templates emit. Deliberately deferred to a real migration.
 */
export const WEB_API_RUNTIME = {
  hono: '^4.12.32',
  '@hono/node-server': '^2.0.12',
  'better-sqlite3': '^11.10.0',
  zod: '^3.25.76',
} as const;

/** Types for the sqlite-web-api runtime libraries. */
export const WEB_API_TYPES = {
  '@types/better-sqlite3': '^7.6.13',
} as const;

/**
 * The devDependency set for a Node + TypeScript project: build, test, Node types, tsx.
 * Spread order is stable so generated `package.json` files stay byte-comparable across
 * runs — regeneration must not produce a spurious diff.
 */
export const NODE_TS_DEV_PACKAGES = {
  ...TS_TOOLCHAIN,
  ...NODE_TYPES,
  ...TSX,
} as const;

/** The devDependency set for a browser-only TypeScript project: build + test only. */
export const BROWSER_TS_DEV_PACKAGES = {
  ...TS_TOOLCHAIN,
} as const;
