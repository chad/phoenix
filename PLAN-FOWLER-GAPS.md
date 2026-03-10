# Plan: Fill Gaps from The Phoenix Architecture

Based on reading Chad Fowler's book and comparing against our implementation, these are the gaps worth filling — things we haven't built that are architecturally significant.

## Gap 1: Evaluation vs. Implementation Test Separation

**Book insight:** Evaluations bind to behavior at boundaries. Implementation tests bind to code internals. Only evaluations survive regeneration. "Would this assertion still be meaningful if the entire implementation were replaced tomorrow?"

**Our gap:** All 305 tests are implementation-coupled. No separation between durable behavioral evaluations and disposable implementation scaffolding.

**Fix:**
- Add `evaluations/` directory as first-class, independently versioned behavioral truth surface
- Create evaluation model types (behavioral assertions at IU boundaries)
- Add `EvaluationStore` for persistence across regeneration cycles
- Evaluations reference IU contracts and boundary behaviors, never internal function signatures
- `phoenix status` reports evaluation coverage gaps
- Add CLI: `phoenix eval` to run evaluations, `phoenix eval:coverage` to report gaps

## Gap 2: Conservation Layers as First-Class Concept

**Book insight:** Any surface where external trust accumulates (UI, public APIs, event schemas) should be tagged as a conservation layer with a slower regeneration cadence.

**Our gap:** IUs have risk tiers but no pace-layer classification. No concept of conservation surfaces.

**Fix:**
- Add `pace_layer` field to IU model: surface | service | domain | foundation
- Add `conservation` boolean flag — marks surfaces where external parties depend on stability
- Boundary validator enforces that conservation-layer IUs cannot be regenerated without explicit approval
- `phoenix status` surfaces pace-layer violations (fast-layer changes touching slow-layer boundaries)

## Gap 3: Conceptual Mass Budget

**Book insight:** Conceptual mass compounds combinatorially. Each concept interacts with existing concepts. Treat it as a budget with a cap, not a backlog that grows freely.

**Our gap:** No measurement of cognitive burden per IU. No ratchet preventing mass growth.

**Fix:**
- Define conceptual mass metric per IU: count of distinct concepts (types, contracts, dependencies, side channels)
- Track mass across regeneration cycles in manifest
- Ratchet rule: mass cannot grow across two consecutive regeneration cycles without explicit justification
- `phoenix status` warns when mass exceeds threshold or grows without justification

## Gap 4: Replacement Audit (`phoenix audit`)

**Book insight:** "Pick a component and ask: could I replace this implementation entirely and have its dependents not notice?" The obstacles reveal identity debt.

**Our gap:** We have the deletion test in e2e but no CLI command that runs the replacement audit as a diagnostic.

**Fix:**
- Add `phoenix audit` CLI command
- For each IU: assess boundary clarity, evaluation coverage, blast radius, deletion safety
- Score each IU on a readiness gradient: opaque → observable → evaluable → regenerable
- Output a structured audit report with specific blockers and recommended actions

## Gap 5: Negative Knowledge in Provenance

**Book insight:** "What failed matters as much as what succeeded, and it disappears first." Failed generation attempts, rejected approaches, incident-driven constraints should be preserved.

**Our gap:** Provenance edges record what happened. They don't record what was tried and rejected, or why constraints exist.

**Fix:**
- Add `NegativeKnowledge` type: records failed attempts, rejected approaches, incident references
- Attach to canonical nodes and IUs as provenance annotations
- Preserved across compaction (like approvals and signatures)
- `phoenix status` surfaces when regeneration is attempted without consulting negative knowledge

## Implementation Order

1. **Gap 1** (Evaluations) — foundational, everything else builds on it
2. **Gap 2** (Conservation/Pace Layers) — extends IU model
3. **Gap 3** (Conceptual Mass) — extends manifest tracking
4. **Gap 4** (Audit command) — uses all of the above
5. **Gap 5** (Negative Knowledge) — extends provenance

## Estimated Scope

Each gap is ~100-300 lines of model + logic + tests. Total: ~800-1500 lines new code.
