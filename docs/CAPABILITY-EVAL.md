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
- **Overall pass rate: 80%** (16/20 cases) — the remaining 20% is the honest backlog.

### The known-red backlog (4)

1. **`canonicalization.compound-sentence-preserves-subject`** — the segmenter splits
   a compound constraint and the second fragment loses its subject
   (`"must not exceed 40 characters"`). This is the origin of the momentum `"line"`
   mis-binding. *Fix: subject-carrying segmentation.*
2. **`constraint.non-bound-kinds-are-captured`** — only the `Bound` kind is
   implemented; enum/pattern/uniqueness/reference constraints are invisible to the
   structured-constraint layer. *Fix: implement the remaining kinds from the
   constraint algebra (`docs/PROPOSAL-constraint-algebra.md` §5).*
3. **`oracle.catches-logic-mutation`** — the oracle is structural term-matching, not
   behavioral; code that mentions the fields but violates the invariant passes.
   *Fix: executable/property evals + a per-eval mutation gate.*
4. **`regeneration.dependents-are-regenerated`** — dependents of a changed IU are
   flagged for re-validation but not rebuilt, so an upstream contract change can
   break a downstream module until a manual `regen --all`. *Fix: act on the
   revalidate set.*

Each red is a concrete next piece of work with a known fix — the eval doubles as the
roadmap.
