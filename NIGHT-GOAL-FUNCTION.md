# Night Goal — make Phoenix generate apps that FUNCTION, generally

**North star**: Phoenix produces real working apps at freeqworld quality — apps that
actually connect to their external service and behave — for a GENERAL class of apps,
with integrity (verified, not plausible).

**Baseline**: `1e8565f`, 1180 tests green, selftest 41/41.
**Source of truth**: `PLAN-MEND-GAPS.md` (the MG workstreams).

## The gap being closed

The generated freeqworld (:2997) compiles and composes but is INERT: no network, no
Freeq, hardcoded chat, `createWebSocketMovementTransport()` is a local-array stub.
Phoenix passed every STRUCTURAL gate on behaviorally-dead code because nothing measured
behavior. The spec was rich and sufficient (verified) — the failure is Phoenix's.

The fix is not more codegen. It is, in order: (1) a way to MEASURE "does it function"
(integration evals), (2) an honest label so "compiles" never reads as "works",
(3) a general capability to BIND to an external service with a REAL transport, and
(4) a gate that rejects plausible-but-fake network code.

## Generality principle (hold this line)

Every mechanism is Phoenix-general: "express, generate-toward, and VERIFY functional
integration with an external service (pub/sub / request-response)." The SPECIFIC
protocol (Freeq) is an app-supplied adapter + fixture, never Phoenix core. The class
covered: chat, collaboration, live dashboards, multiplayer, any app whose value is
talking to a service.

## Order (measure first, then capability — the Phoenix way; testable > perfect)

1. **MG5 — honest behavioral labeling** (fast). A `Behavioral coverage` dimension:
   an app with integration intent but 0 integration evals is flagged RED in status +
   the bootstrap completion; "compiles + composes" must never read as "functions".
2. **MG3 — anti-stub gate** (deterministic). Reject code that ADVERTISES networking
   (name/type says transport/socket/fetch/client) but performs none — the
   `createWebSocketMovementTransport` lie. Warn-first, journaled.
3. **MG1 — integration-eval harness (KEYSTONE)**. A general harness: boot an app's
   client against a FIXTURE service (in-memory pub/sub), run a scenario
   (subscribe → publish → assert received), pass/fail. Prove hermetically that it
   goes GREEN on a functional module and RED on an inert one (hardcoded data / no
   publish). This is the surface generation must satisfy — without it "works" is
   unmeasurable.
4. **MG2 — general service-binding capability**. Runtime ships a hand-authored
   `ServiceClient` (real transport) + a `binding` aggregate: modules declare
   subscribe/publish; the runtime wires events. Prove a binding round-trips against
   the fixture. (Biggest; land the hermetic core, defer live browser wiring.)
5. **MG4 — adapt preserves integration intent** (if time). "X is a client for Y" /
   "rooms are channels" → integration-eval intents, not data constraints.

## Hard rules (unchanged)

- Verifier frozen; widen reading, never rules.
- No silent fallback / no plausible-passing: the whole point is to STOP plausible.
- The LLM never writes the transport (trust infrastructure — hand-authored scaffold).
- Fixtures/adapters are app inputs; Phoenix core stays protocol-agnostic.
- `npm test` + selftest green before each commit. E2E flake rule applies.
- Each item: design → implement → hermetic tests → green → commit. Document blockers,
  move on. Backlog never empties.

## Progress log

- [x] MG3 anti-stub gate — detectStubs + bootstrap Stub Gate, 5 tests (22df60b)
- [x] MG1 integration-eval harness (keystone) — ServiceClient + fixture + runner, 6 tests (f61dc7e)
- [x] MG2 service-binding capability — real WebSocket scaffold + binder registry;
      round-trip proven headless; realtime-presence now composed (cd4a78d)
- [x] MG5 behavioral coverage — UNPROVEN completion + status line, 4 tests (77fb75e)
- [x] MG4 adapt preserves integration intent — integration contracts, 1 test (7923b21)
- [x] NIGHT-REPORT-FUNCTION.md written

All five MG workstreams landed. The loop closes: adapt captures integration intent
(MG4) → integration evals measure it (MG1) → the service-binding capability satisfies
it (MG2) → the anti-stub gate keeps it real (MG3) → behavioral coverage reports it
honestly (MG5).

## Deferred (documented frontier)
- Live end-to-end demo: the generated freeqworld actually connecting to a running
  Freeq server. Needs a Freeq protocol ADAPTER over ServiceClient + a server + a
  re-bootstrap (freeqworld-world was generated BEFORE MG2's prompt, so it has 0
  bindings — behavioral coverage correctly reads UNPROVEN).
- Auto-generating integration-eval CASES from MG4 contracts and running them in the
  verifier as per-app evidence (the harness exists; wiring is the follow-on).
- Generation producing correct bindings at scale (prompt teaches it; unproven on a
  full LLM run).

(`git log` is the real trail.)
