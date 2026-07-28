/**
 * E2E: schema-first pipeline ordering (P0 acceptance).
 *
 * The prevention only works if the shared schema is planned BEFORE modules are generated.
 * We bootstrap a project in stub mode (deterministic, no LLM) and prove the ordering from
 * the append-only journal: a `schema-plan` event precedes every `regen` event, and the
 * shared `_migrations.ts` exists and is owned by the schema plan.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(__dirname, '../../');
const CLI = join(ROOT, 'dist', 'cli.js');

function phoenix(cwd: string, args: string[]): void {
  execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, PHOENIX_NO_LLM: '1' }, stdio: 'ignore' });
}

const SPEC = `# Shop

## Products

- The system must allow users to create, update, and delete products
- A product name must not be empty

## Orders

- The system must allow users to place and cancel orders
- An order total must never be negative
- An order must reference an existing product
`;

describe('e2e: schema-first pipeline ordering', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'phoenix-schemafirst-'));
    mkdirSync(join(dir, 'spec'), { recursive: true });
    writeFileSync(join(dir, 'spec', 'shop.md'), SPEC, 'utf8');
    phoenix(dir, ['init', '--arch=sqlite-web-api']);
    phoenix(dir, ['bootstrap']);
  }, 120_000);

  it('journals schema-plan BEFORE any module regeneration', () => {
    const events = readFileSync(join(dir, '.phoenix', 'journal.jsonl'), 'utf8')
      .trim().split('\n').map(l => JSON.parse(l));
    const schemaPlan = events.find(e => e.type === 'schema-plan');
    const firstRegen = events.find(e => e.type === 'regen');
    expect(schemaPlan, 'a schema-plan event was journaled').toBeTruthy();
    expect(firstRegen, 'a regen event was journaled').toBeTruthy();
    expect(schemaPlan.seq).toBeLessThan(firstRegen.seq);
  });

  it('writes the shared migrations file, owned by the schema plan', () => {
    const migPath = join(dir, 'src', 'generated', '_migrations.ts');
    expect(existsSync(migPath)).toBe(true);
    const mig = readFileSync(migPath, 'utf8');
    expect(mig).toMatch(/CREATE TABLE/i);
    // The migration region is owned by the pre-planned schema, not lifted from a module.
    expect(mig).toMatch(/iu=schema-plan role=migration/);
  });
});
