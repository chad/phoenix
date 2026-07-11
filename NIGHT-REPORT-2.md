# NIGHT-REPORT-2 — Honest coverage, then checkers that can't decay

**Branch:** `feat/robust-coverage` · **Started from:** `feat/close-last-red`
**Goal:** [NIGHT-GOAL-2.md](./NIGHT-GOAL-2.md) — make silent coverage loss impossible
(P0), benchmark extractor recall across paraphrases (P1), and migrate the constraint
checkers from regex to AST proven equivalent-or-better by differential testing (P2).

## Headline

Two of Phoenix's deepest robustness gaps are now closed and gated. A normative spec
sentence the extractor can't parse is no longer *silent* — it is **flagged as an
unverified obligation**, so the spec can never make a promise `status` doesn't know
exists. And the constraint checkers now read the real **TypeScript AST** instead of
source text, proven equivalent to the regex path everywhere it was tested and
**strictly more correct** where the regex path was fooled by dead text in a comment.
Every hard gate held; nothing flipped red→green except by real capability.

| Metric | Before (night 1) | After (night 2) |
| --- | --- | --- |
| selftest green-health | 100% (26/26) | **100% (26/26)** |
| selftest overall | 96% (26/27) | 96% (26/27) |
| `--strict` | exit 0 | **exit 0** |
| Full test suite | 751 green | **870 green** (+119, 0 regressions) |
| Silent normative sentences | *unbounded (untracked)* | **0 (gated)** |
| Constraint checker | regex (text) | **AST (compiler API), regex fallback** |
| AST↔regex disagreements | — | **0** (except 2 proven-better traps) |

## Scorecard diff

No selftest case was flipped or added: the two new capabilities harden the existing
trust surface rather than claim a new red. Green-health stays **100% (26/26)**; the
lone known-red (`constraint.executable-aggregate-invariants-not-yet-proven`) remains
red — see *still open*. `docs/CAPABILITY-EVAL.md` records both new capabilities under
"Closed since".

## P0 — The obligation ledger (silent coverage loss becomes impossible)

New gate (goal #6): **no normative spec sentence may be silently unverified.** A
sentence carrying a normative marker (`must / must not / never / cannot / can't /
always / only / shall / should / reject / require / at least / at most / unique /
valid`) is an *obligation*. It resolves to exactly one state:

- **verified** — it produced a structured constraint (any of the 7 kinds), a binding
  defect (already a diagnostic → tracked), or a derived eval that ran to pass/fail;
- **unverified** — it produced none of those → surfaced as
  `⚠ obligation · "<sentence…>" — normative but produced no checkable constraint`.

- Detector + accounting: `src/constraints/obligations.ts` (`normativeMarker`,
  `computeObligations` — a pure, exhaustively-tested function). Wired into
  `computeConstraintDiagnostics` in `src/cli.ts` (it computes the eval-tracking set,
  which needs the IU sources, then maps unverified obligations to warnings).
- Acceptance (all covered by `tests/unit/obligation-ledger.test.ts`, 33 tests):
  every extracting constraint stays **verified** (no false "unverified"); the
  unparseable phrasing *"an account balance can't dip under zero"* is **flagged**, not
  silent; a non-normative sentence (*"users like fast dashboards"*) yields **nothing**.
- On **~/ledger**: exactly **2** previously-silent normative sentences now surface —
  *"…provide at least a name and an email…"* (a non-numeric "at least", uncheckable
  today) and *"…a transaction date does not occur in the future"* (a temporal rule).
  Both are true positives; no false flags; the overdraft invariant still conforms.

## P1 — The paraphrase corpus (extractor-recall benchmark)

`tests/unit/obligation-coverage.test.ts` — for each of the 7 kinds, 10+ natural
rewordings of the same rule. Gate for **every** phrasing:
`captured-correctly OR flagged-unverified — NEVER silent`, and **wrong = 0**
(a paraphrase captured with the wrong kind/value is a corpus failure, not a success).

```
Obligation-coverage benchmark — 73 paraphrases, captured 39 (53%), flagged 34, wrong 0, silent 0
  bound        captured 5/12   membership  captured 6/11   pattern captured 8/10
  uniqueness   captured 5/10   reference   captured 5/10   cardinality captured 4/10
  expr         captured 6/10
```

**53% captured / 47% flagged / 0 silent / 0 wrong** — this is the recall number future
work must move. Building the corpus also surfaced a real precision bug: *"a maximum of
80 characters"* was being mis-captured by the cardinality parser as a relation of 80
"character" items instead of a scalar bound. Fixed by yielding measurement-unit nouns
(character / byte / word / …) from `parseCardinality` to the bound parser — a
tightening, not a loosening; the fault corpus stays recall 100% / false-green 0.

## P2 — AST checkers, migrated differentially (the decay fix)

`src/constraints/check-ast.ts` parses each module **once** with the TypeScript
compiler API and reads Zod chains as real `CallExpression`s: bound (`.max`/`.min`),
membership (`z.enum` / `z.union` of `z.literal`), pattern
(`.email`/`.url`/`.uuid`/`.datetime`/`.regex`/`.refine`), cardinality
(`z.array(...).min`/`.max`/`.nonempty`). Reference and uniqueness (SQL DDL) and the
Expr oracle route through the **same dispatch** but keep their regex/oracle path; any
non-Zod / non-TS field is delegated to the regex checker, so regex stays reachable as
the fallback it was always meant to be.

**Migration discipline:** `tests/unit/check-ast-differential.test.ts` runs BOTH
implementations over (a) the entire fault corpus (7 kinds × 3 samples) and (b) every
~/ledger generated module against its 10 extracted constraints (read-only, skipped if
absent).

### Differential-gate outcome

- **0 disagreements** over 21 corpus checks and 10 live Ledger constraints.
- The AST path is **PROVABLY more correct** on two ground-truthed traps: enforcement
  that lives only in a **comment** (`.max(80)` / `z.enum([...])` inside `/* … */`).
  The regex path reads source as text and **false-greens** them; the AST path reads
  the real chain and reports the enforcement **absent**. These are the documented
  exceptions to the zero-disagreement gate.

Because the gate was green, `status` (`computeConstraintDiagnostics`) now dispatches
**AST-first**. Verified end-to-end on Ledger: the overdraft invariant still conforms,
and the write-path Expr **mutant-kill** still fires — strip the 0-floor guard from
`transaction.ts` → `✖ constraint · transaction.invariant` is caught; restore it →
clears (ledger left byte-identical).

### New fault-corpus traps

`tests/unit/constraint-fault-corpus.test.ts` now gates the **AST default**
(`checkConstraintAst`) — the production checker — and gains two permanent traps the
old regex path false-greened (bound-in-comment, enum-in-comment). Recall stays 100%,
false-green 0, false-red 0. The differential file independently asserts the regex path
DOES false-green those two, so the improvement can never silently regress.

## Honest ledger — what is still open

- **The stretch (executable mutation-gated property runner) was not attempted.** The
  static write-path Expr check already demonstrates mutant-killing at the *status*
  level (proven again this run), but a *live* runner that executes the real generated
  module needs its DB/HTTP dependencies (better-sqlite3, Hono) stood up in-memory — a
  model-only stand-in would be synthetic and would violate this repo's honesty
  discipline. Left open rather than faked. It remains the fix path for the one
  known-red (`constraint.executable-aggregate-invariants-not-yet-proven`) and for
  `trust.behavioral-ok-is-withheld`.
- **Extractor recall is 53%.** 47% of natural paraphrases are only *flagged*, not
  *captured*. That is honest (never silent) but it is the number to push. The safe way
  up is more constraint kinds / better binding — never looser parsers (the fault
  corpus and the paraphrase `wrong = 0` gate hold that line).
- **Two genuine Ledger obligations are unverified** (non-numeric "at least", "not in
  the future"). They are correctly surfaced; closing them needs a quantifier-free
  cardinality reading and a temporal-constraint kind, respectively.

## How to verify

```bash
npm run build                          # clean
npm test                               # 870 green
npm run phoenix -- selftest            # green-health 100% (26/26)
npm run phoenix -- selftest --strict   # exit 0
cd ~/ledger && node ~/src/phoenix/dist/cli.js status   # overdraft conforms; 2 honest obligations
```
