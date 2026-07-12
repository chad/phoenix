# NIGHT-REPORT-3 — Close the loop: the judge coaches the contestant

**Branch:** `feat/repair-loop` · **Started from:** `main`
**Goal:** [NIGHT-GOAL-3.md](./NIGHT-GOAL-3.md) — make `phoenix bootstrap` produce a
working app on the first try, or say honestly why it couldn't. Prevent the worst bug
class (schema drift) instead of merely catching it, and close the loop so verification
findings feed regeneration automatically.

## Headline

The loop is closed. Verification findings now feed regeneration **automatically**, and the
shared schema is a first-class artifact planned **before** any module is written. On fresh
cold-starts of all three real specs — ledger, hoard, afterimage — every project reached
**0 schema errors** and a **booting app that serves real requests with no 500s, zero human
edits**. This is the exact failure the three projects historically shipped: ledger's
`account`/`accounts`, hoard's `adventurer(s)`/`entries.status`/broken FK, afterimage's
`ensemble(s)`/`match(es)`/`players.name`. Schema-first **prevented** all of it; the repair
loop cleaned up the residual constraint gaps the model left. Every hard gate held.

| Metric | Before | After |
| --- | --- | --- |
| selftest green-health | 100% (30/30) | **100% (32/32)** |
| selftest overall | 97% (30/31) | 97% (32/33) |
| Full test suite | 886 green | **898 green** (+12, 0 regressions) |
| `--strict` | exit 0 | **exit 0** |
| Schema errors on cold-start (all 3 projects) | shipped broken → 500 on request 1 | **0 before repair, 0 after** |
| Verifier findings that auto-drive regeneration | 0 (the human was the loop) | **all routable ERRORs** |
| Known reds | 1 (`oracle.live-app-…`) | 1 (unchanged, honest) |

## The cold-start matrix (the proof)

Each row is a **fresh temp project** with a COPY of the real spec, `.phoenix/config.json`
provider `anthropic` / model `claude-sonnet-5`, full `phoenix bootstrap` with the repair
loop enabled, then a real boot test (`npx tsx src/server.ts`, curl every mounted route,
kill). The human's live `~/ledger`, `~/hoard`, `~/afterimage` were **never touched**.

| Project | schema err before→after | constraint err before→after | rounds | app boots + serves? | honest residual |
| --- | --- | --- | --- | --- | --- |
| **ledger** | **0 → 0** | 3 → **0** | 1 | ✅ health 200; `/account` `/account-balance` `/transaction` all **200** | none |
| **hoard** | **0 → 0** | 2 → **0** | 1 | ✅ health 200; `/adventurer` `/board` `/entry` `/hall-of-fame` all **200** | none |
| **afterimage** | **0 → 0** | 5 → **2** | 3 (budget) | ✅ health 200; `/deck-card` `/ensemble` `/match` `/player` `/player-legacy` all **200** | 2 (below) |

Schema-first planned the schema via a dedicated LLM call in every run (ledger 2 tables,
hoard 4, afterimage 5), so **schema errors were 0 *before* repair even ran** — the drift
class was prevented, not caught. The numbers are reproduced by `.phoenix/repair-status.json`
in each project (schema/constraint/build before→after, rounds, stop reason, residual).

### What the repair loop fixed

- **ledger** — 3 constraint findings on `transaction` (missing enforcement) → regenerated
  `transaction` once → **0 remain, green**.
- **hoard** — 2 constraint findings on `entry` + `adventurer` → both regenerated once →
  **0 remain, green**.
- **afterimage** — 5 constraint findings → round 1 fixed `deck-card` + `match` (5→3),
  rounds 2–3 chipped further but the count oscillated (regenerating `deck-card` cleared
  some and surfaced another) → stopped honestly at the round budget with **2 remaining**.

### What it honestly couldn't (afterimage's 2 residuals — neither is a 500)

1. **`room` — "The room tension must not exceed 12."** An **unbound constraint**: the spec
   names an entity (`room`) that resolves to no table/module. This is a spec/binding
   defect, not something regenerating code can fix — the loop correctly leaves it as an
   honest residual rather than inventing a table.
2. **`deck.card` — "a deck must have at least 30 cards" (min-count guard absent).** A
   **true constraint red**: after 3 rounds the model still hadn't added the ≥30 count
   guard. This is exactly the acceptable residual the goal describes — reported, not hidden,
   and not a runtime 500 (the app boots and serves).

Both are correctly **not** false-greened, and neither prevents the app from booting.

## What shipped (one commit per capability, each stating the metric it moved)

1. **P0 — schema-first generation** (`feat(P0)`). The shared schema is derived BEFORE
   module generation (`src/schema-plan.ts`: a dedicated LLM planning call, deterministic
   fallback) and injected into every module prompt VERBATIM with a "use exactly these
   table/column names; do NOT emit CREATE TABLE" gate (`src/llm/prompt.ts`).
   `splitSharedArtifacts` gains `preserveWins` so the pre-planned schema is authoritative
   over any stray module `CREATE TABLE`. *Metric moved:* schema errors on cold-start
   0-before-repair across all three real projects (was: all three shipped broken).
2. **P1 — the repair loop** (`feat(P1)`). After codegen + the compile gate, bootstrap runs
   a bounded repair phase (`src/repair.ts`, wired in `cli.ts`; also `phoenix repair`
   standalone). Each round runs the verifiers, routes each ERROR to the artifact that owns
   it, regenerates exactly those IUs with the findings + recommended actions VERBATIM, and
   re-verifies. **The verifier is FROZEN to the loop** — repair changes generated code
   only. Bounded (default 3 rounds), journaled (`repair` events, hashes before→after),
   honest about residuals. *Metric moved:* verifier findings that auto-drive regeneration
   0 → all routable ERRORs; green-health 30/30 → 32/32.
3. **P2/P3 — machine-readable status + capability locks** (`feat(P2)`). `runRepairPhase`
   writes `.phoenix/repair-status.json` (the exact matrix numbers, reproducible per
   project). Two new selftest capabilities locked green:
   `generation.schema-is-shared-before-modules` and
   `repair.findings-route-to-targeted-regeneration`. *Metric moved:* capability count
   30 → 32 green, overall 32/33.

## Testability without an LLM (the centerpiece discipline)

The repair loop's mechanics — finding→artifact routing, prompt assembly, re-verify, stop
conditions, journaling — are proven with an **injectable scripted repairer** over
fault-injected projects, no model required (`tests/unit/repair-loop.test.ts`, 5 tests):

- a schema fault routes to its owning IU, not the migrations artifact;
- a scripted repairer fixes it → **green in one round**, artifact hash changes, journaled;
- a repairer that **can't** fix the defect → terminates **honestly** (`stalled`, does not
  burn the budget, residual preserved);
- a partial-progress repairer respects the **round budget** (`stop: budget`);
- a finding with no owning target is surfaced **unroutable**, never silently dropped.

The real-LLM path is the *same loop* with the real generator injected — the exact code the
cold-start matrix exercised.

## New traps added to the corpora

- `tests/unit/repair-loop.test.ts` — fault-injected schema-drift projects + scripted
  repairer; locks routing, stop-conditions (green / stalled / budget / unroutable), and
  the frozen-verifier discipline as permanent regression guards.
- `tests/unit/schema-first.test.ts` — the prompt carries the frozen DDL + "exact names"
  instruction; a repair round carries findings/actions verbatim ahead of the schema; the
  plan derives from entities/constraints alone (independent of any module).
- `tests/e2e/schema-first.test.ts` — end-to-end stub bootstrap proves the pipeline
  ordering from the journal (`schema-plan` precedes every `regen`) and that `_migrations.ts`
  is owned by the pre-plan.

## Selftest scorecard diff

Green-health **100% (30/30 → 32/32)**; overall **32/33**. Two capabilities added and
locked green (`generation`, `repair`). No case flipped by aspiration — both were set green
only after empirically passing. The lone known-red
(`oracle.live-app-property-evals-not-yet-run`) stays red — the live-app harness was not
faked. Regressions 0, promotions 0.

## Hard gates — all held

1. `phoenix selftest` green-health **100%**; `--strict` **exit 0**. ✔
2. Full suite **898 green** (+12), nothing deleted or weakened. ✔
3. **The verifier stayed frozen.** Every repair round changed generated code only; no
   checker, constraint, spec, or eval was edited to reach green (enforced structurally —
   the loop has no path to the verifiers except read-only `verify()`). ✔
4. Repair terminates: bounded 3 rounds; not-green-after-N is reported honestly (afterimage
   stopped at `budget` with 2 named residuals). ✔
5. Every repair round is journaled with artifact hashes before/after. ✔
6. `~/ledger`, `~/hoard`, `~/afterimage` untouched — validation ran in fresh `/tmp` copies. ✔

## Still open

- **afterimage's true constraint red** — the missing `deck ≥ 30 cards` min-count guard
  survived 3 rounds. The repairer regenerated the module but the model didn't add the
  guard. Fix path: a stronger repair prompt for cardinality guards, or more rounds; but the
  honest ceiling here is model capability, not loop mechanics.
- **Binding-defect residuals** (afterimage's `room tension`) are unroutable by design — the
  spec names an entity that doesn't exist. These belong to the spec/canonicalizer, not the
  code repairer; surfacing them as an honest residual is correct, but closing them needs a
  spec-authoring feedback loop, not regeneration.
- **The migrations-artifact repairer** is implemented but was never exercised on the real
  matrix (schema-first prevented every migration-internal defect). It remains lightly
  tested relative to the module path.
- **`oracle.live-app-property-evals-not-yet-run`** stays red — unchanged; the live-app
  execution harness is still the one honest gap.

## How to verify

```bash
npm run build && npm test                 # 898 green
npm run phoenix -- selftest --strict      # green-health 100%, exit 0

# Reproduce one cold-start row (fresh temp copy; never touches the live demo):
D=$(mktemp -d); mkdir -p "$D/spec" "$D/.phoenix"
cp ~/ledger/spec/ledger.md "$D/spec/"
printf '{"architecture":"web-api/node-typescript","llm":{"provider":"anthropic","model":"claude-sonnet-5"}}' > "$D/.phoenix/config.json"
cd "$D" && node ~/src/phoenix/dist/cli.js bootstrap
cat "$D/.phoenix/repair-status.json"      # schema/constraint before→after, rounds, residual
PORT=3400 npx tsx src/server.ts &          # boot; curl /health and each mounted route → 200s
```
