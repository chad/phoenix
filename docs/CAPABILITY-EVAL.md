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
- **Overall pass rate: 95%** (35/37 cases) — the remaining 5% is the honest backlog
  (two re-seeded reds; the live-app red flipped green on a real, mutation-gated pass).

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
- ✅ **Schema-first generation (`generation.schema-is-shared-before-modules`)** — the
  shared database schema is now derived BEFORE any module is generated (a dedicated
  LLM planning call, with a deterministic fallback) and injected into every module
  prompt VERBATIM with a "use exactly these table/column names" gate. This prevents the
  drift → runtime-500 class at the source (singular/plural tables, phantom columns,
  broken FKs — the failure that shipped on all three real projects) rather than only
  catching it after the fact. The pre-planned schema is authoritative over any stray
  module `CREATE TABLE`. Ordering is proven end-to-end from the journal
  (`schema-plan` precedes every `regen`).
- ✅ **The repair loop (`repair.findings-route-to-targeted-regeneration`)** — the loop
  closes: after codegen + the compile gate, verifier ERROR findings are routed to the
  generated artifact that owns them and drive a TARGETED regeneration with the findings
  (+ recommended actions) VERBATIM in the prompt; the project is re-verified and the
  round repeats, bounded (default 3) and journaled. THE VERIFIER IS FROZEN TO THE LOOP:
  repair changes generated code only — never a checker, a constraint, the spec, or an
  eval. Not-green-after-N is an honest, reportable residual, never a silent success. The
  mechanics (routing, re-verify, stop conditions, journaling) are locked with an
  injectable scripted repairer, so the win holds without depending on any model.
- ✅ **The live application harness (`oracle.live-app-property-evals-not-yet-run` flipped
  red→green)** — the executable oracle now runs modules that import their world. The
  harness (`src/live-harness.ts`) BOOTS the actual generated app as a child process
  against an isolated DB (the `DB_PATH` override the scaffold already honors), drives its
  HTTP surface with deterministic seeded inputs — seed via POST routes, read the
  aggregate route, attack the write routes with an overdraft, POST a future date — and
  EARNS `behavioral-gated` conforms through the same mutation gate as the pure-function
  path: plant a bug in the governing module (strip the guard, flip the comparison, break
  the aggregate), re-boot, re-drive; every applicable mutant must be killed or the verdict
  degrades to `indeterminate`. There is no stubbed execution path — the boot is always a
  real child process; only the boot command varies (`npx tsx src/server.ts` for a
  generated project, `node app.mjs` for the harness's own `node:http`+`node:sqlite`
  self-verification fixture). Honest abstain when the app won't boot or a clean seed can't
  be produced. Wired as `phoenix verify --live`.
- ✅ **The live harness never certifies a broken app
  (`oracle.live-harness-mutation-gate-is-honest`)** — a guard-stripped app fails the live
  eval (the mutant is killed by real execution, not by pattern-matching), and a
  non-booting app abstains. `behavioral-gated` conforms is earned, never observed.
- ✅ **Deterministic guard synthesis
  (`repair.template-synthesis-closes-mechanical-findings`)** — for the MECHANICAL
  constraint kinds (bound / membership / presence / cardinality / temporal) the fix is
  not creative: each checker's inverse is a template. A repair STAGE
  (`src/repair-template.ts`) synthesizes the guard directly via the TS compiler API
  (AST-locate, minimal splice), closing findings the LLM leaves behind — including
  NIGHT-REPORT-3's exact residual (afterimage's "deck ≥ 30 cards"). Gate 5 holds: an edit
  is kept only if the FROZEN checker then says conforms AND the project still compiles;
  the verifier is never touched. Deterministic, so it runs even with no API key. Journaled
  `repair:template`.

### The known-red backlog (2)

1. **`oracle.temporal-relative-invariants-not-yet-proven`** — the absolute-temporal kind
   ("a date must not be in the future") is captured, checked, and now live-drivable. A
   RELATIVE-temporal invariant governing a state transition over elapsed time ("archived
   90 days after the last transaction") is neither captured as its own assertion kind nor
   provable — `checkProperty` abstains. *Fix: add a relative-temporal assertion kind
   (offset + anchor event + target state) and a live-harness eval that seeds an aged
   record, advances a virtual clock, and asserts the app performs the transition exactly
   at the boundary — mutation-gated like the other live evals.*
2. **`retarget.cross-runtime-verdict-parity-not-yet-reached`** — the constraint checkers
   are coupled to the node-typescript (Zod) dialect. The python-fastapi target resolves
   and generates, but the same bound expressed the Pydantic way
   (`name: str = Field(max_length=60)`) is unread, so a python module that DOES enforce
   the bound reads as `absent` — the verdict diverges from node for identical enforcement.
   *Fix: a per-runtime constraint-checker hook (a Pydantic-aware reader, or lower each
   RuntimeTarget's enforcement to a common shape the checkers consume) so the same
   constraint earns the same verdict on either runtime.*

Each red is a concrete next piece of work with a known fix — the eval doubles as the
roadmap. Eighteen capabilities have now been closed by the Red→Green loop; the live-app
execution tail is closed, and the backlog was re-seeded (never left empty) with two
honest reds from the genuinely-open frontier.
