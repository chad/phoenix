# Regeneration Gate — Implementation Plan

**Goal:** Convert the Replacement Audit (`audit.ts`) and the regenerative-grain
models (conceptual mass, negative knowledge, evaluations) from after-the-fact
*reports* into a *gate* in the regeneration commit path — closing the loop the
Phoenix Architecture essays describe but the code left open.

**Alpha policy: WARN-FIRST.** The gate never refuses a commit. It stamps the
verdict into the manifest and surfaces warnings so readiness scores earn trust
before the gate gains teeth. ("Trust > cleverness.") Flip to `block` per risk
tier later.

## The four gates

1. **Pre-generation — negative knowledge shapes the prompt.**
   `buildPrompt` gets a `negativeKnowledge` section listing past failures for the IU.
2. **Post-generation — failure → negative knowledge (close the loop).**
   On LLM exception OR persistent typecheck failure, `regen.ts` calls
   `onGenerationFailure`; `cli.ts` records a `failed_generation` NK record.
   This makes the immune memory self-populating → feeds Gate 1 next cycle.
3. **Pre-accept — readiness gate.** `gateIU` runs `auditIU`; readiness + blockers
   stamped into manifest, surfaced as warnings.
4. **Pre-accept — conceptual-mass ratchet.** Mass computed + compared to previous
   cycle's stamped mass; ratchet violation surfaced as a warning.

## Files

- [x] `models/manifest.ts` — add `readiness?`, `conceptual_mass?` to `RegenMetadata`.
- [x] `models/negative-knowledge.ts` — add `failedGenerationKnowledge()` factory.
- [x] `llm/prompt.ts` — `buildPrompt` renders `## Known failures — do not repeat`.
- [x] `regen.ts` — `RegenContext` gains `negativeKnowledge` map + `onGenerationFailure`;
      `generateWithLLM` returns `{ code, typecheckError }`; failures reported.
- [x] `regen-gate.ts` — **new.** `gateIU()` composes `auditIU` + mass + ratchet → `GateVerdict`.
- [x] `cli.ts` — both `cmdBootstrap` and `cmdRegen`: load prev masses + NK, pass gate
      context into regen, gate-stamp manifests before `recordIU`, report warnings.

## Verification

- [x] `npm run build` clean.
- [x] Regen an example (settle-up) → gate summary prints, manifest stamped with
      readiness + mass; second regen shows mass deltas; an induced failure writes
      a negative-knowledge record that appears in the next prompt + audit.

## Status: COMPLETE
</content>
</invoke>
