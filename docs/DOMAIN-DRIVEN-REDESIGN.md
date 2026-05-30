# Domain-Driven Redesign — decouple Phoenix from document structure

**Premise (from aicoding.leaflet.pub + the n=1 / Regenerative-Grain / Compile-to-
Architecture essays):** intent is the asset; document layout is an authoring
accident — the "framework" of the input. The pipeline must derive a *semantic*
domain graph from **unstructured** text (could be raw meeting notes) and let IUs
emerge from **domain cohesion**, never from markdown headings. Structure survives
only as a **provenance anchor** (a back-pointer for "why"), at most a weak prior —
never an organizing principle or a hard boundary.

## The three phases

### Phase 1 — Ingestion signal-classifier  *(this turn)*
Treat input as a flat stream of statements; classify each as **signal**
(requirement / constraint / invariant / definition / decision) vs **noise**
(chatter, greetings, process talk, questions, examples, meta). Noise is dropped
from canonicalization (kept conservatively when unsure — the D-rate/eval trust
loop catches the rest). This is "smart about what to ignore."
- [x] `src/signal-classifier.ts` — rule-based gate (deterministic, no-LLM) + an
      LLM batch classifier for the warm path.
- [x] Integrate the rule gate into `extractFromClause` — confident noise never
      becomes a candidate node.

### Phase 2 — `section_path` → provenance-only anchor  *(this turn: semantics; identity next)*
- [x] Remove `headingContext`/`HEADING_CONTEXT_BONUS` — document structure must
      not change a statement's semantic *type*. `section_path` stays on the clause
      purely as provenance.
- [ ] (next) Stop `clause_id` from hashing `section_path`; identity = content +
      source anchor (doc + line span). Add an explicit `ProvenanceAnchor`
      (doc_id, line span, optional heading hint, optional speaker/timestamp).

### Phase 3 — Semantic IU clustering, mass-bounded  *(next)*
Replace `planIUs`' `(doc, section)` buckets with domain clustering: partition the
canonical graph by entity/noun cohesion + the typed-edge community structure +
embedding similarity, then bound each cluster by **conceptual mass / deletability**
(split when over budget, merge when too thin). An IU = entity (or capability) +
its constraints + its operations — a replaceable grain. Make it **incremental**
(re-cluster only the invalidated subtree) to keep canonical-stability /
selective-invalidation intact.

## Notes
- The "fold refinement sections" heuristic (regex on heading names) is a stopgap
  *in the structure-coupled idiom we are removing*; Phase 3 deletes the need for it.
- Risk: clustering is fuzzier than buckets → pushes correctness onto evals + the
  D-rate trust loop, which is exactly where the architecture says value lives, but
  raises the bar on canonicalization confidence and cold-start.

## Status: Phase 1 + Phase 2 (semantics) in progress
</content>
