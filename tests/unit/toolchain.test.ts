/**
 * The toolchain pin is a single fact, and this gate keeps it that way.
 *
 * Phoenix hands generated projects a `package.json`. Before src/toolchain.ts, the versions
 * in it were spelled out independently in three emitters, so a security bump had to be
 * applied in three places and silently rotted in whichever one you forgot. Collapsing the
 * copies is only durable if regrowth is detected, so:
 *
 *   1. no emitter may contain a literal semver range (the copies cannot come back);
 *   2. every architecture's emitted manifest must agree with the canonical pin;
 *   3. the pin itself must stay clear of the advisory floors we just cleared, so a
 *      careless revert to a known-vulnerable range fails the suite rather than shipping.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  TS_TOOLCHAIN,
  NODE_TYPES,
  TSX,
  WEB_API_RUNTIME,
  WEB_API_TYPES,
  NODE_TS_DEV_PACKAGES,
  BROWSER_TS_DEV_PACKAGES,
} from '../../src/toolchain.js';

const SRC = resolve(__dirname, '../../src');

/** Files that emit a package.json and must therefore own no version literals. */
const EMITTERS = [
  'scaffold.ts',
  join('architectures', 'node-typescript.ts'),
  join('architectures', 'browser-typescript.ts'),
];

/** A dependency-range literal: '^1.2.3', '~1.2', '>=1.2.3' in single or double quotes. */
const VERSION_LITERAL = /['"](?:[\^~]|>=)\d+\.\d+(?:\.\d+)?['"]/g;

describe('toolchain: one canonical pin', () => {
  it('no emitter carries its own version literals', () => {
    const offenders: string[] = [];

    for (const rel of EMITTERS) {
      const src = readFileSync(join(SRC, rel), 'utf8');
      for (const hit of src.match(VERSION_LITERAL) ?? []) {
        offenders.push(`${rel}: ${hit}`);
      }
    }

    expect(
      offenders,
      `Version ranges must live only in src/toolchain.ts. Found literals in emitters:\n` +
        offenders.map((o) => `  - ${o}`).join('\n'),
    ).toEqual([]);
  });

  it('the sqlite-web-api manifest matches the canonical pin', async () => {
    const { nodeTypescript } = await import('../../src/architectures/node-typescript.js');

    expect(nodeTypescript.packages).toEqual({ ...WEB_API_RUNTIME });
    expect(nodeTypescript.devPackages).toEqual({ ...NODE_TS_DEV_PACKAGES, ...WEB_API_TYPES });
  });

  it('the browser manifest matches the canonical pin and omits Node types', async () => {
    const { browserTypescript } = await import('../../src/architectures/browser-typescript.js');

    expect(browserTypescript.devPackages).toEqual({ ...BROWSER_TS_DEV_PACKAGES });
    // A pure-browser target has no business claiming Node's type surface.
    expect(browserTypescript.devPackages).not.toHaveProperty('@types/node');
  });

  it('every pinned range is a caret range on a concrete version', () => {
    const all = { ...TS_TOOLCHAIN, ...NODE_TYPES, ...TSX, ...WEB_API_RUNTIME, ...WEB_API_TYPES };

    for (const [name, range] of Object.entries(all)) {
      expect(range, `${name} must be a caret range on a full x.y.z version`).toMatch(
        /^\^\d+\.\d+\.\d+$/,
      );
    }
  });

  it('the pin stays above the advisory floors this repo has already cleared', () => {
    // Floors correspond to real advisories drained in the dependency-debt pass. Dropping
    // back below one of these reintroduces a known-vulnerable range into generated output,
    // so it must fail here rather than in a user's `npm audit`.
    const floors: Record<string, number[]> = {
      vitest: [3, 0, 0], // vitest 2.x pulls vulnerable vite / vite-node / esbuild
      typescript: [5, 9, 0],
      '@types/node': [25, 0, 0],
    };

    const pinned: Record<string, string> = { ...TS_TOOLCHAIN, ...NODE_TYPES };

    for (const [name, floor] of Object.entries(floors)) {
      const range = pinned[name];
      expect(range, `${name} must be pinned in src/toolchain.ts`).toBeDefined();

      const actual = range.replace(/^\^/, '').split('.').map(Number);
      const cmp =
        actual[0] - floor[0] || actual[1] - floor[1] || actual[2] - floor[2];

      expect(
        cmp,
        `${name} is pinned at ${range}, below the cleared advisory floor ${floor.join('.')}`,
      ).toBeGreaterThanOrEqual(0);
    }
  });
});
