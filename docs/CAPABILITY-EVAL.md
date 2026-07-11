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
- **Overall pass rate: 96%** (26/27 cases) — the remaining 4% is the honest backlog.

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

### The known-red backlog (1)

1. **`constraint.executable-aggregate-invariants-not-yet-proven`** — Reference,
   Cardinality, and Expr are done. The genuinely-hard tail remains: cross-entity
   **aggregate equalities** ("a dashboard total equals the sum of all account
   balances") and **temporal** invariants ("archived 90 days after…") cannot be
   *proven* by static reduction — a correct implementation is honestly abstained
   (INCOMPLETE), never false-greened. *Fix: build a real executable, mutation-gated
   property-eval runner and route these invariants to it (the same gate
   `trust.behavioral-ok-is-withheld` awaits).*

Each red is a concrete next piece of work with a known fix — the eval doubles as the
roadmap. Ten capabilities have now been closed by the Red→Green loop; one honest red
remains for the genuinely-hard executable/aggregate tail.
