# Phoenix Inspect v2 — Dynamic Provenance Inspector

**Goal:** A dynamic, educational, genuinely-useful visualization of a generated
app. Centerpiece is the **provenance inspector**: click any artifact → full
upstream+downstream lineage, the actual generated source mapped back to the
canon nodes that produced it, plus the trust layer (readiness, conceptual mass,
negative knowledge, evidence). Zero runtime dependencies (vanilla JS/SVG/Canvas).

## Surfaces

- **Pipeline** (browse): 5 columns Spec→Clause→Canon→IU→File, now with trust
  badges (readiness icon, mass, drift). Click a card → opens the Inspector.
- **Inspector drawer** (centerpiece): lineage ribbon (the actual chain, clickable
  to re-anchor) + tabs:
  - **Source** — generated code with a provenance gutter (inferred mapping of code
    lines → canon nodes by term overlap, clearly labeled "inferred"); `_phoenix`
    metadata highlighted; regen metadata (model, promptpack hash, toolchain).
  - **Provenance** — upstream + downstream lineage lists (clickable) + a layered
    mini-graph of the connected subgraph with typed edge labels.
  - **Trust** — readiness gradient, conceptual mass, evidence (kind/status),
    evaluation coverage, negative knowledge.
- **Spec** mode: spec text with line→clause→…→file trace (ported, kept).
- **Map** mode: force-directed graph of the whole compilation; click to spotlight
  lineage; drag/pan/zoom; edge-type labels.
- **▶ Compile** playback: animates a representative clause through the 6 stages
  with educational captions.

## Data (collectInspectData enrichment)

- [x] Generated file **contents** (read from disk, capped per file + total).
- [x] Per-IU trust: readiness + conceptual_mass (from manifest regen_metadata),
      evidence records, evaluation coverage, negative knowledge.
- [x] Typed canon→canon edges already present (edgeType) — surface labels.

## Files

- [x] `src/inspect.ts` — enriched data model + full renderer rewrite.
- [x] `src/cli.ts` `cmdInspect` — load Evidence/NK/Evaluation stores, build trust
      inputs, pass through.

## Verification

- [x] `npm run build` clean; existing tests pass.
- [x] `phoenix inspect` on an example serves; inspector opens on click, shows
      lineage + source + trust; spec/map/compile modes work.

## Status: COMPLETE
</content>
