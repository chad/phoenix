# NIGHT-GOAL — No false green survives the night

**North star:** Close Phoenix's last red — cross-entity/relational + executable
invariant checking — and *prove* the trust surface stays honest under adversarial
fault injection at scale. Headline proof: **`phoenix status` catches the Ledger
overdraft bug it currently cannot see.**

This pushes on the one thing the whole thesis rests on: *"if `phoenix status` is
trusted, Phoenix becomes the coordination substrate; if it's wrong, the system
dies."* Success is measured by Phoenix's own conscience (`phoenix selftest` + the
fault-injection meta-eval), which is designed to be un-gameable.

## The one metric

Expand the fault-injection meta-eval to a corpus of **≥3 generated apps** and
**≥15 injected faults** spanning **every constraint kind** (bound, membership,
pattern, uniqueness, reference/FK, cardinality, expr/invariant) plus the 4
structural faults (drift, missing, forbidden package, stale spec). Drive to:

- **false-green rate = 0** — HARD GATE. One false green fails the night.
- **recall = 100%** — every injected fault is caught by `status`.
- **false-red rate ≤ 5%** — clean baselines raise nothing spurious.

## Hard gates — never violate, never game

1. `green-health` stays **100%** (`phoenix selftest`). A regressed green = failure.
2. `phoenix selftest --strict` stays clean (no unflipped promotions).
3. The full suite (~742) stays green. **No test deleted or weakened to pass.**
4. A red is flipped to green **only by real capability**, verified by empirical
   probing — never by editing the assertion. Ground truth for every injected fault
   is known because *we injected it*, so a false green is unambiguous.
5. The verdict stays a **total function**: when a property can't be statically
   proven, `status` **abstains** (`indeterminate`) — it never emits OK by default.

## The work (priority ladder)

- **P0 — Reference (FK) kind** in `src/constraints/{model,extract,check}.ts`.
  "must reference an existing X" → verified against the schema/migration/FK decl.
- **P1 — Cardinality kind.** "at least one line item" / "1..N" relational counts.
- **P2 — Expr/Invariant** ("if shipped then shipped_at set"; "balance ≥ 0") routed
  to executable property evals via the oracle path (`checkProperty`). Static where
  possible, executable where necessary, **abstain** where neither can decide.
- **P3 — Flip the red.** `src/eval/suite.ts` `constraint.advanced-kinds` red →
  green (24/24 green, green-health 100%, `--strict` clean).
- **P4 — Extend the corpus.** Add constraint-class fault injectors to
  `tests/e2e/status-fault-injection.test.ts` across the demo apps; hold
  recall/precision gates at 100%.

## The magical proof (the thing to see in the morning)

On `~/ledger`, `phoenix status` today reports 1 unprovable invariant. After P2 it
must **catch the overdraft path** in `transaction.ts` as a real red — a concrete
cross-module financial bug found from intent alone. Then add the guard and show
`status` flip to green. Capture the before/after `status` output.

## Deliverable (leave on disk for morning review)

`NIGHT-REPORT.md` with:

- selftest scorecard diff (before → after),
- the fault-corpus table (app × fault-kind × caught?),
- the Ledger overdraft before/after,
- an honest **still-red / newly-discovered** section.

Work on a branch, **one commit per capability**, each commit message stating the
metric it moved. Do not talk to the human; leave the report and the branch.
