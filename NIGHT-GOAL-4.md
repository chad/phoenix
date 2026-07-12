# NIGHT-GOAL-4 — The live oracle: run the app, prove the invariants, flip the last red

**North star:** Close the final known-red — `oracle.live-app-property-evals-not-yet-run`
— with a REAL live harness: boot the generated app against in-memory dependencies,
drive it through its own HTTP surface, execute the aggregate/temporal/state
invariants the static oracle can only abstain on, and earn `conforms` through the
same mutation gate the pure-function path already uses. Then make repair finish the
job the LLM sometimes won't: deterministic guard synthesis for the mechanical
constraint kinds. End state: **all three cold-start specs reach zero constraint
errors, and `phoenix status` can say OK about a running system's behavior — with a
gate that proves the OK was earned.**

Two agents before you refused to fake this harness. That was correct. Tonight it
gets built for real or reported honestly as still-open — nothing in between.

You are working on the Phoenix repo at `/Users/chad/src/phoenix`. Branch off
`feat/repair-loop` (NOT main — tonight builds on the repair loop) into
`feat/live-oracle`. Do not talk to the human; leave commits and a report.

## Context you need (read these first)

- `NIGHT-REPORT-3.md` (the repair loop + cold-start matrix), `NIGHT-REPORT-2.md`,
  `docs/CAPABILITY-EVAL.md` — the discipline. Match the codebase's honesty idiom.
- `src/constraints/exec-runner.ts` — the pure-function mutation-gated runner. The
  live harness is its big sibling: same gate philosophy, real app instead of a
  sandboxed function.
- `src/eval/suite.ts` — the known-red case `oracle.live-app-property-evals-not-yet-run`
  (what "flipped honestly" must mean) and `trust.behavioral-ok-is-withheld` (which
  must STAY green: ungated property conforms stays `incomplete`).
- `src/models/validation.ts` — `behavioral-gated` is already the only non-static
  method that may reach OK. The live harness emits it; nothing else changes there.
- `src/repair.ts`, `src/schema-plan.ts`, `src/cli.ts` (bootstrap + repair phases,
  `computeConstraintDiagnostics`) — where P1 hooks in.
- A generated app's anatomy (any cold-start temp project, or read `~/ledger`
  WITHOUT modifying it): `src/app.ts` exports the hono `app` (with `app.fetch` —
  routes are drivable IN-PROCESS, no port needed), `src/db.ts` (better-sqlite3;
  note the DB path — you will need an in-memory or temp-file override),
  `src/generated/_migrations.ts` self-registers on import.

## Hard gates — never violate, never game

1. selftest green-health stays **100%**; `--strict` exit 0; full suite (898+) green;
   no test deleted or weakened.
2. The verifier stays frozen to the repair loop. The live harness is part of the
   VERIFIER — the repair loop may consume its findings but never influence it.
3. `behavioral-gated` conforms may be emitted ONLY when the mutation gate ran and
   killed every applicable planted bug. An eval that can't kill a planted bug
   certifies nothing (degrade to indeterminate with the reason).
4. The live harness must be REAL: the actual generated app code, actually executing
   requests. No model-only stand-ins, no pre-recorded fixtures posing as execution.
   If it cannot be built soundly tonight, the red stays red and the report says why.
5. Deterministic guard synthesis (P1) may only make code SATISFY an existing
   verifier finding — never alter what is checked.
6. Do NOT touch `~/ledger`, `~/hoard`, `~/afterimage`. Cold-start validation uses
   fresh temp copies of their specs, as NIGHT-REPORT-3 documents.
7. If (and only if) the last red flips green: the backlog must not go silently
   empty. Seed at least TWO new honest reds from the genuinely-open tail, each with
   a real probing `run` and a concrete `redReason` fix path. Strong candidates:
   spec-authoring repair (binding defects like "room tension" need a spec-side
   loop, not regeneration); verified-LLM extraction recall (the paraphrase corpus
   sits at ~53% captured); temporal-relative invariants ("retire 90 days after…");
   cross-runtime verdict parity (python-fastapi is a retarget stub).

## The work

### P0 — The live app harness (the centerpiece)

New module (e.g. `src/live-harness.ts`). Given a generated project root:

1. **Boot in isolation**: run the app with an ISOLATED database (in-memory or a
   temp copy — never the project's real `data/`). Two viable routes; pick and
   justify one: (a) in-process — import `src/app.ts` via a cache-busted dynamic
   import with a DB-path override (env var the generated `db.ts` already honors, or
   a small, honest scaffold change to make the DB path env-overridable — a scaffold
   improvement, not a verifier change); (b) child process — `npx tsx src/server.ts`
   on an ephemeral port with `DATABASE_PATH`/`PORT` env, HTTP via fetch. In-process
   is faster for mutation rounds; child-process is more faithful. Either must
   support N boots (baseline + mutants) in one run.
2. **Derive live property evals** from the constraints the static path abstains on
   (reuse `deriveAggregateProperty` + add the state/temporal shapes):
   - aggregate equality ("dashboard total = sum of balances"): seed entities via
     the app's own POST routes, read the aggregate route, compare to the sum of
     what was accepted. Seeded RNG, deterministic inputs.
   - state invariant ("balance never below zero"): drive the documented attack
     (overdraft via every write route that accepts the governed values) and assert
     rejection + invariant preservation on the read side.
   - temporal ("date not in the future"): POST a future-dated record, assert 400.
3. **The mutation gate**: for each passing eval, produce mutants of the RELEVANT
   generated module (reuse/extend the `MUTATIONS` table: strip the guard line, flip
   the comparison, constant-return the aggregate), re-boot, re-run. Every applicable
   mutant must FAIL the eval, else indeterminate. This is what makes a live green
   earned rather than observed.
4. **Wire it in**: `phoenix verify --live` (or a flag on `status`) runs the harness
   and records evidence with method `behavioral-gated`; `computeConstraintDiagnostics`'
   expr path may consume its verdicts for the aggregate/state invariants it
   currently abstains on. Keep runtime bounded (budget: seconds per eval, one
   re-boot per mutant; log timings).
5. Tests: harness mechanics against a fault-injected golden project (stub mode,
   scripted like `tests/e2e/status-fault-injection.test.ts`): correct app →
   gated pass; guard-stripped app → eval fails (mutant-kill demonstrated); app that
   won't boot → honest indeterminate. Then flip the red in `src/eval/suite.ts` only
   if the probe genuinely passes.

### P1 — Deterministic guard synthesis (repair's last mile)

NIGHT-REPORT-3's honest residual: sonnet wouldn't add afterimage's "deck ≥ 30 cards"
guard in 3 rounds. For the MECHANICAL kinds the fix is not creative — the checkers'
inverse is a template: bound → `.max(N)`/`.min(N)` on the field chain; membership →
`z.enum([...])`; presence → drop `.optional()`; cardinality → `.min(N)` on the
collection or a route-level count guard; temporal → the `isNotFuture` refine.

Add a template-repair stage to the repair loop: when a finding of a mechanical kind
survives an LLM round, synthesize the guard directly (AST edit via the TS compiler
API preferred — `check-ast.ts` already parses these chains; string surgery only
where the AST route is genuinely impractical). The synthesized edit must make the
ORIGINAL verifier finding pass, compile, and be journaled as `repair:template`.
Gate: the loop's round budget still applies; template repair is a stage, not a loop.

### P2 — The matrix, again (the proof)

Re-run the cold-start matrix (fresh temp copies, real sonnet, same commands as
NIGHT-REPORT-3): target **constraint errors 0→0 residual on all three** (template
repair should close the deck≥30 class), plus a NEW column: `live oracle` — the
harness's gated verdict per project (aggregate + overdraft evals where the spec has
them). Spec-defect residuals (afterimage's unbound "room tension") remain honest
residuals — note them, do not paper over them.

### P3 — Lock it in the eval

Flip `oracle.live-app-property-evals-not-yet-run` → green ONLY on a real pass.
Add capability case(s) for template repair. Seed the new reds per hard gate 7.
Update `docs/CAPABILITY-EVAL.md`.

## Deliverable

`NIGHT-REPORT-4.md`: how the harness boots the app (and why that route), the
mutation-gate receipts (which mutants, which evals killed them), the new cold-start
matrix with the live-oracle column, template-repair receipts (findings closed
deterministically), selftest scorecard diff (including the NEW reds), timings, and
a still-open section. One commit per capability; each message states the metric it
moved.

## Verify before you stop

```bash
npm run build && npm test                 # all green (898+ and growing)
npm run phoenix -- selftest --strict      # green-health 100%, exit 0
# NIGHT-REPORT-4.md's matrix is reproduced by the commands it documents
```
