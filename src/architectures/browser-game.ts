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
  capabilities: ['interactive-client', 'domain-logic', 'realtime-presence'],
  // ...and now it COMPOSES interactive-client (engine.layout() — deterministic,
  // collision-free cells + camera) AND realtime-presence (a hand-authored real
  // WebSocket ServiceClient + a binder registry the engine consumes; modules declare
  // subscribe/publish, verified by Phoenix's integration evals against a fixture).
  // audio-engine remains out (no audio engine yet) — Step 0 still halts a spec that
  // demands it. The specific protocol (Freeq, etc.) is an app adapter over ServiceClient.
  composes: ['interactive-client', 'domain-logic', 'realtime-presence'],

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
