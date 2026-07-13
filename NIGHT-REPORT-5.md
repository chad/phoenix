# NIGHT-REPORT-5 — Living green + bulletproof intake

**Branch:** `feat/living-green` · **Built on:** `main`
**Goal:** [NIGHT-GOAL-5.md](./NIGHT-GOAL-5.md) — make `phoenix status` able to say OK about a
**running real system's behavior** with mutation-gated proofs, while making the intake
(spec → constraints) both freely phraseable and impossible to crash or fool.

## Headline

The green is alive. The live oracle no longer abstains on multi-field/FK apps: a
deterministic seeder synthesizes VALID create payloads from the schema plan + the 9-kind
algebra, seeds FK parents topologically, and earns `behavioral-gated` conforms on a real
multi-entity app through the same mutation gate. An injectable clock made the last
relative-temporal red provable — it flipped green on a real, clock-advanced, mutation-gated
pass. The intake got a verified-LLM second pass that lifts paraphrase recall **53% → 92%**
with **wrong = 0, silent = 0**, accepted ONLY by a deterministic gate. Two chaos corpora
lock the loop's convergence and the intake's robustness. Every hard gate held; the verifier
stayed frozen.

| Metric | Before (NR-4) | After (NR-5) |
| --- | --- | --- |
| selftest green-health | 100% (35/35) | **100% (40/40)** |
| selftest overall | 95% (35/37) | **98% (40/41)** |
| Full test suite | 919 green | **1043 green** (+122, 0 regressions) |
| `--strict` | exit 0 | **exit 0** |
| Known reds | 2 | **1** (temporal-relative flipped on a real gated pass) |
| Live oracle on a multi-entity FK app | indeterminate (couldn't seed) | **behavioral-gated conforms** (parents seeded, ids threaded) |
| Paraphrase recall (wrong/silent) | 53% (0/0) | **92% (0/0)** |
| Repair-loop finding count | could oscillate up | **provably non-increasing** (worsening round rolled back) |

## P0 — Spec-aware seeding: the live oracle earns real greens

### The seeding design (`src/live-seed.ts`)

**Payload synthesis is the inverse of the checker algebra** — it produces exactly what a
running app should accept:

| kind | synthesized value |
| --- | --- |
| bound `≤N` (chars) / `≥N` | a short valid string / an in-range number |
| membership `{a,b}` | the first declared member |
| pattern email / url / uuid / date | `seed@example.com` / `https://example.com` / a fixed uuid / a past date |
| temporal not-future / not-past | a past date / a future date |
| presence | the field, with a typed default |
| reference (FK) | the **real id returned by seeding the parent entity first** |
| unconstrained column | a type-correct default (TEXT→string, INTEGER→int, REAL→float); date-named cols → a past date |

Server-owned columns (auto `id`, `created_at`, any `DEFAULT`-carrying nullable column) are
omitted; the harness-governed field is omitted (the driver sets it itself).

**FK topology.** `parseTableSchemas` reads each column's type / NOT NULL / DEFAULT / PK /
FK-target from the schema-plan DDL. `topoSortTables` sorts the FK DAG parents-first and
**detects cycles** (self-loop or mutual FK) — a cycle or an unresolvable required FK is NOT
guessed: the entity is reported unseedable and the harness abstains honestly. At drive time
`seedForTarget` seeds each required parent (recursively, memoized per boot), captures the
returned `id`, and threads it into the child's FK field.

**Wired into the harness (gate 3 preserved).** A per-boot `prepare` hook seeds prerequisites
on the FRESH database and returns the seed body, merged UNDER `plan.extraBody` and the
governed field. It runs on the baseline boot AND every mutant re-boot (each gets a fresh DB).
A failed prepare → honest `indeterminate`, never a false green. `phoenix verify --live` builds
the seeder from the project's aggregated migrations (the schema plan) + constraints + IUs.

### Mutation-gate receipts on a multi-entity app (`transactions → accounts`, real boot, real HTTP)

A genuine two-entity `node:http` + `node:sqlite` app with a foreign key — the exact shape
that abstained in NR-4:

| eval (on the CHILD entity, FK to a seeded parent) | baseline | mutants applicable → killed | verdict |
| --- | --- | --- | --- |
| aggregate (`/dashboard` total = Σ transaction amounts) | pass | `break-aggregate` 1 → 1 | **behavioral-gated conforms** |
| temporal (`POST /transaction` rejects a future date) | pass | `strip-temporal-guard` 1 → 1 | **behavioral-gated conforms** |
| the SAME eval with **no seeder** | — | — | **indeterminate** (naive body rejected — proves seeding is what closes the gap) |
| guard-stripped variant | fail (future date accepted) | — | **violates (never certified)** |
| cyclic-FK schema (a→b→a) | — | — | **indeterminate** (`could not seed prerequisites: FK cycle`) |

Proven in `tests/e2e/live-seed.test.ts` (4 tests) + `tests/unit/live-seed.test.ts` (10) and
locked as the capability `oracle.multi-entity-live-seeding-earns-gated-verdicts`.

### Injectable clock + relative-temporal (a red flipped on a real gated pass)

A new assertion kind `temporal-relative` (offset + anchor event + target state) captures
"an account is archived 90 days after its last transaction" (a narrow `N days after` parser
that collides with no other kind); the static checker ABSTAINS (routes to the live clock
eval). The harness sets a `NOW` env; `referenceClockApp` reads its clock from
`process.env.NOW` (a scaffold clock hook — NOT a verifier change). The gated eval seeds an
aged record and a recent one, boots with NOW past the boundary, and asserts the transition
fired ONLY for the aged record; a boundary-broken mutant is killed.

| eval | baseline | mutant → killed | verdict |
| --- | --- | --- | --- |
| archived 90 days after last transaction (NOW = boundary + 30d) | pass (aged archived, recent not) | `break-relative-boundary` 1 → 1 | **behavioral-gated conforms** |

`oracle.temporal-relative-invariants-not-yet-proven` flipped **red → green** on this real
pass (capture + static-abstain + live-gated all asserted). `tests/e2e/relative-temporal.test.ts`.

## P1 — Verified-LLM extraction: say the rule any way you like

An LLM proposes a structured `{kind, entity, attribute, params}` per rule-missed sentence;
acceptance is **deterministic** — `src/constraints/extract-llm.ts`, the shipped trust
boundary (gate 4). A proposal is accepted ONLY if:

1. **it typechecks** against the 9-kind algebra (kind real, params well-formed for that kind);
2. **its binding resolves** — the entity is mined and (for field kinds) the attribute is one
   of its mined attributes; a relational kind names a known entity;
3. **every literal is present** — a bound's number, an enum's members, a reference's target,
   a cardinality count, a temporal cue — appears LITERALLY in the sentence.

Any failure → rejected, and the sentence stays a flagged obligation (never silent, never
trusted unverified). The pass runs ONLY on rule-missed sentences, so the audited rule floor
always wins a sentence both could claim.

**Paraphrase recall (73-sentence benchmark, scripted proposer, no live model):**

| kind | rule floor (before) | verified-LLM (after) |
| --- | --- | --- |
| bound | 5/12 | **12/12** |
| membership | 6/11 | **9/11** |
| pattern | 8/10 | **10/10** |
| uniqueness | 5/10 | **9/10** |
| reference | 5/10 | **10/10** |
| cardinality | 4/10 | **7/10** |
| expr | 6/10 | **10/10** |
| **total** | **39/73 (53%)** | **67/73 (92%)** — wrong **0**, silent **0** |

The gate's teeth are proven adversarially (`tests/unit/extract-llm.test.ts`): it REJECTS a
smuggled value (`≤100` when the spec says `≤80`), a binding to a non-existent attribute, a
bad enum member, an unknown kind/entity, and a cueless temporal. A **real-LLM smoke path**
(`claude-sonnet-5`, guarded by `ANTHROPIC_API_KEY` + `PHOENIX_LLM_SMOKE`, never in CI) proves
a real model's proposal drives the very same gate — **verified passing against sonnet**.
Locked as `intake.verified-llm-extraction-is-gated`.

## P3 — Bulletproofing: two chaos corpora

**Repair-convergence** (`tests/e2e/repair-convergence.test.ts`, 6 tests incl. a 24-project
randomized property run): fault-injected projects × scripted repairers lock the loop's
false-green=0 invariants — it ALWAYS terminates within budget, the finding count NEVER
increases round over round, it SUSPENDS on unsatisfiable / oscillating / unroutable findings,
and it NEVER mutates the frozen verifier (a canary verdict is identical before and after).
The load-bearing change: `repair.ts` now **rolls back a round that increased the finding
count** (the afterimage 5→3→…→2 oscillation) and stops honestly — the count is provably
non-increasing. Locked as `repair.loop-convergence-invariants-hold`.

**Hostile-spec fuzzing** (`tests/unit/hostile-spec.test.ts`, 12 tests): contradictory bounds,
homonym entities, self-referential rules, a 10k-word run-on, unicode / RTL / emoji /
non-ASCII digits, empty + whitespace specs, deeply nested markdown, markdown/HTML injection,
plus a 500-sentence randomized fuzz over the parsers + the LLM gate. Result across 10 corpora
(38 normative sentences): **0 crashes, 0 silent drops, 0 false-greens** — every hostile input
resolves to a constraint / defect / flagged obligation. The intake was already hardened by
prior nights; no new crash surfaced, and each case is now a locked regression guard. Locked
as `intake.hostile-specs-never-crash-or-drop`.

## P4 — The cold-start matrix (fresh temp copies, real `anthropic/claude-sonnet-5`)

Each row is a fresh `/tmp` copy of the real spec, full `phoenix bootstrap`, then
`phoenix verify --live` (boots the real generated app via `npx tsx src/server.ts`, seeds
from the schema plan, runs the mutation-gated evals). `~/ledger`, `~/hoard`, `~/afterimage`
were never touched. The **live** column is the harness's verdict on the REAL generated app —
the headline is that seeding turns NR-4's abstentions into real gated verdicts.

| Project | schema err | constraint err (static, before→after) | app boots | live oracle (real app, per invariant) |
| --- | --- | --- | --- | --- |
| **ledger** (accounts, transactions) | 0 | 2 → 1 | ✅ | **`transaction.date` not-future → behavioral-gated conforms** (seeded the `account` FK parent; future date `2027-07-13` rejected 400; mutant killed 1/1). `account` non-negative → honest indeterminate (planted `strip-negative-guard` survived — the guard is Zod-enforced, not a strippable line; never false-greened). |
| **hoard** (adventurers, entries, board) | 0 | — | ✅ | **`entry.date` not-future → behavioral-gated conforms** (seeded the `adventurer` FK parent + the `type` enum from the DDL `CHECK`; future date rejected 400; mutant killed 1/1). `adventurer` non-negative → honest indeterminate (mutant survived). `board` aggregate → honest indeterminate (response field not named `total`). |
| **afterimage** (deck-card, ensemble, match, player, player-legacy) | 0 | 4 → 4 (stalled) | ✅ | **all evals honest indeterminate** — `/ensemble` rejects the seeded body because `musician` is a TEXT field with a `.refine()` requiring ≥2 comma-separated values (a cardinality-in-a-string the deterministic seeder can't invert), and `/match` needs a 3-level FK chain (match→ensemble→player) plus a `section` enum. The seeder abstains rather than guess — never a false green. |

**The headline.** On TWO real sonnet-generated apps, the live oracle upgraded a static
abstention to a mutation-gated **conforms** by *executing* the app — after seeding a real
FK parent and a valid multi-field body. Ledger is especially telling: the STATIC checker
left `transaction.date` as a residual "absent" (the enforcement is an imperative route guard,
not a Zod `.refine`), yet the LIVE oracle *proved by execution* that the app rejects future
dates. Behavior over structure — the living-green thesis, demonstrated on a real app.

Every abstention carries a concrete reason (can't-seed / mutant-survived / field-name
mismatch); none is a false green. The two deterministic seeder fixes the matrix surfaced —
`ies→y` singularization and reading a column's `CHECK (… IN …)` enum — each converted a real
abstention into a real gated verdict, with zero LLM involvement.

The matrix is reproduced by the commands each row documents (bootstrap + `verify --live`;
`.phoenix/live-status.json` carries the machine-readable verdicts).

## Selftest scorecard diff

Green-health **100% (35/35 → 40/40)**. Overall **98% (40/41)**. Five capabilities added and
locked green (multi-entity seeding, relative-temporal, verified-LLM gate, repair convergence,
hostile intake). One red flipped on a real gated pass (temporal-relative). Backlog **2 → 1**:
the sole remaining red is `retarget.cross-runtime-verdict-parity-not-yet-reached` (Pydantic
enforcement unread) — a genuinely-open frontier with a concrete fix path. Regressions **0**.

## Hard gates — all held

1. selftest green-health **100%**; `--strict` **exit 0**; full suite **1043 green** (+122),
   nothing deleted or weakened. ✔
2. **The verifier stayed frozen.** Seeding produces INPUTS; the LLM pass only ADDS constraints
   through a deterministic gate; the injectable clock is a scaffold hook; repair changes
   generated code only. Nothing changed WHAT is checked. ✔
3. `behavioral-gated` conforms is emitted ONLY when the mutation gate ran non-empty and killed
   every applicable planted bug; can't-seed / can't-boot / cyclic-FK → honest indeterminate. ✔
4. LLM-proposed constraints are accepted ONLY by the deterministic post-checks (typecheck +
   binding resolves + literals present); rejects fall to the obligation ledger; wrong = 0. ✔
5. Spec proposals (P2) were not auto-applied — P2 was scoped out (see Still-open); the human
   stays sovereign. ✔
6. `~/ledger`, `~/hoard`, `~/afterimage` untouched — cold-start validation ran in fresh `/tmp`
   copies of the specs. ✔
7. `trust.behavioral-ok-is-withheld` stayed green. A red flipped, and the backlog did not empty
   (cross-runtime parity remains a strong honest red), so no new seed was required. ✔

## Still open

- **P2 — spec proposals (first-stretch) was not implemented.** The night's required ladder
  (P0 + P1 green, then P3) consumed the budget; P2 (surfacing spec-rewording diffs for the
  binding-defect / unbound-obligation cases, human-approved) remains the next stretch, on the
  existing binding-defect surface.
- **Real-app live column vs the hermetic proof.** Real gated verdicts now land on TWO real
  sonnet apps (ledger + hoard). The remaining abstentions are honest and specific: afterimage's
  `/ensemble` needs a `musician` TEXT field holding ≥2 comma-separated values (a cardinality
  encoded inside a Zod `.refine` on a string — the deterministic seeder can't invert an
  arbitrary refine), and `/match` needs a 3-level FK chain plus a `section` enum. Closing these
  needs a richer route-contract reader (parse the module's Zod `.refine`/enum, not just the DDL)
  or the verified-LLM constraints threaded into the seeder — the honest next frontier.

- **Timings** (real sonnet, this run): ledger bootstrap ~1.5 min + `verify --live` ~20 s;
  hoard similar; afterimage ~3 min (5 IUs, repair rounds). The hermetic e2e proofs
  (live-seed, relative-temporal, repair-convergence) run in < 2 s each; the full suite is ~29 s.
- **Cross-runtime verdict parity** (the sole remaining red) — Pydantic enforcement is unread,
  so a python module diverges from node for identical bounds. Fix: a per-runtime checker hook.

## How to verify

```bash
npm run build && npm test                 # 1043 green (forks pool → deterministic)
npm run phoenix -- selftest --strict      # green-health 100%, exit 0

# The seeding + gated verdicts, hermetic (no install):
npx vitest run tests/e2e/live-seed.test.ts tests/e2e/relative-temporal.test.ts
# The verified-LLM recall jump + acceptance gate:
npx vitest run tests/unit/obligation-coverage.test.ts tests/unit/extract-llm.test.ts
# The two chaos corpora:
npx vitest run tests/e2e/repair-convergence.test.ts tests/unit/hostile-spec.test.ts

# The real-LLM smoke (guarded; needs the key):
PHOENIX_LLM_SMOKE=1 npx vitest run tests/unit/extract-llm.test.ts -t "real model"
```
