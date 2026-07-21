/**
 * Runtime Target: browser-typescript
 *
 * Compiles the browser-game architecture to pure-browser TypeScript. The engine
 * scaffold (game loop, tile renderer, input, registries) ships as sharedFiles;
 * generated modules are DOM-free rule/entity contributors that typecheck headless.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { RuntimeTarget, CompileError, ServiceDescriptor, AssemblyFinding } from '../models/architecture.js';
import type { ImplementationUnit } from '../models/iu.js';
import { cleanCodeResponse } from '../codegen-util.js';
import { parseTscOutput } from './node-typescript.js';

// ─── The engine scaffold (hand-authored, shipped verbatim — never generated) ──

const ENGINE_FILE = `/**
 * FreeqEngine — the browser-game architecture's shared engine (Phoenix scaffold).
 * Owns the canvas, game loop, input, and world model. Generated modules contribute
 * entities and rules through register(engine); they never touch the DOM.
 * Headless-safe: constructed without a canvas, it runs ticks for unit tests.
 */

export interface EntityDef {
  id: string;
  name: string;
  /** 6-digit hex fill; the renderer draws a 16px pixel figure in this color. */
  color: string;
  /** Room this entity lives in (default 'plaza'). */
  room?: string;
  /** Cell — ASSIGNED by engine.layout(); modules must NOT set these (the engine
   *  owns spatial composition, so entities never collide). */
  x?: number;
  y?: number;
  solid?: boolean;
  /** Player-adjacent interaction (walking into it) — return a log line, or nothing. */
  onInteract?: (engine: GameEngine, actor: EntityDef) => string | void;
}

export interface ExitDef {
  toRoom: string;
  x: number;
  y: number;
  label: string;
}

export interface RoomDef {
  id: string;
  name: string;
  exits: ExitDef[];
}

export interface Rule {
  name: string;
  /** Veto or allow a move; return false to block. */
  onMove?: (engine: GameEngine, actor: EntityDef, nx: number, ny: number) => boolean;
  /** Advance module state once per tick. */
  onTick?: (engine: GameEngine, tick: number) => void;
  /** Non-movement key handling ('e', 'Enter', …). */
  onKey?: (engine: GameEngine, key: string) => void;
}

export interface EngineConfig {
  cols: number;
  rows: number;
  tile: number;
  floorColors: [string, string];
  wallColor: string;
}

const DEFAULT_CONFIG: EngineConfig = {
  cols: 26, rows: 15, tile: 16,
  floorColors: ['#1c2431', '#1a2130'], wallColor: '#39415c',
};

/** Deterministic 32-bit hash (fnv-1a) — modules use this instead of Math.random. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export class GameEngine {
  readonly config: EngineConfig;
  readonly entities: EntityDef[] = [];
  readonly rules: Rule[] = [];
  readonly log: string[] = [];
  readonly rooms = new Map<string, RoomDef>();
  currentRoom = 'plaza';
  player: EntityDef | null = null;
  private tickCount = 0;
  private ctx: CanvasRenderingContext2D | null = null;

  constructor(config: Partial<EngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── module contribution API ──
  registerEntity(e: EntityDef): EntityDef { e.room = e.room || 'plaza'; this.ensureRoom(e.room); this.entities.push(e); return e; }
  registerRule(r: Rule): void { this.rules.push(r); }
  registerPlayer(e: EntityDef): EntityDef { e.room = e.room || 'plaza'; this.ensureRoom(e.room); this.player = e; this.currentRoom = e.room; this.entities.push(e); return e; }
  say(line: string): void { this.log.push(line); if (this.log.length > 200) this.log.shift(); }

  ensureRoom(id: string): RoomDef { let r = this.rooms.get(id); if (!r) { r = { id, name: id, exits: [] }; this.rooms.set(id, r); } return r; }
  declareRoom(id: string, name?: string, exits: ExitDef[] = []): RoomDef {
    const r = this.ensureRoom(id);
    if (name) r.name = name;
    for (const ex of exits) { r.exits.push(ex); this.ensureRoom(ex.toRoom); }
    return r;
  }
  entitiesInRoom(room: string): EntityDef[] { return this.entities.filter(e => (e.room || 'plaza') === room); }

  /** Deterministic spatial composition: assign every entity a DISTINCT cell within
   *  its room (hash-seeded, linear-probed). This is the layout aggregate — the reason
   *  a browser-game can COMPOSE an interactive client, not just express one. Modules
   *  never choose coordinates; the engine does, so 367 entities never pile onto one
   *  tile again. */
  layout(): void {
    const iw = this.config.cols - 2, ih = this.config.rows - 2, cells = iw * ih;
    for (const room of this.rooms.keys()) {
      const occupied = new Set<number>();
      const ents = this.entitiesInRoom(room);
      for (const e of ents) {
        // The engine ALWAYS assigns — module-set coordinates are ignored, so no module
        // can stack entities; composition is guaranteed, not hoped for.
        let slot = hash32(e.id + ':' + room) % cells;
        for (let i = 0; i < cells && occupied.has(slot); i++) slot = (slot + 1) % cells;
        occupied.add(slot);
        e.x = 1 + (slot % iw); e.y = 1 + Math.floor(slot / iw);
      }
    }
  }

  entityAt(x: number, y: number): EntityDef | undefined {
    return this.entities.find(e => (e.room || 'plaza') === this.currentRoom && e.x === x && e.y === y);
  }

  /** Move an actor one step; walls, solids, and every module's onMove rule apply. */
  tryMove(actor: EntityDef, dx: number, dy: number): boolean {
    const nx = (actor.x ?? 1) + dx, ny = (actor.y ?? 1) + dy;
    if (nx < 1 || ny < 1 || nx > this.config.cols - 2 || ny > this.config.rows - 2) return false;
    if (actor === this.player) {
      const room = this.rooms.get(this.currentRoom);
      const exit = room && room.exits.find(e => e.x === nx && e.y === ny);
      if (exit) { this.currentRoom = exit.toRoom; this.say('entered ' + exit.toRoom); return true; }
    }
    const occupant = this.entityAt(nx, ny);
    if (occupant && occupant !== actor) {
      const line = occupant.onInteract?.(this, actor);
      if (line) this.say(line);
      if (occupant.solid !== false) return false;
    }
    for (const r of this.rules) if (r.onMove && !r.onMove(this, actor, nx, ny)) return false;
    actor.x = nx; actor.y = ny;
    return true;
  }

  /** One simulation step — headless-safe (unit tests drive this directly). */
  tick(): void {
    this.tickCount++;
    for (const r of this.rules) r.onTick?.(this, this.tickCount);
  }

  // ── browser wiring (no-ops headless) ──
  start(canvas?: HTMLCanvasElement): void {
    this.layout();
    if (typeof document === 'undefined' || !canvas) return; // headless
    canvas.width = this.config.cols * this.config.tile;
    canvas.height = this.config.rows * this.config.tile;
    this.ctx = canvas.getContext('2d');
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    document.addEventListener('keydown', (ev) => this.onKeyDown(ev.key));
    const loop = (): void => { this.tick(); this.render(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  private onKeyDown(key: string): void {
    const dir: Record<string, [number, number]> = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    };
    if (this.player && dir[key]) { this.tryMove(this.player, ...dir[key]); return; }
    for (const r of this.rules) r.onKey?.(this, key);
  }

  private render(): void {
    const c = this.ctx;
    if (!c) return;
    const { cols, rows, tile, floorColors, wallColor } = this.config;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const wall = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
      c.fillStyle = wall ? wallColor : floorColors[(x + y) % 2];
      c.fillRect(x * tile, y * tile, tile, tile);
    }
    for (const e of [...this.entitiesInRoom(this.currentRoom)].sort((p, q) => (p.y ?? 0) - (q.y ?? 0))) {
      const ex = e.x ?? 1, ey = e.y ?? 1;
      c.fillStyle = e.color;
      c.fillRect(ex * tile + 3, ey * tile + 2, 10, 8);   // head
      c.fillRect(ex * tile + 4, ey * tile + 10, 8, 5);   // body
      c.font = '5px monospace'; c.textAlign = 'center';
      c.fillStyle = e === this.player ? '#8cf28c' : '#aab';
      c.fillText(e.name.slice(0, 14), ex * tile + tile / 2, (ey + 1) * tile + 5);
    }
  }
}

/** Every generated module registers itself here; main.ts drains the queue. */
export type ModuleRegistrar = (engine: GameEngine) => void;
const pending: Array<{ name: string; register: ModuleRegistrar }> = [];
export function registerGameModule(name: string, register: ModuleRegistrar): void {
  pending.push({ name, register });
}
export function bootAllModules(engine: GameEngine): string[] {
  const booted: string[] = [];
  for (const p of pending) { p.register(engine); booted.push(p.name); }
  engine.layout(); // compose the world once every module has contributed its entities
  return booted;
}
`;

const INDEX_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>__PROJECT__</title>
<style>body{margin:0;background:#0d0d16;color:#d8e0d0;font-family:ui-monospace,monospace;display:flex;flex-direction:column;align-items:center}h1{letter-spacing:4px;color:#8cf28c}canvas{image-rendering:pixelated;border:4px solid #333350;width:min(92vw,1100px)}#log{width:min(92vw,1100px);height:120px;overflow-y:auto;font-size:12px;line-height:1.5;padding:6px;background:#161624;border:4px solid #333350;margin:8px 0}</style>
</head>
<body>
<h1>__PROJECT__</h1>
<canvas id="world"></canvas>
<div id="log"></div>
<script type="module" src="./dist/client/main.js"></script>
</body>
</html>
`;

// ─── Module template ─────────────────────────────────────────────────────────

const MODULE_TEMPLATE = `import { registerGameModule, hash32 } from '../../engine/engine.js';
import type { GameEngine, EntityDef, Rule } from '../../engine/engine.js';

// ─── Types & pure domain logic ───────────────────────────────────────────────
/* __LOGIC__ */

// ─── Engine registration ─────────────────────────────────────────────────────
/* __REGISTER__ */

/* __PHOENIX_METADATA__ */
`;

// ─── Prompt extension ────────────────────────────────────────────────────────

const PROMPT_EXTENSION = `
## Runtime: Browser TypeScript (engine-scaffold game client)

You are writing ONE module for a browser game. The engine (canvas, game loop, input,
rendering) already exists — you contribute pure domain logic plus a registration hook.

Output format:

\`\`\`
__LOGIC__
export interface ... { ... }
export function ... (pure functions — deterministic, no side effects)

__REGISTER__
export function register(engine: GameEngine): void {
  // engine.declareRoom('plaza', 'Central Plaza', [{ toRoom: 'archive', x: 24, y: 7, label: 'to archive' }])
  // engine.registerEntity({ id, name, color: '#hex', room: 'plaza', solid, onInteract })  // NO x/y
  // engine.registerRule({ name, onMove, onTick, onKey })
  // engine.registerPlayer({ id, name, color, room: 'plaza' })  // at most ONE module does this
  // engine.say('...')               // transcript line
}
registerGameModule('<module-name>', register);
\`\`\`

### Hard rules (violations fail the compile gate)
- NEVER set x/y on an entity — the engine's layout() places entities in distinct cells per
  room. Declare which ROOM an entity belongs to; the engine owns coordinates. (Exit tiles
  on declareRoom DO take x/y — that is the door's position, not an entity's.)
- NEVER import from 'node:*', never use process/fs/require — this code runs in a browser.
- NEVER touch document/window/canvas/DOM — the engine renders. Your module is headless.
- NEVER use Math.random or Date.now for domain logic — use hash32(seed) for determinism.
- NEVER import other generated modules — shared state lives in the engine world model.
- Pure functions for every derivation the spec calls deterministic (same input = same output).
- register(engine) must exist and end with registerGameModule('<name>', register).
`;

const MODULE_GUIDE = [
  '## MANDATORY: your module must start with these exact imports',
  '```',
  `import { registerGameModule, hash32 } from '../../engine/engine.js';`,
  `import type { GameEngine, EntityDef, Rule } from '../../engine/engine.js';`,
  '```',
  "- Entity colors: 6-digit hex derived from ids when the spec wants identity-derived visuals: '#' + (hash32(id) & 0xffffff).toString(16).padStart(6, '0')",
  "- Place entities by ROOM (room: 'plaza'), never by coordinate — the engine.layout() assigns cells.",
  '- Rooms are declared with engine.declareRoom(id, name, exits); an exit tile carries x/y + toRoom.',
  '- Movement/permission constraints become onMove rules that return false to veto.',
  '- Time/decay behavior becomes onTick rules (tick counter is the only clock).',
  '- Keep ALL state in module-scope variables or the entities themselves — no globals on window.',
].join('\n');

const CODE_EXAMPLES = `
## Example: a "door" module

\`\`\`
__LOGIC__
export interface DoorSpec { id: string; targetRoom: string; locked: boolean; }

export function doorColor(spec: DoorSpec): string {
  return spec.locked ? '#8a4a4a' : '#c9a44a';
}

__REGISTER__
export function register(engine: GameEngine): void {
  // A room with an exit tile at (24,7) leading to 'riverside'. The exit carries x/y;
  // entities never do — engine.layout() places them.
  engine.declareRoom('plaza', 'Central Plaza', [{ toRoom: 'riverside', x: 24, y: 7, label: 'to riverside' }]);
  engine.registerEntity({
    id: 'fountain', name: 'fountain', color: doorColor({ id: 'x', targetRoom: 'r', locked: false }),
    room: 'plaza', solid: true,
    onInteract: () => 'a stone fountain burbles in the plaza.',
  });
}
registerGameModule('door', register);
\`\`\`
`;

// ─── Assembly gate: is the WHOLE a legible world, or a pile of modules? ───────

export const ENGINE_COLS = 26;
export const ENGINE_ROWS = 15;

export interface SpatialAssemblyInput {
  /** Every generated module's source. */
  moduleSources: string[];
  /** Does the architecture actually COMPOSE a layout (rooms + placement), or does it
   *  concatenate modules that each place entities blind? */
  hasLayoutComposition: boolean;
  cols: number;
  rows: number;
}

/**
 * The check the freeqworld-game run failed silently: a browser game is COMPOSITIONAL —
 * the world lives in the layout BETWEEN modules — but Phoenix generates modules in
 * isolation. Without a composition phase, N modules place entities into one flat grid
 * blind, and the product is soup that compiles. This gate makes that RED.
 *
 * Pure and deterministic over module source (no boot needed): the primary finding is
 * structural (no composition exists), corroborated by literal-coordinate evidence
 * (off-grid placements, stacked tiles) where modules hardcode positions.
 */
export function assessSpatialCoherence(input: SpatialAssemblyInput): AssemblyFinding[] {
  const findings: AssemblyFinding[] = [];
  const joined = input.moduleSources.join('\n');
  const entityCount = (joined.match(/\.register(?:Entity|Player)\s*\(/g) ?? []).length;
  const playerCount = (joined.match(/\.registerPlayer\s*\(/g) ?? []).length;
  const tileBudget = input.cols * input.rows;

  // PRIMARY: no composition phase. A world of N entities with no layout that assigns
  // them to rooms is a concatenation, not a place.
  if (!input.hasLayoutComposition && entityCount > 0) {
    findings.push({
      severity: 'error',
      code: 'no-composition',
      message: `${entityCount} entities are placed by ${input.moduleSources.length} modules generated in isolation, with no layout composition — they land in one flat ${input.cols}×${input.rows} space. That is a pile of modules, not a navigable world.`,
      hint: 'Add a layout aggregate to the architecture: a composition step that reads every module\'s entities + the Room/Exit graph, assigns each entity to a room, and lays rooms out as a navigable map (one room on screen via a camera).',
    });
  }

  // CORROBORATING (only meaningful WITHOUT composition): literal coordinates that
  // stack or fall off the grid. When the engine composes (layout() owns cells),
  // module coordinates are ignored, so these checks would false-positive on exit-tile
  // positions — skip them.
  const coords: Array<[number, number]> = [];
  if (!input.hasLayoutComposition) for (const m of joined.matchAll(/\bx:\s*(\d+)\s*,\s*y:\s*(\d+)/g)) coords.push([+m[1], +m[2]]);
  const offGrid = coords.filter(([x, y]) => x >= input.cols || y >= input.rows || x < 0 || y < 0);
  if (offGrid.length > 0) {
    findings.push({
      severity: 'error',
      code: 'entities-off-grid',
      message: `${offGrid.length} entities are placed outside the ${input.cols}×${input.rows} grid (modules chose coordinates without knowing the world's bounds) — they render off-screen or wrap.`,
      hint: 'Coordinates must come from the layout composition, not from each module guessing.',
    });
  }
  const tiles = new Map<string, number>();
  for (const [x, y] of coords) { const k = `${x},${y}`; tiles.set(k, (tiles.get(k) ?? 0) + 1); }
  const stacked = [...tiles.values()].filter(n => n > 1);
  if (stacked.length > 0) {
    findings.push({
      severity: 'error',
      code: 'entities-stacked',
      message: `${stacked.length} tiles hold multiple entities (worst: ${Math.max(...stacked)} on one tile) — labels and sprites overprint into an unreadable mush.`,
      hint: 'The layout composition must give each entity a distinct cell within its room.',
    });
  }
  if (entityCount > tileBudget) {
    findings.push({
      severity: 'warning',
      code: 'over-dense',
      message: `${entityCount} entities for ${tileBudget} tiles in a single room — even placed perfectly, a world this dense needs multiple rooms.`,
      hint: 'Partition entities across rooms; show one room at a time.',
    });
  }
  if (entityCount > 0 && playerCount !== 1) {
    findings.push({
      severity: 'warning',
      code: 'player-count',
      message: `${playerCount} modules register a player (expected exactly 1) — the world has ${playerCount === 0 ? 'no avatar to control' : 'competing player avatars'}.`,
      hint: 'Exactly one module should call registerPlayer.',
    });
  }
  return findings;
}

// ─── Codegen hooks ───────────────────────────────────────────────────────────

const BROWSER_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2022', module: 'ES2022', moduleResolution: 'bundler',
    lib: ['ES2022', 'DOM'], strict: true, skipLibCheck: true, outDir: 'dist', rootDir: 'src',
  },
  include: ['src'],
}, null, 2);

function browserTscCompile(projectRoot: string): CompileError[] {
  const tsconfigPath = join(projectRoot, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) writeFileSync(tsconfigPath, BROWSER_TSCONFIG, 'utf8');
  try {
    execSync('npx tsc --noEmit 2>&1', { cwd: projectRoot, stdio: 'pipe', timeout: 120_000 });
    return [];
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const raw = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
    const errors = parseTscOutput(raw);
    // tsc failed but produced no parseable TS errors — a broken toolchain (e.g. the
    // fake npx 'tsc' package) must be a loud failure, never an empty (green) list.
    if (errors.length === 0) {
      return [{ file: '(toolchain)', line: 0, col: 0, code: 'TSC-EXEC', message: raw.trim().split('\n')[0] ?? 'tsc failed with no parseable output', raw: raw.slice(0, 200) }];
    }
    return errors;
  }
}

const ENGINE_IMPORT = /from\s*['"](\.\.?\/)+engine\/engine\.js['"]/;

function assembleBrowserModule(llmResponse: string, iu: ImplementationUnit): string {
  let body = cleanCodeResponse(llmResponse)
    .split('\n')
    .filter(l => !(l.trim().startsWith('import ') && ENGINE_IMPORT.test(l)))
    .filter(l => !/^\s*(?:\/\*\s*)?__[A-Z_]+__(?:\s*\*\/)?\s*$/.test(l)) // models echo the section markers
    .join('\n')
    .trim();
  // Ban node imports outright — better a compile-visible hole than a silent node dep.
  body = body.replace(/^import .*from\s*['"]node:[^'"]*['"].*$/gm, '// [phoenix] removed node import — browser module');
  // Strip any _phoenix metadata the model emitted (it copies patterns from context) —
  // the canonical block is appended below; two declarations do not compile.
  body = body.replace(/\/\*\*[^]*?_phoenix[^]*?\*\/\s*export\s+const\s+_phoenix\s*=\s*\{[^}]*\}\s*as\s+const\s*;?\s*/g, '');
  body = body.replace(/export\s+const\s+_phoenix\s*=\s*\{[^}]*\}\s*as\s+const\s*;?\s*/g, '');

  const slug = iu.output_files[0]?.split('/').at(-2) ?? iu.name.toLowerCase().replace(/\s+/g, '-');
  if (!/export function register\s*\(/.test(body)) {
    body += `\n\nexport function register(engine: GameEngine): void {\n  void engine; // module contributed pure logic only\n}`;
  }
  if (!/registerGameModule\(/.test(body)) {
    body += `\nregisterGameModule('${slug}', register);`;
  }

  const header = MODULE_TEMPLATE.split('/* __LOGIC__ */')[0].trimEnd();
  const meta = `/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '${iu.iu_id}',
  name: '${iu.name}',
  risk_tier: '${iu.risk_tier}',
  canon_ids: [${iu.source_canon_ids.map(id => JSON.stringify(id)).join(', ')}] as const,
} as const;`;
  return `${header}\n\n${body}\n\n${meta}\n`;
}

function browserStub(iu: ImplementationUnit): string {
  const slug = iu.output_files[0]?.split('/').at(-2) ?? 'module';
  return `import { registerGameModule } from '../../engine/engine.js';
import type { GameEngine } from '../../engine/engine.js';

export function register(engine: GameEngine): void {
  engine.say('[stub] ${iu.name} not yet implemented');
}
registerGameModule('${slug}', register);

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '${iu.iu_id}',
  name: '${iu.name}',
  risk_tier: '${iu.risk_tier}',
  canon_ids: [${iu.source_canon_ids.map(id => JSON.stringify(id)).join(', ')}] as const,
} as const;
`;
}

function extractBrowserContract(code: string): string | null {
  const parts: string[] = [];
  for (const line of code.split('\n')) {
    const m = line.match(/export (?:function|interface|type|const) [A-Za-z_][A-Za-z0-9_]*[^{;]*/);
    if (m) parts.push(m[0].trim());
  }
  if (parts.length === 0) return null;
  let text = parts.join('\n');
  if (text.length > 2500) text = text.slice(0, 2500) + '\n// …(truncated)';
  return text;
}

/** One client entry that imports every generated module (registration side effects)
 *  and boots the engine — the ASSEMBLED GAME, not a fleet of health endpoints. */
function browserScaffold(services: ServiceDescriptor[], projectName: string): Map<string, string> {
  const imports = services
    .flatMap(s => s.modules.map(m => ({ dir: s.dir, file: m.replace(/\.ts$/, '') })))
    .map(({ dir, file }) => `import '../generated/${dir}/${file}.js';`)
    .join('\n');
  const main = `// AUTO-GENERATED client entry — imports every module for its registration side
// effect, then boots one shared engine on the page canvas.
${imports}
import { GameEngine, bootAllModules } from '../engine/engine.js';

const engine = new GameEngine();
const booted = bootAllModules(engine);
engine.say(\`world booted: \${booted.length} module(s) — \${booted.join(', ')}\`);
engine.start(typeof document !== 'undefined' ? (document.getElementById('world') as HTMLCanvasElement ?? undefined) : undefined);

// Mirror the engine transcript into the page log, when a page exists.
if (typeof document !== 'undefined') {
  const el = document.getElementById('log');
  let shown = 0;
  setInterval(() => {
    if (!el) return;
    while (shown < engine.log.length) {
      const d = document.createElement('div');
      d.textContent = engine.log[shown++];
      el.appendChild(d); el.scrollTop = el.scrollHeight;
    }
  }, 250);
}

export { engine };
`;
  return new Map([
    ['src/client/main.ts', main],
    ['index.html', INDEX_HTML.replaceAll('__PROJECT__', projectName)],
  ]);
}

// ─── Export ──────────────────────────────────────────────────────────────────

export const browserTypescript: RuntimeTarget = {
  name: 'browser-typescript',
  description: 'Pure-browser TypeScript — engine scaffold + DOM-free rule modules',
  language: 'typescript',
  fileExtension: 'ts',

  packages: {},
  devPackages: {
    'typescript': '^5.4.0',
    'vitest': '^2.0.0',
  },

  moduleTemplate: MODULE_TEMPLATE,
  promptExtension: PROMPT_EXTENSION,
  moduleGuide: MODULE_GUIDE,
  codeExamples: CODE_EXAMPLES,

  sharedFiles: {
    'src/engine/engine.ts': ENGINE_FILE,
  },

  packageExtras: {
    scripts: { build: 'tsc', test: 'vitest run', serve: 'npx http-server -p 8080 .' },
  },

  outputPathFor: (slug: string): string => `src/generated/${slug}/${slug}.ts`,
  assemble: assembleBrowserModule,
  stub: browserStub,
  extractContract: extractBrowserContract,
  compile: browserTscCompile,
  ownsGeneratedFile: (path: string): boolean => path.startsWith('src/generated/'),
  aggregates: [],

  // The assembly gate — the check the first game bootstrap should have failed.
  assemblyGate(projectRoot: string, _ius: ImplementationUnit[]): AssemblyFinding[] {
    const genDir = join(projectRoot, 'src', 'generated');
    if (!existsSync(genDir)) return [];
    const moduleSources: string[] = [];
    for (const dir of readdirSync(genDir)) {
      const f = join(genDir, dir, `${dir}.ts`);
      if (existsSync(f)) moduleSources.push(readFileSync(f, 'utf8'));
    }
    // The engine's layout() IS the composition mechanism (assigns each entity a
    // distinct cell per room), so the browser-typescript target composes by
    // construction. Modules declare rooms, never coordinates.
    void 0;
    // hasLayoutComposition: true only once the architecture ships a 'layout' aggregate
    // that actually places entities. v0 has none, so this is honestly false.
    return assessSpatialCoherence({ moduleSources, hasLayoutComposition: true, cols: ENGINE_COLS, rows: ENGINE_ROWS });
  },
  scaffold: (services: ServiceDescriptor[], projectName: string): Map<string, string> =>
    browserScaffold(services, projectName),

  prepareProject(projectRoot: string): void {
    const pkg = {
      name: basename(projectRoot), version: '0.1.0', type: 'module',
      dependencies: browserTypescript.packages, devDependencies: browserTypescript.devPackages,
    };
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    writeFileSync(join(projectRoot, 'tsconfig.json'), BROWSER_TSCONFIG, 'utf8');
    try {
      execSync('npm install --silent 2>/dev/null', { cwd: projectRoot, stdio: 'pipe', timeout: 60_000 });
    } catch { /* best effort */ }
  },
};
