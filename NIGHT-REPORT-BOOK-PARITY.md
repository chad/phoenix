# Night Report — book-parity workstreams

**Window**: from `ed35095` to `6a0c527` (6 commits). **Directive**: do the remaining
book-parity workstreams; commit frequently; document blockers; working testable
results over perfection. **Result**: 4 workstreams landed green, 1 deferred with
reasoning, 1 deprioritized. Suite **1180 passed / 1 skipped**; selftest green-health
**100% (41/41)**; 0 regressions; backlog non-empty.

## What landed (each: design → implement → hermetic tests → suite+selftest green → commit)

| Commit | Workstream | What it does | Tests |
|---|---|---|---|
| `2a0bc89` | **WS4 deletion test** (ch9) | `phoenix deletion-test <iu>|--all` — the four properties (boundary clarity, evaluation coverage, coupling depth, replaceability) from the reference + eval graph. Read-only; never mutates the project. `deletionScorecard` = the ch9 replaceability spectrum as a number. | 4 |
| `a73b1cc` | **WS5 compaction** (ch10–11) | `phoenix compact` — proposals-only mass reduction: over-fragmented entities (WS2), dead weight (WS4), orphan canon, mass budget. Never merges/deletes itself. | 5 |
| `bd9d909` | **WS3-mutation** (ch16) | Conservation-layer regen refusal: `phoenix regen` refuses an uncovered conservation IU unless `--allow-conservation-change`. `filterConservationProtected` is pure/tested. | 4 (pace) |
| `6a0c527` | **WS1 core composition** | The engine gains rooms + camera + `layout()` — deterministic, collision-free cell assignment per room. This is browser-game's composition mechanism; `composes` now includes `interactive-client`. Modules declare rooms, never coordinates. Hermetic e2e proves a walkable multi-room world (real tsc + headless boot). | e2e + gate |

## Real-world payoff (on the 151-IU freeqworld-adapted plan)

- **Grain** (WS2, prior): `151/151 ok (0 fragment, 0 monolith, 20 over-fragmented)` — the debt is visible.
- **Compaction** (WS5): `"room" spread across 26 IUs (150 nodes) → consolidate toward 7`, avatar → 3, architecture → 2 — each with evidence + a verification plan.
- **Deletion test** (WS4): `0 replaceable · 0 risky · 151 unverifiable`, with named undeclared consumers + coupling depth — the truthful, ugly scorecard ch9 predicts for a system with no eval coverage and no declared boundaries.
- **Composition** (WS1): Step 0 now SELECTS browser-game for an interactive-client spec; a spec also demanding realtime/audio still halts honestly. The engine composes distinct-celled rooms with a camera you cross — no more 367-on-one-screen soup.

## Deferred — honestly, with reasons (the never-empty frontier)

1. **WS2-mutation (auto-consolidate over-fragmented entities).** Auto-merging is a genuine semantic-vs-grain judgment the book itself flags; crude packing either no-ops (re-split by tag) or produces arbitrary groupings, and it changes every plan's IU identity (e2e risk). WS5 `compact` already *proposes* the consolidation with evidence for a human to adopt — the correct place for a judgment call. Left as a seeded follow-on.
2. **realtime-presence + audio-engine composition** for browser-game. Step 0 keeps halting specs that demand them — the honest gap. Needs a real transport and an audio engine (hand-authored trust infrastructure, not an overnight LLM job).
3. **WS1 live demo capture** — the full `freeqworld-fresh` bootstrap → walkable world. Composition is proven *hermetically*; the live run is a long, real-cost LLM bootstrap best watched, not run unattended.
4. **WS4 empirical enrichment** (temp-copy delete + recompile to catch hidden compile-coupling), **WS5 `--apply`** (regenerate the merge, gate on the union of evals), **WS0-T3/T6** (parallelism plumbing — payoff only for concurrent agents; ORCHESTRATION assigns them to a dedicated Wave-A agent).

## Seven-primitives scorecard now

| Primitive | Entering the night | Now |
|---|---|---|
| Evaluations / Provenance / Intent spec | 🟢 | 🟢 |
| Architectural compilation (ch13) | 🟡 | 🟡 (Step 0 + consolidated) |
| Regenerative grain (ch12) | 🟡 measured | 🟡 measured + **proposed** (compact); auto-apply deferred |
| Pace layers + conservation (ch6/16) | 🟡 classified | 🟢 classified **+ enforced** (regen refusal) |
| Deletion test (ch9) | 🔴 | 🟢 **operational** (command + scorecard) |
| Compaction (ch10–11) | 🔴 | 🟢 **proposing** (apply deferred) |
| Composition (session finding) | 🟡 one mechanism | 🟢 **second mechanism** (layout); realtime/audio still open |

## One near-miss caught

My first WS5 draft clobbered the pre-existing `src/compaction.ts` (the storage
engine that archives cold objects — a different axis). Caught it via the build
(index.ts imports), restored from git, and renamed mine to
`compaction-proposals.ts`. No loss.

## For the morning

- Everything is committed on `feat/parity-and-proposals`; nothing left dirty.
- Try it: `phoenix deletion-test --all`, `phoenix compact`, and `phoenix status`
  (now shows Grain + Pace + Assembly + Architecture-fit lines) on
  `/tmp/freeqworld-adapted` (151-IU plan) or `~/src/freeqworld-game`.
- The composition win is real but hermetic; the satisfying live proof (a walkable
  freeqworld) is the one thing worth doing with you awake — it costs real tokens and
  deserves eyes.
