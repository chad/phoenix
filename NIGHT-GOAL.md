# Night Goal — advance the remaining book-parity workstreams

**Started from**: `ed35095`, 1169 tests green, selftest 41/41 green-health, 4 known-reds.
**Source of truth**: `PLAN-BOOK-PARITY.md` (untracked) — the WS designs.
**Directive**: do all the remaining workstreams; commit frequently; document blockers
and move on; **working, testable results over perfection**.

## The seven-primitives gap (what's left)

| Primitive | State entering the night | Tonight |
|---|---|---|
| Regenerative grain (ch12) | 🟡 measured (WS2 done) | mutation half: consolidate over-fragmented entities |
| Pace layers + conservation (ch6/16) | 🟡 classified (WS3 done) | mutation half: conservation-layer regen refusal + attest override |
| Deletion test (ch9) | 🔴 | **WS4** — the four-properties diagnostic |
| Compaction (ch10–11) | 🔴 | **WS5** — `phoenix compact` proposals + mass budget |
| Composition / layout (session finding) | 🟡 one mechanism | **WS1 core** — engine rooms + layout aggregate (hermetic; defer live demo) |

## Order (highest value, lowest risk first — no human to unblock overnight)

1. **WS4 — deletion test** (`phoenix deletion-test`). Self-contained, new files + command,
   no risk to existing behavior. Temp copies only (never mutate the real project).
   Reports the four properties: boundary clarity, evaluation coverage, coupling depth,
   replaceability. Feeds WS5.
2. **WS5 — compaction loop** (`phoenix compact`, proposals-only). Detectors:
   over-fragmented entities (from WS2), dead weight (from WS4), duplicate/overlapping
   IUs, orphan canon. Mass budget in config. Never auto-applies.
3. **WS3-mutation — conservation-layer regen refusal.** A regen of a `conservation:true`
   IU is refused unless evals cover it or `--allow-conservation-change`; repair loop
   skips conservation IUs with a named reason. Loud + journaled.
4. **WS2-mutation — consolidate over-fragmented entities.** Merge same-head-entity
   facets toward the grain ceiling, in the clusterer. GUARDED: only fires when an
   entity heads > threshold IUs (small specs never trigger it), full-suite gated so
   e2e IU-count assertions stay green.
5. **WS1 core — composition.** Engine world-model (rooms + camera), the `layout`
   aggregate (`declarePlacement` → deterministic cell assignment), `assemble()` strips
   literal coords, `assessSpatialCoherence` asserts the composed invariants, flip
   `browserGame.composes` to include `interactive-client`. Hermetic e2e; the full live
   freeqworld bootstrap (demo capture) is DEFERRED and documented (it's a long/cost run
   best done with a human watching).
6. **WS0-T3/T6** (bootstrap decompose, eval-suite split) — parallelism plumbing;
   deprioritized (payoff only for concurrent agents). Do only if everything else lands.

## Hard rules (unchanged, non-negotiable)

- Verifier frozen (`src/constraints/check*.ts`): widen reading, never rules.
- No silent fallback/scope-narrowing: every degradation prints + journals.
- Proposals never auto-edit intent or code (compact/deletion-test are analysis/proposal).
- Deletion test operates on TEMP COPIES only — never mutates the real tree.
- `npm test` + `node dist/cli.js selftest` green before every commit. E2E flake rule:
  a file failing in the full run but passing twice isolated is load-flake; re-run once.
- Each WS: design → implement → hermetic tests → green → commit. Story-first messages.
- Backlog never empties; seed reds with fix designs for deferred pieces.

## Progress log

- [x] WS4 deletion test — `phoenix deletion-test` + scorecard + 4 tests (2a0bc89)
- [x] WS5 compaction — `phoenix compact` proposals-only + 5 tests (a73b1cc)
- [x] WS3-mutation — conservation-layer regen refusal (bd9d909)
- [~] WS2-mutation — DEFERRED: auto-merge is a semantic/grain judgment the book flags;
      WS5 `compact` PROPOSES it for human adoption (the right place). Seeded follow-on.
- [x] WS1 core — engine rooms + layout() + camera; browser-game composes
      interactive-client; hermetic e2e proves a walkable multi-room world (6a0c527)
- [ ] WS0-T3/T6 — DEFERRED: parallelism plumbing (payoff only for concurrent agents).
- [x] NIGHT-REPORT-BOOK-PARITY.md written

(See `git log` for the real trail.)
