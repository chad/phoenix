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

### Phase 3 — Semantic IU clustering, mass-bounded  *(this turn)*
Replaced `planIUs`' `(doc, section)` buckets with domain clustering (src/iu-clusterer.ts):
- [x] **LLM clusterer** (`clusterCanonNodesLLM`) — the semantic primary. Partitions
      requirements into cohesive modules (entity + its rules + ops; a UI is its own
      module; a report is its own module). Wired into bootstrap/plan via
      `planIUsAuto` when a provider is available. On Trail it yields: issue-entity,
      sprint-entity, kanban-board-ui, sprint-rollup, api-interface — named by domain
      meaning, no document structure.
- [x] **Rule clusterer** (`clusterCanonNodes`) — deterministic fallback (cold start /
      no-LLM / tests): anchor each node to its primary entity or capability from its
      tags; attach constraints to the entity they constrain via typed edges; merge
      tiny clusters, mass-bound (split) oversized ones. Recovers the major entities;
      capability boundaries are where it's weak (intrinsically semantic).
- [ ] (next) Incremental re-clustering (re-cluster only the invalidated subtree) for
      canonical-stability / selective-invalidation; embedding similarity as a third
      signal in the rule path.

## Notes
- The "fold refinement sections" heuristic (regex on heading names) is now deleted —
  domain clustering folds rules into their entity by meaning, not by heading.
- Risk: clustering is fuzzier than buckets → pushes correctness onto evals + the
  D-rate trust loop, which is exactly where the architecture says value lives, but
  raises the bar on canonicalization confidence and cold-start.

## Status: Phase 1 ✓, Phase 2 semantics ✓, Phase 3 (LLM + rule clustering) ✓.
## Remaining: clause-identity de-structuring (drop section_path from clause_id) and
## incremental re-clustering.
</content>
