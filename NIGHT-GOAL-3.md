# NIGHT-GOAL-3 — Close the loop: the judge coaches the contestant

**North star:** `phoenix bootstrap` produces a **working app on the first try** — or
says honestly why it couldn't. Today the pipeline is generate → verify → *tell the
human*; every cold-start run shipped schema-drifted modules that 500 on request one,
with the fix already sitting in the diagnostics. The human has been the repair loop.
Tonight the loop closes: **verification findings feed regeneration automatically**,
and the shared schema becomes a first-class artifact so the worst bug class is
prevented rather than caught.

You are working on the Phoenix repo at `/Users/chad/src/phoenix`. Branch off `main`
into `feat/repair-loop`. Do not talk to the human; leave commits and a report.

## Context you need (read these first)

- `NIGHT-REPORT.md`, `NIGHT-REPORT-2.md`, `docs/CAPABILITY-EVAL.md` — the discipline
  and what already exists. Match the codebase's comment density and honesty idiom.
- `src/cli.ts` — `cmdBootstrap` (the generate pipeline), `computeSchemaDiagnostics`,
  `computeConstraintDiagnostics`, `checkExprWritePaths`, the status diagnostics flow.
- `src/schema-contract.ts` — the schema contract checker (parse DDL → verify SQL).
- `src/constraints/{extract,check,check-ast}.ts` + `src/evals.ts` — the verifiers.
  THE LOOP MAY NEVER MODIFY THESE TO GET GREEN. They are the oracle.
- `src/regen.ts`, `src/llm/prompt.ts`, `src/architectures/node-typescript.ts` — how
  module prompts are built and how regeneration works today.
- `src/scaffold.ts`, the `_migrations.ts` region assembly — how the shared schema
  artifact is currently produced (per-IU regions merged after the fact).
- Real evidence of the failure class: the three projects' history — ledger
  (`account` vs `accounts`), hoard (`adventurer(s)`, `entries.status`, broken FK),
  afterimage (`ensemble(s)`, `match(es)`, `players.name`). All three shipped broken.

## Hard gates — never violate, never game

1. `phoenix selftest` green-health stays **100%**; `--strict` stays exit 0.
2. Full suite (886+) stays green. No test deleted or weakened.
3. **The verifier is the oracle and is frozen to the loop**: repair changes GENERATED
   CODE only. A repair iteration that would edit a checker, a constraint, the spec,
   or an eval to reach green is a violation of the night.
4. Repair must terminate: bounded rounds (default 3/project). Not-green-after-N is
   an HONEST outcome — report exactly what remains and why, never loop forever and
   never claim success.
5. Every repair round is journaled (provenance): which findings, which IUs, what
   changed (artifact hashes before/after).
6. Do NOT touch `~/ledger`, `~/hoard`, `~/afterimage` — those are the human's live
   demos. Cold-start validation happens in fresh temp projects using COPIES of their
   spec files.

## The work

### P0 — Schema-first generation (prevention)

Today each IU's prompt imagines its own tables; `_migrations.ts` is stitched from
per-IU regions afterward, and modules drift from it (singular/plural, phantom
columns, broken FKs — observed on all three real projects).

Invert it: derive/emit the shared schema BEFORE module generation, then hand every
module prompt the schema DDL **verbatim** with an instruction that all SQL must use
exactly these table/column names. Implementation freedom: either (a) a dedicated
schema-planning LLM call that produces the DDL from the canonical entities +
constraints, or (b) generate migrations region-first, reconcile with
`parseSchema`, and inject the parsed model into subsequent prompts. Either way the
prompt for every module must contain the final table/column names.

Acceptance: a unit/e2e test proving module prompts contain the shared DDL, and (in
stub mode) that the pipeline ordering is schema-before-modules.

### P1 — The repair loop (the night's centerpiece)

After codegen + compile gate in bootstrap, add a **repair phase**:

1. Run the verifiers (schema contract + constraint diagnostics + build). These are
   already functions — call them, don't shell out.
2. Map each ERROR finding to its owning IU (schema findings carry `file`/`iu_id`;
   constraint findings carry `iu_id`; migration findings map to the schema artifact).
3. For each offending IU, build a REPAIR prompt: the module's current source + the
   findings VERBATIM (message + recommended action) + the shared schema DDL + the
   instruction to change only what the findings require.
4. Regenerate exactly those IUs (reuse the existing generation path; keep promptpack
   hashes/journal entries so provenance shows repair rounds).
5. Re-verify. Repeat up to the round budget. Stop early when schema+constraint
   errors are 0 and the project compiles.
6. Surface the loop in bootstrap output: `Repair round 1: 5 findings → 2 IUs
   regenerated → 1 finding remains`, and a final honest line either way.

Expose the same loop as `phoenix repair` (runnable on an existing project), since
that's how you'll iterate while developing.

Testability without an LLM: the round mechanics (finding→IU mapping, prompt
assembly, re-verify, stop conditions, journaling) must be unit-tested with an
injectable repairer (a function `(iu, findings, source) => newSource`) — the tests
use a scripted repairer over fault-injected projects (extend the golden-project
pattern from `tests/e2e/status-fault-injection.test.ts`). The real-LLM path is the
same loop with the real generator injected.

### P2 — The cold-start matrix (the proof)

For each of the three real specs (copy `spec/*.md` from `~/ledger`, `~/hoard`,
`~/afterimage` into fresh temp projects; same `.phoenix/config.json` — provider
anthropic, model claude-sonnet-5; the API key is in the environment):

- Run full `phoenix bootstrap` with the repair loop enabled.
- Record: schema errors before repair / after; constraint errors before / after;
  rounds used; does the app BOOT and serve a request (`npx tsx src/server.ts`, curl
  a route, kill it).
- Target: **all three reach 0 schema errors + 0 false constraint errors + booting
  app with zero human edits.** A TRUE constraint red that survives (a rule the model
  genuinely didn't implement after N rounds — e.g. a missing count guard) is an
  acceptable, honest residual: report it as such. Runtime 500s are not acceptable.

Budget guard: if generation costs explode (an IU repeatedly failing), stop that
project at the round budget and report; do not burn unbounded tokens.

### P3 — Lock it in the eval

- New selftest capability case(s), green only if empirically true, e.g.
  `repair.findings-route-to-targeted-regeneration` (scripted-repairer test) and
  `generation.schema-is-shared-before-modules`. Flip nothing else. The known-red
  `oracle.live-app-property-evals-not-yet-run` stays red unless you REALLY build the
  live harness (do not fake it).
- Update `docs/CAPABILITY-EVAL.md` with anything flipped/added.

## Deliverable

`NIGHT-REPORT-3.md`: the cold-start matrix (project × errors before/after × rounds ×
boots?), what the repair loop fixed vs. what it honestly couldn't, any new traps
added to the corpora, selftest scorecard diff, and a still-open section. One commit
per capability; each commit message states the metric it moved.

## Verify before you stop

```bash
npm run build && npm test                 # all green
npm run phoenix -- selftest --strict      # exit 0
# the matrix in NIGHT-REPORT-3.md is reproduced by the commands it documents
```
