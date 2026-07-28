# ORG-2 vs Phoenix — a strategic read

Subject: https://github.com/org2AI/ORG2 (AGPL-3.0, v1.2.3, Tauri/Rust desktop app)
Date of read: repo state at `834f56e1`

---

## 0. The one-sentence version

ORG-2 and Phoenix are answering the **same question from opposite ends of the same
causal chain**, and neither one can reach the other end from where it stands.

- **ORG-2 records downward from the actor.** It observes what agents *did* — sessions,
  turns, tool calls, file touches — and attributes shipped lines back to the session
  that wrote them. Provenance is **observational, post-hoc, descriptive**. The artifact
  of record is the **session trajectory**.
- **Phoenix records upward from intent.** It compiles spec → clause → canonical
  requirement → implementation unit → code, emitting a provenance edge at every
  transformation. Provenance is **constructive, by-construction, prescriptive**. The
  artifact of record is the **spec graph**.

They share a diagnosis almost word for word. ORG-2's README: *"code written on Monday is
legacy by Friday... Jira sees only tickets, GitHub sees only committed lines."* Phoenix's
PRD: *"version control should operate on intent and causality, not file diffs."* Same
wound. Different surgery.

---

## 1. What they actually built

| | ORG-2 | Phoenix |
|---|---|---|
| Shape | Tauri desktop app (macOS/Win/Linux installers) | TypeScript library + `phoenix` CLI |
| Size | ~572K LOC Rust, ~67K LOC TS/TSX, 42 Rust crates | ~41K LOC TS, 575 tracked files |
| Maturity | shipping v1.2.3, signed installers, 13 locales, Discord, external contributor PRs | pre-release `0.1.0`, `git clone && npm run build` |
| Verification | 30+ dated markdown audit folders; agent-run audit skills | 126 test files, 1198 tests, executable gates |
| Unit of record | agent session / tool call | clause / requirement / implementation unit |
| Scope | **any** codebase, **any** of 20+ agent CLIs, retroactively | code Phoenix generated, greenfield-first |
| Posture on failure | **fail-open** — "a collector failure never blocks the agent tool call" | **fail-closed** — the gate refuses the ship |
| License | AGPL-3.0-or-later, OSS core + proprietary marketplace overlay planned | (ours) |

ORG-2 is a **product with users**. Phoenix is a **thesis with a test suite**. That
asymmetry is the most important fact in this document and it is not in our favor.

---

## 2. Where they independently confirmed our core bet

This is the part worth taking seriously. A 570K-LOC Rust team, working a completely
different problem, converged on **three** of Phoenix's foundational design decisions:

### 2.1 Never present inference as fact

ORG-2's `ResourceInteractionRecord` carries an explicit **attribution precision** enum:
`unknown` / `session_only` / `correlated` / `exact`. From `docs/session-provenance.md`:

> "The model stores precision explicitly instead of presenting inferred ownership as
> exact."

That is *exactly* Phoenix's trust surface thesis — `phoenix status` must be
"explainable, conservative, and correct-enough to rely on." They arrived at graded
confidence because unqualified attribution is a lie. We arrived at conservative status
for the same reason. Independent convergence on the hardest cultural point in the PRD.
Cite this externally; it is free credibility.

### 2.2 A canonical fact with a privacy-bounded, versioned boundary

`orgtrack_protocol` owns one canonical type, has **no** filesystem/DB/Tauri/vendor
dependency, ships a checked-in JSON Schema and golden fixtures, **rejects unknown wire
fields**, and forbids prompts/commands/diffs/paths from crossing. IDs are deterministic
hashes; replay is idempotent.

That is our provenance edge + `semhash` + `journal` discipline, restated by strangers.
The "one definition, facade not second model" rule (`orgtrack_core::canonical`
re-exports the protocol types) is the same anti-drift instinct as our canonical graph.

### 2.3 The record is the product, not a side effect

Both projects bet the durable asset is the causal record, not the generated code. ORG-2
calls it "the system of record for how agents build software." We call it a causal
compiler. Same bet on where value accretes.

---

## 3. Where we are genuinely differentiated

### 3.1 We can say "wrong." They can only say "who."

ORG-2 has no notion of a requirement, therefore **no notion of invalidation**. It can
tell you which session wrote line 42 and let you replay the reasoning. It cannot tell
you line 42 is now stale because a requirement changed. Selective invalidation — our
defining capability — is structurally unavailable to them.

This shows up concretely in their quality process. Their control loop is `AGENTS.md`
skill routing: run `architecture-audit`, `frontend-ui-audit`, `react-best-practices`,
`org2-performance-guard`, then write a dated markdown report into
`docs/<audit>-YYYY-MM-DD/`. It is real discipline — 30 audit folders in six weeks is
more rigor than most teams have. But it is **advisory prose evaluated by an agent**.
Their own file says so: *"This is advisory, not a hard contract. Use judgment."*

Our equivalents are **executable gates that emit numbers**: the anti-stub gate, the
assembly gate, the deletion test, D-rate, grain policy, behavioral coverage, the
compile gate. And they are falsifiable — the status fault-injection meta-eval reports
**100% recall and 100% precision over injected faults**, in CI, every run. Nobody can
write that sentence about a markdown audit.

**That is the moat: falsifiability.** They generate artifacts about quality. We generate
verdicts.

### 3.2 Their upward path is capped; our downward path is not

Suppose ORG-2 wants to climb from "AI blame" up to "what was this *supposed* to do."
They must recover intent from transcripts — inference over prompts and tool calls.
By their own taxonomy that is forever stuck at `correlated`, never `exact`, because the
causal edge was never recorded, only implied.

Now suppose Phoenix wants to descend and adopt an observation layer. We just emit facts.
And here is the wedge: **Phoenix is the only producer that can legitimately claim
`exact` precision**, because we know the spec-line→code edge by construction rather than
by correlation. Every other producer in their table (Codex, Cursor) is stuck at
`session_only`.

The asymmetry favors us. But it only cashes out if we ship something people can install.

### 3.3 Brownfield vs greenfield — they picked the bigger beachhead

Honest counterpoint. ORG-2 works on the code you already have, with the agent you
already run, ingesting history that predates the install. Phoenix requires you to write
a spec and let us generate. Their addressable market on day one is "every team running
coding agents." Ours is "greenfield modules, TypeScript, willing to change how they
work." They will get to users first, and users are how you learn.

---

## 4. Where they beat us outright

1. **Distribution.** One-click DMG/MSI/AppImage/DEB. We have `npm install && npm run build`.
2. **Reach.** 20+ agent CLIs, GUI + TUI, browser/LSP/terminal/git/db tooling, 13 locales.
3. **Retroactivity.** Sessions run in other tools are ingested and backfilled. Phoenix
   has no story for code that already exists.
4. **Surface.** Replay-as-video, design mode, work diary, AI blame — legible, demoable
   features. Phoenix's best features are *refusals*, which demo poorly.
5. **Community mechanics.** Discord channels, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY,
   commitlint, husky, external PRs landing. We have 20 open dependabot PRs and 83
   dependabot vulnerabilities on main.
6. **Packaging strategy.** They have already drawn the OSS-core / proprietary-overlay
   boundary (`packages/README.md`) with a one-way subtree mirror. We have not thought
   about this at all.

---

## 5. Threat assessment

**Not a direct competitor today.** Zero product overlap: they are an agent workstation,
we are a compiler. A user could run Phoenix *inside* ORG-2 tomorrow.

**Medium-term threat is real and specific.** The path is: AI blame → "why does this line
exist" → "what was it supposed to do" → requirements. If ORG-2 walks that path with
their distribution, they arrive at a weaker version of Phoenix that nonetheless has
users. Weaker-with-users beats stronger-without every time.

**Watch signals:**
- `orgtrack-graph` growing node kinds beyond sessions/resources — especially anything
  requirement-, intent-, or spec-shaped.
- Any gate that *blocks* rather than reports. Their whole architecture is fail-open;
  the day they add a fail-closed gate, they have crossed into our thesis.
- The `orgtrack` protocol extraction actually landing as an independent package. If it
  does, it becomes the default agent-provenance wire format, and we want to be a
  producer on it rather than a competitor to it.

---

## 6. Recommendations

**R1 — Claim the falsifiability high ground, loudly.**
Our README currently reads as a tutorial. It should lead with the numbers no competitor
can produce: selective invalidation, 100%/100% status meta-eval on injected faults, the
gates that refuse. "We report verdicts, not audits" is the positioning.

**R2 — Emit `orgtrack`-compatible provenance; be the highest-precision producer.**
Small, cheap, strategically excellent. `ResourceInteractionEnvelopeV1` is a stable,
schema-checked, privacy-bounded contract with golden fixtures. Phoenix regen emits
`capture_method: native`, `attribution_precision: exact`, plus our clause ID. We become
the only source in their ecosystem that *earns* `exact`, and we get their UI for free.
Do not fork the protocol. Adopt it.

**R3 — Fix the adoption surface.**
No installer, no GUI, no brownfield path is a strategic wound, not a backlog item. At
minimum: publish to npm so `npx phoenix` works (there is literally an open external PR
asking for this — #28 "Update README to make CLI available to npx"). Land it.

**R4 — Steal the audit-skill discipline, then make it executable.**
Their skill-routing table is a genuinely good idea we do not have. But convert each
audit to a gate that emits a number, not a report. That is the whole difference between
the two projects, expressed as a work item.

**R5 — Drain the dependency debt.**
83 vulnerabilities and 20 open dependabot PRs on main. ORG-2 has husky + commitlint +
`.unimportedrc` + `.madgerc` and a clean bot queue. This is not a technology gap, it is
a seriousness gap, and it is visible to anyone who looks at the repo.

**R6 — Decide the OSS/commercial boundary before we need to.**
They have already drawn theirs. AGPL for the core is a deliberate, aggressive choice —
it makes hostile SaaS forks hard. We should have a considered answer, not a default one.

---

## 7. The synthesis worth remembering

> Phoenix is the record of **what was supposed to be true**.
> ORG-2 is the record of **how the work actually happened**.
> Complete causality is the product of the two.

Whoever holds both edges — the intent graph *and* the execution trajectory — owns the
category. We hold the harder edge. They hold the one with users on it.
