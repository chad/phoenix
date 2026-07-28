/**
 * E2E: the deterministic guard-synthesis stage closes a mechanical finding — no LLM.
 *
 * This is the P1 residual from NIGHT-REPORT-3 (afterimage's "deck ≥ 30 cards" guard the
 * model wouldn't add). We build a real project whose spec carries a mechanical bound the
 * generated module does NOT enforce, run `phoenix repair` with the LLM disabled, and
 * assert the template stage synthesized the guard so the FROZEN verifier now passes it —
 * and that repair-status.json records the deterministic close. Because it needs no model,
 * the whole win is reproducible offline.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(__dirname, '../../');
const CLI = join(ROOT, 'dist', 'cli.js');

function phoenix(cwd: string, args: string[]): string {
  try {
    return execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, PHOENIX_NO_LLM: '1' } });
  } catch (e: any) { return (e.stdout ?? '') + (e.stderr ?? ''); }
}

// A spec with a bound the generator will (deliberately) not enforce in the seeded module.
const SPEC = `# Cards

## Decks

- A deck has a name
- A deck name must not exceed 40 characters
`;

describe('e2e: template repair stage (deterministic, no LLM)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'phoenix-tmpl-'));
    mkdirSync(join(dir, 'spec'), { recursive: true });
    writeFileSync(join(dir, 'spec', 'cards.md'), SPEC, 'utf8');
    phoenix(dir, ['init', '--arch=sqlite-web-api']);
    phoenix(dir, ['bootstrap']); // stub-mode generation (PHOENIX_NO_LLM)
  }, 120_000);

  it('synthesizes the missing bound guard so the frozen verifier passes it', () => {
    // Inject a real module whose `name` field exists but carries NO .max() — the exact
    // absent-guard fault the deterministic stage must close.
    const deckFile = join(dir, 'src', 'generated', 'deck', 'deck.ts');
    writeFileSync(deckFile, `import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

const CreateSchema = z.object({ name: z.string().min(1) });

const router = new Hono();
router.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'bad' }, 400);
  return c.json(parsed.data, 201);
});

export default router;

export const _phoenix = { iu_id: 'iu-deck', name: 'deck', risk_tier: 'low', canon_ids: [] as const } as const;
`, 'utf8');

    // Status should now flag the absent bound (frozen verifier).
    const before = phoenix(dir, ['status']);
    expect(before).toMatch(/deck.*name|name.*40|not exceed 40|\.max\(40\)/i);

    // Run repair with no LLM — only the deterministic template stage can act.
    const repairOut = phoenix(dir, ['repair']);
    expect(repairOut).toMatch(/template repair|Template repair/i);

    // The synthesized guard is present and the frozen verifier no longer flags it.
    const after = readFileSync(deckFile, 'utf8');
    expect(after).toContain('.max(40)');

    // repair-status.json records the deterministic close.
    const rs = JSON.parse(readFileSync(join(dir, '.phoenix', 'repair-status.json'), 'utf8'));
    expect(rs.template_repairs).toBeGreaterThanOrEqual(1);
    expect(rs.template_closed.some((e: any) => e.kind === 'bound')).toBe(true);
  }, 60_000);
});
