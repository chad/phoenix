/**
 * E2E: Selective Invalidation — Phoenix's defining capability (PRD §0, §19.2).
 *
 *   "Changing one spec line invalidates only the dependent subtree —
 *    not the entire repository."
 *
 * This drives the real CLI end-to-end (stub generation, deterministic) against a
 * three-entity spec, edits ONE clause, and asserts that a selective regen
 * rewrites ONLY that entity's file — the other two are byte-identical. It is the
 * non-vacuous version of the alpha success criterion (the prior e2e for this was
 * self-admittedly trivially true).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(__dirname, '../../');
const CLI = join(ROOT, 'dist', 'cli.js');

function phoenix(cwd: string, args: string[]): string {
  return execFileSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PHOENIX_NO_LLM: '1' }, // force deterministic stubs
  });
}

function hashTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const genDir = join(root, 'src', 'generated');
  if (!existsSync(genDir)) return out;
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = `${prefix}/${name}`;
      if (statSync(full).isDirectory()) walk(full, rel);
      else out.set(rel, createHash('sha256').update(readFileSync(full, 'utf8')).digest('hex'));
    }
  };
  walk(genDir, 'src/generated');
  return out;
}

/** The set of top-level entity directories under src/generated. */
function entityDirs(root: string): Set<string> {
  const genDir = join(root, 'src', 'generated');
  if (!existsSync(genDir)) return new Set();
  return new Set(readdirSync(genDir).filter(n => statSync(join(genDir, n)).isDirectory()));
}

const SPEC = `# App

## Products

- The system must allow users to create, update, and delete products
- A product name must not be empty

## Customers

- The system must allow users to register and manage customers
- A customer email must be unique

## Invoices

- The system must generate invoices and track invoice payments
- An invoice total must never be negative
`;

describe('e2e: selective invalidation', () => {
  let project: string;

  beforeAll(() => {
    // dist/ is compiled once by tests/global-setup.ts; we drive the real compiled CLI.
    project = mkdtempSync(join(tmpdir(), 'phoenix-selective-'));
    mkdirSync(join(project, 'spec'), { recursive: true });
    writeFileSync(join(project, 'spec', 'app.md'), SPEC, 'utf8');
    phoenix(project, ['init', '--arch=sqlite-web-api']);
    phoenix(project, ['bootstrap']);
  }, 120_000);

  it('bootstrap produces three distinct entity IUs', () => {
    expect(entityDirs(project)).toEqual(new Set(['product', 'customer', 'invoice']));
  });

  it('editing one clause invalidates exactly one IU', () => {
    // Edit ONLY the customer clause.
    const specPath = join(project, 'spec', 'app.md');
    const edited = readFileSync(specPath, 'utf8').replace(
      'register and manage customers',
      'register, manage, and deactivate customers',
    );
    writeFileSync(specPath, edited, 'utf8');

    const ingestOut = phoenix(project, ['ingest']);
    expect(ingestOut).toMatch(/Invalidated: 1 IU\(s\) stale/);

    // status shows exactly one stale IU, named customer.
    const statusOut = phoenix(project, ['status']);
    expect(statusOut).toMatch(/Invalidation:.*1 stale/);
    expect(statusOut.toLowerCase()).toContain('customer');
  });

  it('selective regen rewrites ONLY the affected entity subtree', () => {
    const before = hashTree(project);

    phoenix(project, ['canonicalize']);
    phoenix(project, ['plan']);
    const regenOut = phoenix(project, ['regen']);
    expect(regenOut).toMatch(/selective \(1 stale of 3\)/);

    const after = hashTree(project);

    // Exactly the customer files changed; product and invoice are byte-identical.
    const changed = [...after.keys()].filter(k => before.get(k) !== after.get(k));
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every(k => k.startsWith('src/generated/customer/'))).toBe(true);
    for (const k of after.keys()) {
      if (k.startsWith('src/generated/product/') || k.startsWith('src/generated/invoice/')) {
        expect(after.get(k)).toBe(before.get(k));
      }
    }
  });

  it('after selective regen the invalidation set is cleared', () => {
    const statusOut = phoenix(project, ['status']);
    expect(statusOut).not.toMatch(/Invalidation:.*stale/);
  });

  it('journal chain is intact and tamper-evident', () => {
    const out = phoenix(project, ['journal', '--verify']);
    expect(out).toMatch(/chain intact/);
  });

  it('why traces a generated file back to its spec line', () => {
    // Strip ANSI so assertions aren't split by color codes.
    const out = phoenix(project, ['why', 'src/generated/product/product.ts']).replace(/\x1b\[[0-9;]*m/g, '');
    expect(out).toMatch(/Generated by:.*product/);
    expect(out).toMatch(/spec\/app\.md:L/);          // reached the spec line
    expect(out).toMatch(/promptpack [0-9a-f]{12}/);  // true promptpack hash recorded
  });
});
