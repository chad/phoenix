# NIGHT REPORT 6 — Parity, Proposals, and the Route-Contract Overlay

**Branch:** `feat/parity-and-proposals` (off main @ 3f02639)
**Goal:** NIGHT-GOAL-6.md — finish the four open items from NIGHT-REPORT-5
**Commits:** `b2628dc` (goal) → `86ed2fc` (P0) → `bd5a666` (P1) → `39176ee` (P2) → `34ecb39` (P3 red)

---

## Scorecard

| # | Item (from NR-5's open list) | Outcome | Evidence |
|---|---|---|---|
| P0 | Cross-runtime verdict parity (pydantic reader) | **DONE — red flipped green** | suite `retarget.cross-runtime-verdict-parity-not-yet-reached` now green; 25-Test Reader-Suite |
| P1 | Spec proposals (`phoenix repair --spec`) | **DONE** | neue `src/spec-proposals.ts`; 13 Tests; read-only, validation-gated |
| P2 | Route-contract reader for the seeder | **DONE** + zwei neue Reds diagnostiziert | `src/route-contract.ts`; 26 Tests; real cold-start on /tmp copy |
| P3 | Per-clause incremental canonicalization | **SEEDED AS HONEST RED** (goal's fallback) | `canonicalization.incremental-per-clause-not-yet-earned` with the full design encoded |

**Suite:** 113 files, **1105 passed / 1 skipped** (was 1043 at baseline; +62).
**Selftest:** green health **100% (41/41 kept promises)**, overall 91% (41/45), **0 regressions, 0 promotions**, backlog **4** known reds — each with the fix named.

---

## P0 — The pydantic enforcement reader (parity red → green)

`src/constraints/pydantic.ts` (~17.7 KB) reads constraint-relevant facts out of
python/pydantic source the same way `check.ts` reads Zod/TS: bounds (`Field(gt/le,
ge/max_length/min_length)`, `conlist` kwargs), membership (`Literal[...]`,
`class X(str, Enum)`), presence (`Optional[...]` / `= None` / `default=None`),
patterns (dedicated types, `pattern=`, `field_validator`), cardinality, and
absolute temporal (`PastDate`/`FutureDate`, validators comparing against
`date.today()`). It is wired FIRST into both `checkConstraint` and
`checkConstraintAst` and returns `null` for anything it does not own
(uniqueness/reference are SQL-level and language-agnostic; expr and
temporal-relative stay with the existing readers) — **reading widened, rules
untouched**: verdict semantics are the frozen checker's.

The flipped eval case (id kept, `expect: 'green'`) now runs an 8-pair matrix of
Zod/Pydantic source pairs over bound, membership, and presence — each covering
conforms / violates / absent on **both** dialects. Four reader bugs were caught
by its own test suite before landing (multi-line `Field(` slicing, validator
body consumption, BaseModel-only detection, cardinality kwargs source).

**Successor red seeded:** `oracle.live-verdicts-on-python-apps-not-yet-earned` —
the *static* checker now speaks python, but the *live* oracle hardcodes the node
boot (`npx tsx src/server.ts`, `_migrations.ts`). The new `bootSpecForTarget()`
seam in `live-verify.ts` is the probe point; the red flips when boot + migrations
resolve per runtime target (uvicorn + `_migrations.py`) and the mutation patterns
are audited per dialect (python short-circuits with `raise`, not `return`).

## P1 — The spec talks back: `phoenix repair --spec`

`src/spec-proposals.ts` turns extraction failures into **validated, line-level
spec edits** — unified-diff hunks grouped by file, each carrying its
re-extraction receipt:

```
--- a/spec/habits.md
+++ b/spec/habits.md
# resolves: unverified obligation (membership) — habit cadence
# rationale: cue canonicalization ("can only be" → "must be one of")
# validation: re-extraction captured habit.cadence (one of daily, weekly), 0 defects
- a habit cadence can only be daily or weekly
+ a habit cadence must be one of daily, weekly
```

Three proposal kinds: `rewording` (validated), `informational` (conflicting
bounds — the spec contradicts itself; no auto-fix), and the honest
`no-confident-proposal`. **The gate:** a proposal surfaces ONLY if re-running the
frozen extractor on the reworded line captures ≥1 constraint with 0 defects —
the receipt rides with the diff. Two deterministic strategies: entity
qualification for binding defects (the afterimage "room tension" class — the
miner needs the entity named) and a cue-rewrite table for obligations, built by
probing the frozen rule floor's actual misses ("can only be", "restricted to",
"shall not repeat", "cannot be empty of", "capped at", …). Read-only: nothing is
ever applied; the footer prints the application path. Unverified obligations are
computed with the same `trackedByEval` semantics as `cmdStatus`.

Discoveries encoded in tests: section-level clause ingestion (one clause =
heading + bullets), `mineEntityAttributes` needs the IU graph (degrades to honest
no-proposal without `phoenix plan`), and canonicalizer article rewording
("a" → "The") defeated naive line matching.

## P2 — The route-contract overlay (the afterimage abstention, diagnosed end-to-end)

NR-5's cold-start abstained because acceptance facts lived only in the generated
Zod create-schema. `src/route-contract.ts` now reads them: inline/named-const/
**zod-const** enums (the afterimage dialect `const SectionEnum = z.enum([...])`),
unions of literals, csv `.refine` split-length shapes, `optional()`/`default()`
requiredness, scalar families, `<entity>_id` FK hints, and `*_ids` array-min
facts. Unknown shapes yield no entry — the overlay only ever makes seeding MORE
valid. Seeder precedence: **DDL CHECK → route enum → constraint algebra →
csv-min-parts → type default.**

Three seeder behaviors changed, each with a live-boot e2e:
1. A route-level FK hint (`ensemble_id` with no DDL REFERENCES) resolves to the
   real table and seeds the parent first — the ensemble create goes from
   rejected-400 to a real id.
2. A DDL-**nullable** FK the route **requires** tightens to notNull — the schema
   plan and the generated module had drifted (plan said nullable, module said
   NOT NULL), and the "valid" null FK was exactly what the route rejected.
3. A required array-of-existing-ids (`musician_ids: z.array(z.number()).min(2)`)
   abstains **early with a precise reason** instead of burning a booted POST on
   an invented id.

**Real afterimage cold-start (temp copy, originals untouched):** 0 upgrades —
honest, the frontier genuinely blocks — but the abstention vocabulary changed
from opaque 400s to the full causal chain:

```
before: match.date — no valid control accepted on /match (400)
after:  match.date — could not seed prerequisites: FK ensemble_id→ensembles:
        ensembles (route contract requires 2 existing id(s) for "musician_ids"
        (array-FK seeding is the frontier))
```

Two **new reds** were diagnosed by that run and seeded with offline probes:
- `oracle.array-fk-seeding-not-yet-earned` — resolve `*_ids` to the referenced
  table (musician → players needs more than naming), seed N parents, thread ids.
- `oracle.entity-table-resolution-beyond-plural-not-yet-earned` — the legacy
  aggregate's entity `legacy` never resolved to table `player_legacies`, so no
  prepare ran and the naive body 400'd on the required `name`. Fix: IU route-slug
  reverse lookup before the plural scan.

## P3 — Incremental canonicalization: the disciplined "not yet"

The identity bar (output provably identical to a cold full run) **fails by
construction** under today's batched LLM prompts: a clause's candidates depend on
batch-mates, so per-clause extraction can't be proven identical to the batched
run; and shipping a second extraction mode would give Phoenix two paths that can
disagree — a trust smell worse than the cost it saves. Per the goal's explicit
fallback, the gap is seeded as `canonicalization.incremental-per-clause-not-yet-earned`
with the design encoded in the redReason: per-clause extraction for BOTH paths, a
content-keyed candidate cache (text hash + model + prompt version), global
`resolveGraph` over the union, and a hermetic stub-LLM proof of identity +
zero-calls-for-unchanged-clauses. `resolveGraph`'s global steps (IDF, dedup) are
compatible with that design — only extraction's batching is not.

## Still open (the backlog IS the roadmap)

1. **Live verdicts on python apps** — boot seam + per-dialect mutation audit.
2. **Array-FK seeding** — `musician_ids: min(2)`; resolve + seed N real parents.
3. **Entity→table resolution beyond plural** — `legacy → player_legacies`.
4. **Incremental canonicalization** — per the design above.
5. **Schema-plan/module drift** (diagnosed, not yet a red): afterimage's
   `_migrations.ts` says `ensemble_id INTEGER REFERENCES…` (nullable) while the
   module registers `NOT NULL` with no REFERENCES. Tonight's overlay *tolerates*
   the drift; a drift-detector eval is the right next seed.

## Discipline receipts

- Every red that flipped kept its id; every new red carries the fix.
- Verifier semantics frozen: the pydantic reader and route-contract overlay widen
  *reading* only; no verdict rule changed anywhere.
- No false greens bought: the cold-start's 0 upgrades stand; abstentions are
  earlier and more precise, never quieter.
- `~/ledger`, `~/hoard`, `~/afterimage` untouched — all real-app work on /tmp copies.
- Full suite green on the final run; selftest green health 100%; 0 regressions.
