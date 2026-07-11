# Capability Eval — Red/Green TDD for Phoenix itself

Phoenix's thesis is *"evaluations are the real codebase."* This applies that thesis
to Phoenix. `phoenix selftest` runs a suite of **capability cases** — one per claim
the system makes — and prints a scorecard that is *honest about what does not work
yet*.

```
phoenix selftest            # the Red/Green scorecard
phoenix selftest --json     # machine-diffable artifact
phoenix selftest --strict   # also exit non-zero on promotions (unflipped fixes)
```

## The discipline

- **GREEN** — a capability that is *proven to work today*. It is **locked**: the CI
  gate (`tests/eval/capability.test.ts`) fails the build if a green case ever fails.
  Green-health must stay 100%.
- **RED** — a capability that is *known-broken*. It is **expected to fail** and must
  carry a `redReason` explaining the gap and the fix. Reds are the backlog. A red is
  never deleted or hidden — it is *flipped to green* when the code catches up.
- **REGRESSION** — a green case that failed. A promise broke. Hard CI failure.
- **PROMOTION** — a red case that now passes. You fixed something; change its
  `expect: 'red'` to `'green'` to lock the win. Surfaced loudly, never silently.

The labels are set by **empirically probing the current code**, never by aspiration:
a case is green only if it demonstrably passes now.

## Why this shape

This is large-scale Red/Green TDD at the *capability* layer, not the unit layer.
Unit tests check that code does what the code says; capability cases check that
Phoenix does what Phoenix *claims* — end to end, across ingestion → canonicalization
→ classification → invalidation → constraint enforcement → provenance → oracle →
regeneration → retargeting → the trust surface's own honesty. The red set makes the
distance-still-to-travel a first-class, diffable artifact instead of tribal
knowledge. It is, for the project, what `phoenix status` is for a generated app.

## Current snapshot

*(Regenerate with `phoenix selftest`. Green-health is the load-bearing number — it
must be 100%. The overall pass rate climbs as reds are fixed and flipped.)*

- **Green health: 100%** — every proven capability still holds (0 regressions).
- **Overall pass rate: 97%** (29/30 cases) — the remaining 3% is the honest backlog.

### Closed by the Red→Green loop (red → green)

- ✅ **`canonicalization.compound-sentence-preserves-subject`** — the segmenter now
  carries the subject noun-phrase across compound-modal splits. Verified on
  momentum: the canonical node is `"a habit name must not exceed 80 characters"`.
- ✅ **Membership (enum) constraint kind** — enums bind by proximity and are checked
  against `z.enum`/literal unions. Verified on momentum: `habit.cadence ∈ {daily,
  weekly}` binds correctly and the generated code conforms.
- ✅ **`oracle.catches-logic-mutation`** — the oracle now does a real enforcement
  check (non-negativity, bounds, enums, non-empty) and abstains (`indeterminate`)
  on properties it can't statically verify — it never false-greens.
- ✅ **Pattern (format) constraint kind** — `.email()/.url()/.uuid()` etc. are
  captured and statically checked.
- ✅ **`regeneration.dependents-are-regenerated`** — a contract change now
  regenerates the transitive dependents (not just flags them), via
  `dependentsToRegenerate` wired into `phoenix regen`.
- ✅ **Uniqueness constraint kind** — "email must be unique" is captured and checked
  for a `UNIQUE` declaration. (Its addition caught a real ordering bug as a
  REGRESSION — pattern was matching "email" first — which was then fixed; the loop
  working as designed.)
- ✅ **`regeneration.http-dependencies-detected`** — IU dependencies are now derived
  from HTTP `fetch('/route')` calls to a sibling module's mount, not just relative
  imports. This closes the *other half* of the momentum dashboard-broke bug: the
  dashboard's dependency on `habit` (via fetch) is now detected, so a `habit`
  contract change will regenerate the dashboard.

### Closed since (red → green)

- ✅ **Reference (FK) constraint kind** — "a transaction must reference an existing
  account" is captured and checked against a schema FK or an app-level existence guard.
- ✅ **Cardinality constraint kind** — "an order must have at least one line item" is
  captured and checked for a non-empty / count guard on the relation.
- ✅ **Expr/Invariant routed to the oracle** — relational/conditional invariants
  ("reject a debit that would take a balance below zero") route to `checkProperty`,
  which CATCHES a missing guard on reducible shapes and ABSTAINS otherwise. Status is
  **write-path aware**: it checks the invariant against *every* module that writes the
  governed rows and names the culprit path.
- ✅ **The obligation ledger** — a new gate: *no normative spec sentence may be
  silently unverified*. Every sentence carrying a normative marker (must / never /
  only / at least / unique / valid / …) is an obligation, resolved to **verified**
  (it produced a constraint, a binding defect, or a derived eval that ran) or
  **unverified** (flagged `⚠ obligation`). Closes the system-level false green where
  the spec made a promise `status` didn't even know existed. The paraphrase corpus
  (`tests/unit/obligation-coverage.test.ts`) is the extractor-recall benchmark:
  73 rewordings across the 7 kinds, **silent = 0** (captured 39, flagged 34, wrong 0).
- ✅ **AST constraint checkers** — the regex Zod checkers (bound / membership /
  pattern / cardinality) are migrated to the TypeScript compiler API
  (`src/constraints/check-ast.ts`), reading real Zod call chains rather than source
  text. Proven equivalent-or-better by a differential harness (0 disagreements over
  the fault corpus + every ~/ledger constraint) before becoming the status default,
  and **strictly better** on comment-injection traps the regex path false-greened
  (a `.max()`/`z.enum()` living only in a comment). SQL kinds and the Expr oracle stay
  on the (still reachable) regex/oracle fallback.

- ✅ **Executable aggregate invariants (mutation-gated)** — the runner
  (`src/constraints/exec-runner.ts`) EXECUTES a self-contained module against
  randomized trials in a vm sandbox and *earns* `conforms` through the mutation gate:
  planted bugs (sum→difference, seeded-init, constant-return) must all be killed by
  the property eval, or the pass degrades to `indeterminate`. This opens the first
  trustworthy non-static verdict cell: `verdictOf('behavioral-gated','conforms') → ok`
  — the per-eval mutation gate `trust.behavioral-ok-is-withheld` was always waiting
  on. Wrong implementations *violate* (caught by execution), dependent modules are
  honestly refused (see the red below).
- ✅ **Temporal constraint kind** — "a transaction date must not occur in the future"
  is captured and checked for a not-future validator (`.refine(isNotFuture, …)`); a
  format-only refine (`isValidDate`) does NOT count as temporal enforcement.
- ✅ **Presence constraint kind** — the quantifier-free required-fields form
  ("provide at least a name and an email") emits one constraint per field, checked
  as present-and-non-optional in the input schema. Together with temporal, this
  cleared both of ~/ledger's unverified obligations.

### The known-red backlog (1)

1. **`oracle.live-app-property-evals-not-yet-run`** — the executable runner proves
   invariants for SELF-CONTAINED modules only. A real generated module imports its
   dependencies (db, hono); executing its properties requires standing those up
   (in-memory SQLite, an HTTP shim). Today the runner honestly REFUSES such modules
   (`indeterminate: needs the live app harness`). *Fix: build the live harness — boot
   the generated app against in-memory deps and route aggregate/temporal invariants
   through the same mutation gate the pure-function path already earns its greens
   with.*

Each red is a concrete next piece of work with a known fix — the eval doubles as the
roadmap. Thirteen capabilities have now been closed by the Red→Green loop; one honest
red remains for the live-app execution tail.
