/**
 * Architecture: browser-game
 *
 * A browser-rendered interactive world. A shared ENGINE (shipped as scaffold — game
 * loop, tile renderer, keyboard input, actor/rule registry) owns the canvas; every
 * generated module contributes pure domain logic (entities, rules, interactions) and
 * a register(engine) hook. Modules never touch the DOM — the engine is the only
 * code that renders, which keeps modules deterministic, testable headless, and
 * regenerable one at a time.
 *
 * Born from the freeqworld lesson: web-api compiled a game spec into 131 services
 * and no game. This architecture is the missing vocabulary. v0 HONESTY: it provides
 * an interactive client and domain logic — it does NOT yet provide realtime-presence
 * (no server transport) or an audio engine; the fit gate will keep saying so until
 * those are earned.
 */

import type { Architecture } from '../models/architecture.js';

export const browserGame: Architecture = {
  name: 'browser-game',
  description: 'Browser-rendered interactive world — canvas engine scaffold + pure rule modules',

  communicationPattern: 'events',
  dataOwnership: 'per-component',
  evaluationSurface: 'unit-tests',

  // v0: no realtime-presence (no transport yet), no audio-engine. Declaring them
  // before they exist would re-create the exact silent gap this target was built
  // to close.
  capabilities: ['interactive-client', 'domain-logic'],
  // ...but it only COMPOSES domain-logic. It can EXPRESS an interactive client
  // (modules define entities + rules) yet has NO layout aggregate to assemble a
  // navigable world — so interactive-client is deliberately absent here. This is the
  // honest declaration that makes Step 0 refuse to ship soup: a game spec finds no
  // architecture that both expresses AND composes an interactive client, and halts.
  composes: ['domain-logic'],

  systemPrompt: `## Architecture: Browser Game Client

This system is an interactive, browser-rendered world built on a shared engine.

### Structure
- ONE engine (already provided as scaffold — do not generate it) owns the canvas,
  the game loop, keyboard input, and the actor/rule registries.
- Each module contributes DOMAIN LOGIC ONLY: entity definitions, movement/interaction
  rules, pure functions. Modules register their contributions via an exported
  register(engine) function.
- Modules NEVER touch the DOM, window, document, or canvas. The engine renders.
- Modules NEVER import from other generated modules — shared state lives in the
  engine's world model.

### Communication
- Modules react to engine events (tick, move, interact, key) by registering rules.
- A rule can veto a move (collision), mutate world state, or emit follow-up events.

### Evaluation Surface
- Every module is testable HEADLESS: construct an engine without a canvas, register
  the module, drive engine.tick()/engine.tryMove() from a unit test, assert world state.

### Translating requirements to implementation
- "X appears in the world" → an entity definition spawned in register()
- "the player can …" → an input or interaction rule
- "X must not …" → a rule that vetoes (returns false from) the action
- "X is derived from Y deterministically" → a pure exported function (hash-based, no Math.random)
- visual style requirements → engine config (tile size, palette), not DOM code
`,

  runtimeTargets: ['browser-typescript'],
};
