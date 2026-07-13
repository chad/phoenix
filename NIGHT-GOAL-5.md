# NIGHT-GOAL-5 — Living green + bulletproof intake

**North star:** Make `phoenix status` able to say OK about a **running real system's
behavior** — on all three cold-start apps, with mutation-gated proofs — while making
the intake (spec → constraints) both **freely phraseable** and **impossible to crash
or fool**. Two frontiers: the green isn't fully alive yet (the live oracle boots real
apps but ABSTAINS because it can't build valid payloads), and the intake is the last
soft spot (~53% paraphrase capture; spec defects still need a human; hostile input
untested).

You are working on the Phoenix repo at `/Users/chad/src/phoenix`. Branch off `main`
into `feat/living-green`. Do not talk to the human; leave commits and a report.

## Context you need (read these first)

- `NIGHT-REPORT-3.md`, `NIGHT-REPORT-4.md`, `docs/CAPABILITY-EVAL.md` — the loop, the
  live oracle, the discipline. Match the codebase's honesty idiom and comment density.
- `src/live-harness.ts` — boots the real app (child process, isolated DB), runs
  mutation-gated evals, currently ABSTAINS on real apps because generic single-field
  seeding can't satisfy multi-field/FK POST contracts. This is P0's target.
- `src/schema-plan.ts` — the planned schema (tables, columns, FKs) available BEFORE
  generation. P0 seeding draws valid payload shapes from here.
- `src/constraints/{model,extract,check,check-ast}.ts` — the 9-kind algebra and its
  checkers. Their INVERSE is the payload generator (bounds→in-range, enum→a member,
  pattern→valid, presence→required, reference→a real parent id).
- `src/repair.ts`, `src/repair-template.ts` — the repair loop + deterministic guard
  synthesis. P2 (spec proposals) is a sibling stage.
- `src/eval/suite.ts` — the two current honest reds
  (`oracle.temporal-relative-invariants-not-yet-proven`,
  `retarget.cross-runtime-verdict-parity-not-yet-reached`) and
  `trust.behavioral-ok-is-withheld` (MUST stay green: ungated conforms → incomplete).
- `tests/e2e/live-harness.test.ts`, `tests/e2e/status-fault-injection.test.ts`,
  `tests/unit/constraint-fault-corpus.test.ts`, `tests/unit/obligation-coverage.test.ts`
  — the meta-eval patterns to extend.

## Hard gates — never violate, never game

1. selftest green-health **100%**; `--strict` exit 0; full suite (921+) green; no test
   deleted or weakened.
2. The verifier stays frozen to the repair loop and to every generator here. Payload
   synthesis, LLM extraction, and spec proposals may make code/specs SATISFY findings
   — they may NEVER change what is checked.
3. `behavioral-gated` conforms is emitted ONLY when the mutation gate ran non-empty and
   killed every applicable planted bug. Can't-seed / can't-boot → honest indeterminate,
   never a false green.
4. LLM-proposed constraints (P1) are accepted ONLY by deterministic post-checks (types
   against the algebra, binding resolves, values literally present in the sentence).
   Rejected proposals fall to the obligation ledger — never silently dropped, never
   trusted unverified. Wrong-capture rate stays 0 on the paraphrase corpus.
5. Spec proposals (P2) are NEVER auto-applied. They are surfaced for human approval.
   The human stays sovereign over intent.
6. Do NOT touch `~/ledger`, `~/hoard`, `~/afterimage`. Cold-start validation uses fresh
   temp copies of their specs (real LLM anthropic/claude-sonnet-5; key in env).
7. If a red flips green, it flips only on a real pass. If the backlog would empty, seed
   at least one new honest red from the genuinely-open tail (cross-runtime parity stays
   a strong candidate; also: adversarial-spec residues you find in P3).

## The work

### P0 — Spec-aware seeding: the live oracle earns real greens (the centerpiece)

Make the live harness construct VALID request payloads deterministically from what
Phoenix already knows, so its evals run against real apps instead of abstaining.

1. **Payload synthesis** (new, e.g. `src/live-seed.ts`): for an entity's create route,
   emit a valid body from the schema plan + constraints — bound→a mid-range value,
   membership→a declared member, pattern→a valid instance (email/url/uuid/date),
   presence→include the field, temporal→a past date, scalar→a typed default. Seeded RNG
   (deterministic). For fields with no constraint, a type-correct default.
2. **FK topology / ordering**: reference constraints define a DAG over entities
   (transaction→account, ensemble→player, deck→ensemble). Topologically sort; seed
   parents first; thread returned ids into children's FK fields. Cycles / unresolvable
   FKs → seed what you can and honestly abstain on the rest (log which).
3. **Run the evals for real**: aggregate equality (seed N via POST, read the aggregate
   route, compare to the sum accepted), state invariant (drive the overdraft attack on
   every write route, assert rejection + read-side preservation), temporal (POST a
   future record, assert 4xx). Keep the mutation gate: planted bug → eval must fail.
4. **Injectable clock** for temporal-relative invariants: have the harness set a `NOW`
   env var the generated app honors (a small, honest scaffold change so the app reads
   the clock from env — a scaffold improvement, NOT a verifier change). Then "retire 90
   days after last entry" is executable: seed, advance NOW, assert. If — and only if —
   this genuinely runs gated, flip `oracle.temporal-relative-invariants-not-yet-proven`
   green.
5. Wire results into `phoenix verify --live` and the status expr path (consume gated
   verdicts for the aggregate/state/temporal invariants). Bound runtime; log timings.
6. Tests: extend `tests/e2e/live-harness.test.ts` — a multi-entity FK golden project
   where seeding SUCCEEDS end-to-end and earns a gated pass; a guard-stripped variant
   where the live eval fails (mutant-kill on a real multi-entity app); an unseedable
   variant (cyclic FK) that abstains honestly.

### P1 — Verified-LLM extraction: say the rule any way you like

An LLM proposes structured constraints per normative sentence; acceptance is
deterministic (gate 4). New module (e.g. `src/constraints/extract-llm.ts`) invoked as
a SECOND pass after the rule extractor: for sentences the rules left as unverified
obligations, ask the model for `{kind, binding, params}`, then accept only if it
typechecks, binds to a mined entity.attribute, and its literals appear in the sentence.
The rule extractor stays the deterministic floor and cross-check; on any disagreement
for a sentence BOTH captured, the rule result wins (it's audited).

Gate: extend `tests/unit/obligation-coverage.test.ts` with a scripted proposer (no live
LLM in CI) proving the 73-paraphrase benchmark moves to **≥90% captured, wrong = 0,
silent = 0**. Add a real-LLM smoke path guarded by the API key, not run in CI.

### P2 — Spec proposals: the spec talks back (first-stretch; do after P0+P1 are green)

For each binding defect and unverified obligation, generate a concrete spec-rewording
PROPOSAL: a unified diff on the spec file with provenance (which line, which
entity.attribute it would bind to, why), surfaced by `phoenix repair --spec`. Never
auto-applied (gate 5). Deterministic proposals for the mechanical cases (an unbound
subject that is one token from a known entity → propose the qualified phrasing, as the
"room tension" → "match room tension" fix); LLM-drafted for the rest, shown as
suggestions. Test with the afterimage-class defects on a temp copy.

### P3 — Bulletproofing: two chaos corpora

1. **Repair-convergence suite** (`tests/e2e/repair-convergence.test.ts`): N
   fault-injected projects × a scripted repairer, gating the invariants yesterday's
   stall taught us — the loop ALWAYS terminates, NEVER increases finding count round
   over round, SUSPENDS on unsatisfiable/conflicting findings (the binding-conflict
   path), and never mutates the verifier. This is the loop's false-green=0 gate.
2. **Hostile-spec fuzzing** (`tests/unit/hostile-spec.test.ts`): contradictory bounds,
   homonym entities, self-referential rules, a 10k-word run-on, unicode/RTL/emoji,
   empty and whitespace specs, deeply nested markdown. Phoenix must NEVER throw, NEVER
   false-green, NEVER silently drop a normative sentence — every hostile input resolves
   to defect / flag / conflict / honest-abstain. Fix every crash or silent drop found;
   each becomes a locked case.

### P4 — The matrix, final form

Re-run all three cold-starts (fresh temp copies, real sonnet). Targets: 0 errors,
0 schema errors, AND the live-oracle column shows **real gated verdicts** (not
abstains) wherever seeding succeeds — ledger's overdraft + dashboard-sum proven by
execution is the headline. Spec-defect residues remain honest residues. Record the
matrix with a `live` column: gated-pass / honest-abstain (+reason) per invariant.

## Deliverable

`NIGHT-REPORT-5.md`: the seeding design (how payloads + FK ordering are derived), the
live matrix with real gated verdicts, mutation-gate receipts on a multi-entity app, the
paraphrase-recall jump (before→after, wrong/silent still 0), sample spec proposals, the
two chaos suites' results (crashes/silent-drops found + fixed), selftest scorecard diff
(reds flipped/seeded), timings, and an honest still-open section. One commit per
capability; each message states the metric it moved.

## Verify before you stop

```bash
npm run build && npm test                 # all green (921+ and growing)
npm run phoenix -- selftest --strict      # green-health 100%, exit 0
# NIGHT-REPORT-5.md's matrix is reproduced by the commands it documents
```
