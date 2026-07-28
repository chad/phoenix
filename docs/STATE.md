# Phoenix — State of the System

> A map of what Phoenix does today, the gates that make it trustworthy, and how
> close each of the book's seven primitives is. Kept current; if it drifts from the
> code, the code wins and this doc is a bug.

## The pipeline

Phoenix is a causal compiler for intent. A spec becomes a verified, running system
through stages that each emit provenance:

```
vision doc ──(adapt)──▶ operational spec ──(ingest)──▶ clauses
   │  LLM drafts, human adopts;                          │
   │  every rule cites its source line                   ▼
   │                                          canonical requirement graph
   │                                                     │  (canonicalize: rule + LLM normalize)
   ▼                                                     ▼
[Step 0: ARCHITECTURE ADEQUACY] ◀───────── derive shape (capability demands)
   │  can a registered architecture EXPRESS + COMPOSE this shape?
   │  select it · confirm the human's · or HALT with the spec of what must be authored
   ▼
IU planning (semantic clustering) ──▶ schema-first planning ──▶ code generation
   │                                                                │ (concurrent, per-IU compile-retry)
   ▼                                                                ▼
[COMPILE GATE] the assembled system typechecks ──▶ [REPAIR LOOP] verifier findings → regen (bounded)
   │                                                                │
   ▼                                                                ▼
[ASSEMBLY GATE] is the WHOLE coherent as the spec's system? ──▶ Trust Dashboard (phoenix status)
```

Everything is receipted in `.phoenix/journal.jsonl` (`src/journal.ts`,
`JournalEventType`). Selective invalidation (the defining PRD capability): editing
one spec line invalidates only the dependent subtree.

## The gate inventory (why green means something)

Phoenix gates PARTS and the WHOLE. A gate that can't fail is decoration; each of
these can go red on real input.

| Gate | Question | Where | Can halt? |
|---|---|---|---|
| **Architecture adequacy** (Step 0) | Can an architecture express AND compose this spec's shape? | `src/architecture-adequacy.ts`, `src/architecture-fit.ts` (demand detection) | **yes** (unless `--accept-inadequate-architecture`) |
| **Compile gate** | Does the assembled system typecheck? | `runCompileGateAndReport` in `src/cli.ts`; `target.compile` | warn-first (alpha) |
| **Repair loop** | Can verifier findings be closed by bounded regen? | `src/repair.ts`; frozen verifier `src/constraints/check.ts` | stops on `stalled`/budget |
| **Assembly gate** | Is the generated product coherent as a whole, not just compiling parts? | `RuntimeTarget.assemblyGate`; `assessSpatialCoherence` (browser) in `src/architectures/browser-typescript.ts` | downgrades `✔` → `◑` |
| **Regeneration gate** | Is an IU legible/bounded/evaluated enough to regenerate? | `src/regen-gate.ts`, `src/audit.ts` | warn-first |

Discipline (non-negotiable): the verifier is frozen (widen reading, never rules);
no silent fallback or scope-narrowing (every degradation prints + journals);
proposals never auto-edit intent; the LLM never writes trust infrastructure.

## The seven primitives (book parity scorecard)

| Primitive (book ch) | State | Where / gap |
|---|---|---|
| Evaluations are the codebase (5) | 🟢 strong | `src/eval/suite.ts` (55 cases), `selftest`, red-backlog-as-roadmap |
| Provenance (14) | 🟢 strong | journal; `phoenix why` (file → IU → model/promptpack → spec line); line provenance |
| Intent specification (20) | 🟢 | `phoenix adapt` — vision → structured intent with dropped/invented ledger |
| Architectural compilation (13) | 🟡 begun | Step 0 adequacy enforces intent→architecture→code at the front door |
| Regenerative grain (12) | 🔴 violated | grain set by token budget (`MAX_CLUSTER`), not evaluability/blast-radius → see PLAN WS2 |
| Pace layers + conservation (6,16) | 🔴 model-only | `src/models/pace-layer.ts` exists, never assigned → PLAN WS3 |
| Deletion test (9) | 🔴 not built | no deletion diagnostic → PLAN WS4 |
| Compaction (10–11) | 🔴 measured only | mass measured, never reduced → PLAN WS5 |
| Composition (session finding; book gap) | 🟡 one mechanism | aggregates (SQL migrations); assembly gate; layout aggregate pending → PLAN WS1 |

## Architectures & runtimes

- `web-api` (expresses+composes http-api, domain-logic, persistence) → runtimes
  `node-typescript` (Hono + better-sqlite3 + Zod), `python-fastapi`.
- `browser-game` (expresses interactive-client + domain-logic; **composes only
  domain-logic** — interactive-client composition is the honest gap Step 0 halts
  on) → runtime `browser-typescript` (hand-authored engine scaffold + DOM-free
  rule modules).
- Registry + adequacy declarations: `src/architectures/`.

## Known-red backlog (the roadmap; never empties)

`node dist/cli.js selftest` lists the current reds with their fix designs in
`redReason`. As of this writing: incremental per-clause canonicalization, python
live-boot oracle, entity→table resolution beyond plural, array-FK seeding.

## Working plans (untracked, in repo root)

- `PLAN-BOOK-PARITY.md` — the workstreams (WS0–WS7) to reach full book parity.
- `ORCHESTRATION.md` — how to run those workstreams across parallel sub-agents
  with per-task model tiers.
