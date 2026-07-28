# NIGHT-GOAL-6 — Parity, the spec talks back, and a seeder that reads the route

**North star:** Finish the four open items left standing after NIGHT-REPORT-5:

1. **Cross-runtime verdict parity** — the sole remaining red
   (`retarget.cross-runtime-verdict-parity-not-yet-reached`). The checkers read only
   the Zod dialect; a Pydantic `Field(max_length=60)` enforcing the SAME bound reads
   as `absent`. Give the checker a per-runtime enforcement reader so identical
   enforcement earns an identical verdict on either runtime — then flip the red on a
   real pass.
2. **P2 — spec proposals ("the spec talks back")** — scoped out of night 5. For each
   binding defect and unverified obligation, generate a concrete spec-rewording
   PROPOSAL (unified diff + provenance), surfaced by `phoenix repair --spec`, NEVER
   auto-applied. Every surfaced rewording is validated by re-running the FROZEN
   extractor on the proposed sentence — a proposal is only shown when it provably
   resolves. The human stays sovereign over intent.
3. **The afterimage frontier — a route-contract reader for the seeder.** The live
   oracle abstains on afterimage because `/ensemble` needs a `musician` TEXT field
   holding ≥2 comma-separated values (a cardinality inside a Zod `.refine`) and
   `/match` needs a `section` enum that lives in the module's Zod schema, not the DDL.
   Read the generated module's route contract (enums, refine-shapes, required fields)
   and feed it to the seeder as an overlay — converting those abstentions into real
   gated verdicts. Unknown shapes still abstain honestly.
4. **One item from the README what's-next list.** Decision rule: multi-file specs and
   the integration-level oracle are already done (nights 4–5); Freeq transport needs
   an external service; a new architecture target can't be honestly validated tonight
   without a deployed runtime. That leaves **incremental (per-clause)
   canonicalization** — "make the whole cycle selective, not just regen" — as the
   headline. Attempt it if P0–P2 land green with budget to spare; the bar is a
   hermetic proof that incremental output is IDENTICAL to full canonicalization on an
   unchanged spec and touches only the changed clause's subtree on an edit. If it
   doesn't make the bar, seed it as an honest red with the fix path documented.

You are working on the Phoenix repo at `/Users/chad/src/phoenix`. Branch off `main`
into `feat/parity-and-proposals`. Do not talk to the human; leave commits and a report.

## Context you need (read these first)

- `NIGHT-REPORT-5.md`, `docs/CAPABILITY-EVAL.md` — the discipline. Match the
  codebase's honesty idiom and comment density.
- `src/constraints/{model,check,check-ast}.ts` — the checker layer the parity reader
  plugs into. `checkConstraint` dispatches per kind; `check-ast` delegates non-Zod to
  the regex path (so Python modules already flow to `check.ts`).
- `src/architectures/python-fastapi.ts` — the Pydantic dialect to read:
  `Field(min_length=, max_length=, le=, ge=)`, `Literal[...]`, `class X(str, Enum)`,
  `EmailStr`/`AnyUrl`/`pattern=`, `field_validator`, `Optional[...] = None`.
- `src/constraints/obligations.ts`, `src/constraints/extract.ts` (`resolveBinding`,
  `mineEntityAttributes`) — the defect/obligation surfaces spec proposals operate on.
- `src/live-seed.ts`, `src/live-verify.ts` — the seeder + its wiring; the
  route-contract overlay enters via `buildSeedPrepare`.
- `src/eval/suite.ts` — the red to flip and the scorecard discipline.
- `tests/e2e/live-seed.test.ts` — the hermetic live-eval test pattern to extend.

## Hard gates — never violate, never game

1. selftest green-health **100%**; `--strict` exit 0; full suite (1043+) green; no
   test deleted or weakened.
2. **The verifier's semantics stay frozen.** The parity reader changes only what the
   checker can *read* (a second dialect), never the verdict logic — same constraint,
   same rules, wider eyes. Spec proposals and the route-contract overlay produce
   INPUTS and SUGGESTIONS; nothing changes WHAT is checked.
3. A red flips green only on a real pass. If the backlog would empty, seed at least
   one new honest red from the genuinely-open tail (the natural successor:
   live-oracle verdicts on python-fastapi apps — the harness boots node/tsx only,
   and its mutations speak Zod).
4. Spec proposals are NEVER auto-applied and are surfaced only when the frozen
   extractor proves they resolve (or are explicitly marked informational). The human
   stays sovereign over intent.
5. The route-contract overlay only ever makes seeding MORE valid; an unreadable
   refine/enum shape stays an honest abstention, never a guessed green.
6. Do NOT touch `~/ledger`, `~/hoard`, `~/afterimage`. Cold-start validation uses
   fresh temp copies only, if run at all (real sonnet, key in env).
7. `trust.behavioral-ok-is-withheld` and every existing green MUST stay green.

## The work

### P0 — Pydantic enforcement reader (flip the parity red)

1. New module `src/constraints/pydantic.ts`: dialect detection (`BaseModel` +
   `Field(`/`Literal[`/`field_validator`/`EmailStr`) and per-kind readers mirroring
   `check.ts`'s exact verdict semantics (conforms / violates / absent /
   indeterminate, including the mentioned-elsewhere ⇒ absent vs not-found ⇒
   indeterminate distinction):
   - bound: `max_length`/`le` for `<=`, `min_length`/`ge` for `>=`
   - membership: `Literal[...]` in the annotation; `class X(str, Enum)` members
   - pattern: `EmailStr` / `AnyUrl` / `UUID` / `pattern=` / `field_validator('attr')`
   - presence: declared and NOT `Optional[...]` and no `= None`/`default=None`
   - cardinality: `min_length`/`max_length` on a `list[...]` field, `conlist(...)`
   - temporal: a `field_validator` on the attribute carrying the future/past cue
   - uniqueness/reference: SQL DDL is language-agnostic — existing readers already
     work; route them through unchanged.
   - expr / temporal-relative: keep abstaining (honest).
2. Wire in `checkConstraint`: when the source reads as Pydantic (and isn't Zod),
   dispatch to the reader. Qualified-name matching mirrors the Zod path
   (`owner_email` for `email`).
3. Flip `retarget.cross-runtime-verdict-parity-not-yet-reached` to green with an
   EXTENDED case: bound + membership + presence parity, AND parity of the negative
   results (wrong value → violates on both; unenforced → absent on both).
4. `tests/unit/pydantic-reader.test.ts` — per-kind conforms/violates/absent/
   indeterminate matrix + a Zod↔Pydantic parity matrix (same constraint, equivalent
   sources, identical verdicts).
5. Seed the successor red: `oracle.live-verdicts-on-python-apps-not-yet-earned`
   (harness boots node/tsx only; mutations speak Zod; fix path: per-runtime boot
   command + dialect-aware mutation strategies).

### P1 — Spec proposals: `phoenix repair --spec`

1. New module `src/spec-proposals.ts`: for each binding defect and each unverified
   obligation, generate a candidate rewording of the EXACT spec line via
   deterministic strategies — entity qualification (insert the one known entity the
   subject's attribute belongs to), cue canonicalization (normative phrasings the
   rule floor misses → the canonical forms it recognizes). Each candidate is
   VALIDATED by re-running the frozen extractor: surfaced as a diff ONLY when the
   proposed sentence resolves (defect → bound constraint; obligation → captured).
   Conflicting bounds get an informational proposal naming both lines — no value is
   chosen for the human.
2. CLI: `phoenix repair --spec` prints unified diffs grouped by file with
   provenance (line, what it binds to, why); `--json` for machines. Read-only —
   nothing is written; no auto-apply path exists.
3. `tests/unit/spec-proposals.test.ts`: afterimage-class defects and rule-floor
   misses from the paraphrase corpus — a surfaced proposal provably resolves under
   re-extraction; an unresolvable sentence yields an honest "no confident proposal";
   nothing touches the filesystem.

### P2 — Route-contract reader (the afterimage frontier)

1. New module `src/route-contract.ts`: read a generated module's Zod create-schema —
   per field: `z.enum` value sets (incl. named-const indirection), simple
   cardinality-in-string refines (`.split(',').length >= N`), optional/required,
   format validators. Unknown refine shapes are skipped honestly.
2. Wire as a seeder overlay in `live-verify.ts`/`live-seed.ts`: precedence DDL CHECK
   → route-contract enum → constraints → csv-min-parts → type default. FK recursion
   already handles the chain; the overlay fixes the root-cause body rejections.
3. Tests: unit (reader matrix) + a hermetic e2e in the `live-seed` pattern: a
   fixture app with an `/ensemble`-class route (CSV ≥ 2 + Zod-only enum + FK parent)
   that seeds WITH the overlay and abstains WITHOUT it.
4. If budget allows, re-run the afterimage cold-start in a fresh /tmp copy (real
   sonnet) and record the live column's new verdicts.

### P3 — Incremental per-clause canonicalization (conditional)

Attempt only after P0–P2 are green and committed. The capability: unchanged clauses'
canonical nodes are reused verbatim (keyed by clause content), only added/modified
clauses re-extract — and the graph is PROVEN identical to a full canonicalization on
a corpus of specs + single-line edits. If it lands: lock it as a capability. If not:
seed it as an honest red with the fix path, and say so plainly in the report.

## Deliverable

`NIGHT-REPORT-6.md`: the parity design + verdict matrices, the flipped red and the
seeded successor, sample spec proposals (with their validation receipts), the
route-contract design + the afterimage-class e2e receipts, P3's outcome (landed or
honestly deferred), the selftest scorecard diff, timings, and an honest still-open
section. One commit per capability; each message states the metric it moved.

## Verify before you stop

```bash
npm run build && npm test                 # all green (1043+ and growing)
npm run phoenix -- selftest --strict      # green-health 100%, exit 0
# NIGHT-REPORT-6.md's claims are reproduced by the commands it documents
```
