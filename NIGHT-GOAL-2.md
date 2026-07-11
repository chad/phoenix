# NIGHT-GOAL-2 — Honest coverage, then checkers that can't decay

**North star:** Convert Phoenix's two deepest robustness gaps into gated, measured
capabilities: (1) **silent coverage loss becomes impossible** — a spec obligation the
extractor can't parse is *flagged*, never dropped; (2) **the constraint checkers move
from regex to AST**, proven equivalent-or-better by differential testing against the
existing fault corpus before they take over.

You are working on the Phoenix repo at `/Users/chad/src/phoenix`. Branch off
`feat/close-last-red` into `feat/robust-coverage`. Do not talk to the human; leave
commits and a report.

## Context you need (read these first)

- `NIGHT-REPORT.md` + `NIGHT-GOAL.md` — what the previous night shipped and how the
  discipline works.
- `src/constraints/model.ts` — the 7-kind assertion algebra (bound, membership,
  pattern, uniqueness, reference, cardinality, expr).
- `src/constraints/extract.ts` — rule-based NL→constraint extraction + binding.
- `src/constraints/check.ts` — the regex-based static checkers (the decay surface).
- `src/evals.ts` — `checkProperty`, the oracle path (abstains, never false-greens).
- `src/cli.ts` → `computeConstraintDiagnostics` — where constraints become status
  diagnostics (including the write-path-aware Expr check).
- `tests/unit/constraint-fault-corpus.test.ts` — the fault-injection meta-eval:
  7 kinds × {conforming, faulted, false-green-trap}, gates false-green=0.
- `tests/e2e/status-fault-injection.test.ts` — the structural meta-eval (don't break).
- `src/eval/suite.ts` — the capability selftest (`phoenix selftest`).
- A real generated app to verify against: `~/ledger` (spec at `spec/ledger.md`).

## Hard gates — never violate, never game

1. `phoenix selftest` green-health stays **100%**. A regressed green = failed night.
2. `phoenix selftest --strict` stays clean (flip promotions to green explicitly).
3. Full suite (751+) stays green. **No test deleted or weakened to pass.**
4. Capabilities flip red→green only via real, empirically probed capability.
5. The verdict stays a total function: unprovable ⇒ ABSTAIN/flag, never OK-by-default.
6. NEW gate you will build and then hold: **no normative spec sentence may be
   silently unverified** (see P0). Once it exists, it never regresses.

## The work

### P0 — Unverified obligations become first-class diagnostics (do first)

Today, a sentence like "balances can't dip under zero" parses to *nothing* — no
constraint, no diagnostic. That is a system-level false green: the spec made a
promise and status doesn't even know it exists.

Build the **obligation ledger**: every canonical node (and, for recall, every raw
clause) whose text carries a normative marker (must / must not / never / cannot /
can't / always / only / shall / should / reject / require / at least / at most /
unique / valid) is an *obligation*. Each obligation resolves to exactly one state:

- **verified** — it produced a structured constraint (any of the 7 kinds) or a
  derived evaluation that was checked (pass/fail — either way, it's *tracked*);
- **unverified** — it produced nothing checkable. Status must surface it:
  `⚠ obligation · "<sentence…>" — normative but produced no checkable constraint
  (unverified)` with a recommended action.

Implementation guidance: do the accounting in or beside
`computeConstraintDiagnostics` (cli.ts) — you already have canonNodes, the extracted
constraints (with `source.canon_id`), and the derived evals there. Keep the marker
detector in `src/constraints/` so it's unit-testable. Beware double-counting: a
CONSTRAINT node whose assertion parsed is verified even if its binding defected (a
BindingDefect is already a diagnostic — that counts as tracked, not silent).

Acceptance (write these as tests):
- On the fault-corpus specs and `~/ledger`, every current constraint still extracts
  (no false "unverified" for sentences that DO produce constraints).
- A spec with "an account balance can't dip under zero" (unparseable phrasing today)
  yields an `unverified obligation` warning, not silence.
- A non-normative sentence ("users like fast dashboards") yields nothing.

### P1 — The paraphrase corpus (the recall benchmark, gates P0)

New meta-eval `tests/unit/obligation-coverage.test.ts`: for each of the 7 kinds,
10+ natural rewordings of the same rule (e.g. bound: "must not exceed 80" / "at most
80" / "80 characters or fewer" / "capped at 80 characters" / "longer than 80 is
rejected"…). Gate, for EVERY phrasing:

    captured-as-constraint  OR  flagged-unverified   — NEVER silent.

Report the split (captured vs flagged) in a console line like the other meta-evals —
that number is the extractor-recall benchmark future work must move. Do NOT chase
100% capture by loosening parsers into false positives; the fault corpus
(false-green=0, false-red=0) must stay green. Captured-correctly beats
captured-at-all: a paraphrase captured with the WRONG value/kind counts as a
failure of the corpus, not a success.

### P2 — AST checkers, migrated differentially (the decay fix)

Replace the regex checkers in `src/constraints/check.ts` with TypeScript-AST-based
ones (the `typescript` package is already a dependency — use its compiler API).
New module `src/constraints/check-ast.ts`:

- Parse the module source once (`ts.createSourceFile`), walk Zod call chains as real
  CallExpressions: `z.string().max(80)` etc. Cover: bound (.max/.min), membership
  (z.enum/z.literal unions), pattern (.email/.url/.uuid/.datetime/.regex/.refine),
  cardinality (z.array(...).min/max, .nonempty, .length comparisons).
- Reference + uniqueness act on SQL DDL/strings — keep the regex path for those
  (SQL is regular enough), but route the decision through the same dispatch.
- Same `ConstraintCheck` result contract, same abstain discipline.

**Migration discipline (this is the point):** add a differential harness
`tests/unit/check-ast-differential.test.ts` that runs BOTH implementations over
(a) the entire fault corpus (all kinds × all three samples), (b) every module of
`~/ledger`'s generated code against its extracted constraints (read-only). Gate:
**zero disagreements**, except where the AST checker is PROVABLY more correct — each
such case must be added to the fault corpus as a new trap proving the regex path
wrong, and called out in the report. Only after the differential gate is green does
`checkConstraint` switch its default to the AST path (keep regex reachable as a
fallback for non-TS sources).

Then run the write-path Expr check and the Ledger overdraft scenario end-to-end to
confirm nothing regressed at the status level.

### Stretch (only if P0–P2 are DONE and every gate is green)

Begin the mutation-gated executable property runner (see NIGHT-REPORT.md "still
red"): derive one runnable property eval from the Ledger overdraft invariant,
execute it against the generated module in-memory, and demonstrate mutant-killing
(strip the guard → the eval must fail). Do not flip any selftest case for this
unless the capability is real and gated.

## Deliverable

`NIGHT-REPORT-2.md` on disk: scorecard diff, the obligation-coverage numbers
(captured / flagged / silent — silent must be 0), the differential-gate outcome
(disagreements found and which implementation was right), any new fault-corpus
traps, and an honest still-open section. One commit per capability; each commit
message states the metric it moved. Update `docs/CAPABILITY-EVAL.md` if you flip or
add selftest cases.

## Verify before you stop

```bash
npm run build         # clean
npm test              # all green (751+ and growing)
npm run phoenix -- selftest           # green-health 100%
npm run phoenix -- selftest --strict  # exit 0
cd ~/ledger && node /Users/chad/src/phoenix/dist/cli.js status  # overdraft still conforms; no spurious obligations
```
