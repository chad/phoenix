/**
 * browser-game target — the engine scaffold must be REAL: it typechecks with the
 * assembled modules, and the headless simulation actually simulates (movement,
 * collision veto rules, ticks, interaction transcript). A target whose scaffold
 * doesn't compile is vocabulary Phoenix pretends to have — worse than none.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { resolveTarget } from '../../src/architectures/index.js';
import type { ImplementationUnit } from '../../src/models/iu.js';

const target = resolveTarget('browser-game')!;
const rt = target.runtime;

const iu = {
  iu_id: 'iu-door', name: 'door', risk_tier: 'low', source_canon_ids: ['c1'],
  output_files: ['src/generated/door/door.ts'],
} as unknown as ImplementationUnit;

// A plausible LLM response for a "door" module (what assemble() must repair+frame).
const LLM_RESPONSE = `
export interface DoorSpec { id: string; x: number; y: number; locked: boolean; }

export function doorColor(spec: DoorSpec): string {
  return spec.locked ? '#8a4a4a' : '#c9a44a';
}

export function register(engine: GameEngine): void {
  engine.registerEntity({
    id: 'door-east', name: 'door', color: doorColor({ id: 'door-east', x: 24, y: 7, locked: false }),
    x: 24, y: 7, solid: true,
    onInteract: () => 'the door leads east.',
  });
  engine.registerRule({
    name: 'no-walking-on-row-2',
    onMove: (_engine, _actor, _nx, ny) => ny !== 2,
  });
}
registerGameModule('door', register);
`;

let projectRoot: string;

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'phx-browser-game-'));
  rt.prepareProject!(projectRoot); // package.json + tsconfig + npm install (real toolchain)
  // Shared engine scaffold + assembled module + client entry, like a real bootstrap.
  for (const [path, content] of Object.entries(rt.sharedFiles)) {
    const full = join(projectRoot, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  const moduleCode = rt.assemble(LLM_RESPONSE, iu);
  const modPath = join(projectRoot, iu.output_files[0]);
  mkdirSync(dirname(modPath), { recursive: true });
  writeFileSync(modPath, moduleCode, 'utf8');
  const scaffold = rt.scaffold!(
    [{ name: 'door', dir: 'door', modules: ['door.ts'], ius: [iu], port: 3000 }], 'testgame', []);
  for (const [path, content] of scaffold) {
    const full = join(projectRoot, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
}, 120_000);

describe('browser-game target', () => {
  it('the scaffold + an assembled module typecheck as one project', () => {
    const errors = rt.compile(projectRoot);
    expect(errors.map(e => e.raw)).toEqual([]);
  }, 120_000);

  it('the headless engine really simulates: movement, walls, rules, interactions', () => {
    // Compile with emit, then drive the real engine from node.
    execSync('npx tsc', { cwd: projectRoot, stdio: 'pipe', timeout: 120_000 });
    const out = execSync(`node --input-type=module -e "
      import('${join(projectRoot, 'dist/client/main.js').replace(/\\\\/g, '/')}').then(({ engine }) => {
        const player = engine.registerPlayer({ id: 'p1', name: 'you', color: '#8cf28c', x: 5, y: 5 });
        console.log('moved-ok', engine.tryMove(player, 1, 0), player.x);          // free tile
        console.log('rule-veto', engine.tryMove({...player, x: 5, y: 3}, 0, -1)); // row 2 vetoed by module rule
        player.x = 23; player.y = 7;
        console.log('door-solid', engine.tryMove(player, 1, 0));                  // door blocks
        console.log('transcript', JSON.stringify(engine.log.at(-1)));             // and speaks
        engine.tick();
        console.log('booted', engine.log[0]);
      });
    "`, { stdio: 'pipe', timeout: 60_000 }).toString();
    expect(out).toContain('moved-ok true 6');
    expect(out).toContain('rule-veto false');
    expect(out).toContain('door-solid false');
    expect(out).toContain('the door leads east.');
    expect(out).toContain('world booted: 1 module(s) — door');
  }, 120_000);

  it('assemble() bans node imports and guarantees registration', () => {
    const code = rt.assemble(`import { readFileSync } from 'node:fs';\nexport const x = 1;`, iu);
    expect(code).not.toMatch(/from 'node:fs'/);
    expect(code).toContain('removed node import');
    expect(code).toContain("registerGameModule('door', register)"); // auto-added
    expect(code).toContain('export function register');              // auto-added no-op
  });
});
