# Canonicalization v2 — Architecture Plan

**Version:** 2026-02-19  
**Status:** Decision document — ready for team sign-off  
**Inputs:** CANONICALIZATION.md (internal deep-dive), Codex automated code review, research advisor feedback  
**Decision required by:** Team leads

---

## 0. The Core Insight

Canonicalization is not one problem. It is two:

1. **Extraction** — turning clause text into structured candidate nodes (per-clause, parallelizable, should be deterministic)
2. **Resolution** — linking, deduplicating, typing, and structuring those candidates into a coherent graph (global, explicitly versioned, may be probabilistic)

These are currently tangled in a single pass. Untangling them is the organizing principle of this plan. Extraction becomes a pure function. Resolution becomes a separate, versioned graph pass with its own quality metrics — essentially its own D-rate.

---

## 1. Sacred Invariants (Non-Negotiable)

Every change in this plan must preserve these properties. If a proposed approach violates one, it's rejected.

| Invariant | Why |
|-----------|-----|
| **Content-addressed identity** | `canon_id` must be a deterministic function of content. Same input → same ID, always. This is the foundation of selective invalidation. |
| **Deterministic fallback** | The system must produce correct output with zero external dependencies. Rule-based extraction is the floor, not the ceiling. |
| **Explicit provenance** | Every canon node must trace to specific source clause(s). No node exists without justification. Broken provenance = broken system. |
| **Graceful degradation** | LLM unavailable → rules. Resolution fails → extraction output is still valid. Each layer fails independently. |

These are **not** sacred:

| Not Sacred | Why |
|------------|-----|
| O(n²) linking | Obviously replaceable |
| Line-level extraction granularity | Historical artifact |
| Four-type taxonomy (R/C/I/D) | Can be extended |
| Single-pass architecture | The thing we're replacing |
| Statement text as sole identity signal | The core tension we're resolving |

---

## 2. New Type Taxonomy

The current four types (REQUIREMENT, CONSTRAINT, INVARIANT, DEFINITION) miss an important category. A line like *"Tasks support three assignment modes"* isn't a requirement — it's a framing statement that gives meaning to what follows. Dropping it silently is the root cause of the coverage problem.

**v2 taxonomy:**

| Type | What It Captures | Example |
|------|-----------------|---------|
| **REQUIREMENT** | Something the system must do | "Tasks must support status transitions" |
| **CONSTRAINT** | A limitation, bound, or prohibition | "Task titles must not exceed 200 characters" |
| **INVARIANT** | Something that must always/never hold | "Every task must have exactly one assignee at all times" |
| **DEFINITION** | A term or concept definition | "A 'task' is a unit of work with a title, description, status, and assignee" |
| **CONTEXT** | Framing text that gives meaning to other nodes but isn't actionable on its own | "Tasks support three assignment modes" / "The system handles user login, registration, and session management" |

CONTEXT nodes:
- Don't generate code directly (IU planner skips them)
- Do participate in provenance (they're extracted, not dropped)
- Do influence linking (CONTEXT frames are parents of the nodes they introduce)
- Solve the coverage problem: instead of "35% coverage, 4 statements not canonicalized," we get "100% classified: 3 requirements, 1 context frame"
- Have low confidence by default (heading-context or no-keyword match → CONTEXT rather than dropped)

---

## 3. Architecture: Two-Phase Pipeline

```
                       PHASE 1: EXTRACTION                    PHASE 2: RESOLUTION
                    (deterministic, per-clause)           (versioned, global, graph-level)
                    
Clause[] ──────────▶ ┌─────────────────────┐          ┌──────────────────────────┐
                     │ 1. Sentence segment  │          │ 5. Dedup / merge         │
                     │ 2. Classify type     │────────▶ │ 6. Typed edge inference  │ ──▶ CanonicalGraph
                     │ 3. Normalize + hash  │          │ 7. Hierarchy proposal    │
                     │ 4. Tag + confidence  │          │ 8. Anchor computation    │
                     └─────────────────────┘          └──────────────────────────┘
                     
                     Pure function.                    Versioned pipeline.
                     No global state.                  Has its own shadow diff.
                     Deterministic.                    Resolution-D-rate tracked.
                     Falls back to rules.              Falls back to extraction-only.
```

### Phase 1 output: `CandidateNode[]`

```typescript
interface CandidateNode {
  candidate_id: string;           // SHA-256(type + statement + source_clause_id)
  type: CanonicalType;            // REQUIREMENT | CONSTRAINT | INVARIANT | DEFINITION | CONTEXT
  statement: string;              // Normalized sentence
  confidence: number;             // 0.0–1.0 extraction confidence
  source_clause_ids: string[];    // Provenance (may be >1 for LLM path)
  tags: string[];                 // Extracted terms + keyphrases
  sentence_index: number;         // Position within clause for coverage tracking
  extraction_method: 'rule' | 'llm';
}
```

### Phase 2 output: `CanonicalNode[]` (extended)

```typescript
interface CanonicalNode {
  canon_id: string;               // Content-addressed (same formula as today)
  canon_anchor: string;           // Soft identity — survives minor rephrasing
  type: CanonicalType;            // May be upgraded by resolution (e.g., REQUIREMENT → CONSTRAINT)
  statement: string;
  confidence: number;             // May be adjusted by resolution context
  source_clause_ids: string[];    // May be expanded by dedup/merge
  linked_canon_ids: string[];     // Only meaningful links (typed, idf-filtered)
  link_types: Record<string, EdgeType>; // canon_id → edge type
  parent_canon_id?: string;       // Hierarchy
  tags: string[];
  extraction_method: 'rule' | 'llm';
}

type EdgeType = 'constrains' | 'defines' | 'refines' | 'invariant_of' | 'duplicates' | 'relates_to';
```

---

## 4. Phase 1: Extraction (Detailed Design)

### 4.1 Sentence Segmentation

Replace line-level splitting with sentence-level. This is the highest-impact single change — it fixes prose extraction and compound statements simultaneously.

```
Current:  clause.raw_text → split('\n') → classify per line
Proposed: clause.raw_text → segmentSentences() → classify per sentence
```

Segmentation rules:
- Split on sentence-ending punctuation (`. `, `! `, `? `) followed by uppercase or list marker
- Split compound modals: "must A and must B" → two sentences
- Preserve list items as atomic units (each `- ` item is one sentence regardless of internal periods)
- Preserve transition sequences as atomic (lines with `→`, `->` are not split)

**File:** New `src/sentence-segmenter.ts` (~80 lines)

### 4.2 Enhanced Type Classification

Replace binary regex matching with a **scoring rubric**. Each sentence gets a score per type; highest score wins. Ties go to CONTEXT (safe default — extracted but not actionable).

| Signal | REQ | CON | INV | DEF | CTX |
|--------|-----|-----|-----|-----|-----|
| "must", "shall" | +2 | +1 | +1 | 0 | 0 |
| "must not", "cannot", "forbidden" | 0 | +4 | 0 | 0 | 0 |
| "always", "never", "at all times" | 0 | 0 | +4 | 0 | 0 |
| "is defined as", "means", "refers to" | 0 | 0 | 0 | +4 | 0 |
| Numeric bound ("at most N", "≤", "maximum") | 0 | +3 | 0 | 0 | 0 |
| Heading context: "constraint"/"security" | 0 | +2 | 0 | 0 | 0 |
| Heading context: "requirement"/"feature" | +2 | 0 | 0 | 0 | 0 |
| Heading context: "definition"/"glossary" | 0 | 0 | 0 | +2 | 0 |
| No modal verb, no keyword match | 0 | 0 | 0 | 0 | +2 |
| Short sentence (< 10 words, no verb) | 0 | 0 | 0 | +1 | +1 |

**Confidence** = `(winning_score - runner_up_score) / winning_score`, clamped to [0.3, 1.0].

This means:
- "must not exceed 200 characters" → CON=7 (must not +4, numeric +3), REQ=3 → CON wins, confidence=(7-3)/7=0.57
- "must authenticate with email" → REQ=4, CON=1 → REQ wins, confidence=0.75
- "Tasks support three assignment modes" → CTX=2, all others 0 → CTX, confidence=1.0

**File:** Replace `classifyLine()` in `src/canonicalizer.ts` with `scoreSentence()` (~60 lines)

### 4.3 Term Extraction Fix

Two immediate fixes:

1. **Acronym whitelist**: Allow short tokens that are domain terms: `id`, `ui`, `api`, `jwt`, `sso`, `otp`, `ip`, `db`, `tls`, `rsa`, `aes`, `rs256`, `hs256`, `oidc`, `oauth`, `2fa`, `url`, `uri`, `http`, `sql`, `css`, `html`.

2. **Preserve hyphenated compounds**: `rate-limit`, `cross-origin`, `in-progress` stay as single tags, not split into parts.

**File:** Modify `extractTerms()` in `src/canonicalizer.ts` (~15 lines changed)

### 4.4 Normalizer Fix: Ordered Sequences

The list-sorting behavior in `normalizeText()` is a **correctness bug**. The sequence `open → in_progress → review → done` is order-dependent. Sorting it alphabetically changes the meaning.

Fix:
- **Numbered lists**: Never sort (ordering is explicit).
- **Bullet lists with sequence indicators**: Don't sort if any item contains `→`, `->`, `=>`, ordinals (1st, 2nd), or comma-delimited sequences.
- **All other bullet lists**: Continue sorting (preserves stability for unordered lists).

**File:** Modify `normalizeText()` in `src/normalizer.ts` (~20 lines changed)

### 4.5 Coverage Reporting

After extraction, compute per-clause coverage:

```typescript
interface ExtractionCoverage {
  clause_id: string;
  total_sentences: number;
  extracted_sentences: number;
  coverage_pct: number;
  uncovered: { text: string; reason: 'no_match' | 'too_short' | 'meta_text' }[];
}
```

Emit as diagnostics in `phoenix status`:
```
INFO  canon  spec/tasks.md L1-4     Coverage: 1/3 sentences (33%) — 2 classified as CONTEXT
WARN  canon  spec/auth.md L15-20    Coverage: 2/5 sentences (40%) — 3 uncovered (no keyword match)
```

**File:** New `src/extraction-coverage.ts` (~50 lines), wired into CLI status

---

## 5. Phase 2: Resolution (Detailed Design)

Resolution is a **global graph pass** that operates on the flat list of candidate nodes from Phase 1 and produces the final canonical graph. It is explicitly versioned (`resolution_pipeline_id`) and has its own shadow diff mechanism.

### 5.1 Deduplication / Merge

Two candidates from different clauses may express the same requirement. Resolution detects this and merges them.

**Algorithm:**
1. Build inverted index: tag → candidate_ids
2. For each pair of candidates sharing ≥ 3 rare tags (idf-weighted): compute statement similarity (Jaccard on token trigrams)
3. If similarity > 0.7 and types are compatible (same type, or one is CONTEXT): merge into one node with both `source_clause_ids`
4. Merged node gets `canon_id` from the higher-confidence candidate (preserves identity stability)

This solves the dedup problem (§5.9) and multi-clause provenance (§5.8) simultaneously.

### 5.2 Typed Edge Inference

Replace untyped `linked_canon_ids` with typed edges. Infer edge types from node types and tag relationships:

| From Type | To Type | Inferred Edge | Condition |
|-----------|---------|--------------|-----------|
| CONSTRAINT | REQUIREMENT | `constrains` | Shared head noun or tags |
| INVARIANT | REQUIREMENT | `invariant_of` | Shared domain terms |
| DEFINITION | any | `defines` | Definition's head term appears in target's statement |
| CONTEXT | REQUIREMENT | `refines` | CONTEXT is in parent heading; REQUIREMENT is in child heading |
| any | any (same statement, different clause) | `duplicates` | Caught by dedup but retained as edge |
| any | any | `relates_to` | Shared rare tags above threshold (fallback) |

**Key constraint:** Only create `relates_to` edges for pairs sharing ≥ 2 tags where at least one tag has IDF > median. This replaces the current noisy ≥ 2 shared tags rule.

**Max degree cap:** No node may have more than 8 outgoing edges (excluding `duplicates`). If over cap, keep edges with highest tag-idf overlap. This prevents the "linked to everything" problem.

### 5.3 Hierarchy Inference

Use heading structure from clause `section_path` to propose parent-child relationships:

```
Heading: "Task Management Service"       → CONTEXT node (top-level)
  Heading: "Task Lifecycle"              → CONTEXT node (parent)
    Bullet: "Tasks must support..."      → REQUIREMENT (child of Task Lifecycle)
    Bullet: "Invalid transitions..."     → CONSTRAINT (child of Task Lifecycle)
```

Algorithm:
1. For each clause, record its `section_path` depth
2. For each candidate node, inherit the depth of its source clause
3. CONTEXT nodes at depth N are potential parents of nodes at depth N+1 from the same document
4. Set `parent_canon_id` based on heading containment
5. If no CONTEXT node exists at the parent depth, leave `parent_canon_id` unset

This gives us hierarchical invalidation for free: changing a child requirement only invalidates its subtree, not the sibling requirements under the same section.

### 5.4 Anchor Computation

Add `canon_anchor` — a soft identity that survives minor statement rephrasing:

```typescript
canon_anchor = SHA-256(
  type + 
  sorted(tags).join(',') + 
  source_clause_ids.sort().join(',')
)
```

The anchor is stable because:
- `type` changes rarely (and the scoring rubric is deterministic)
- `tags` are extracted from the same source text (minor rephrasing keeps most tags)
- `source_clause_ids` are content-addressed and stable for unchanged clauses

**Usage in diff:** When comparing old and new canonical graphs:
1. Match by `canon_anchor` first (find "same concept" pairs)
2. Compare `canon_id` within matched pairs (detect "reworded" vs "identical")
3. Unmatched anchors → truly new or removed nodes

This separates "the LLM rephrased this slightly" (anchor matches, id differs → class A/B change) from "this is a genuinely new requirement" (no anchor match → class C/D change).

### 5.5 Resolution Quality Metrics

Resolution gets its own health metrics, separate from the extraction D-rate:

| Metric | Definition | Target |
|--------|-----------|--------|
| **Resolution-D-rate** | % of edges where type couldn't be inferred (fell back to `relates_to`) | ≤ 20% |
| **Dedup rate** | % of candidates that were merged | Report only (no target — depends on spec style) |
| **Orphan rate** | % of nodes with zero outgoing edges (no connections) | ≤ 10% |
| **Max degree** | Highest node degree in the graph | ≤ 8 (enforced by cap) |
| **Hierarchy coverage** | % of non-CONTEXT nodes that have a parent | ≥ 50% |

These appear in `phoenix status` as resolution-specific diagnostics.

---

## 6. LLM Integration (Stabilized)

The research advisor feedback and Codex review converge on the same recommendation: **don't use the LLM for extraction. Use it for normalization only.**

### 6.1 LLM-as-Normalizer Architecture

```
Sentence (raw)   →   Rule-based extraction   →   CandidateNode (draft)
                                                         │
                                                         ▼
                                                  LLM Normalizer
                                                  (if available)
                                                         │
                                                         ▼
                                                  CandidateNode (normalized statement)
```

The LLM receives a single sentence + its type classification and returns a normalized canonical form. This is a **constrained rewrite**, not open-ended generation — variance is much lower than full extraction.

**Prompt:**
```
Rewrite this {type} statement in canonical form.
Rules: one clear sentence, present tense, active voice, no pronouns, no ambiguity.
Input: "{raw_statement}"
Output (JSON): {"statement": "..."}
```

- Temperature: 0
- Max tokens: 100
- JSON schema enforced
- If output is empty, malformed, or LLM is unavailable → use rule-normalized statement

### 6.2 Self-Consistency for Stability

For high-risk IUs (where canon stability matters most), run the normalizer k=3 times and select the **lexical medoid** (the output most similar to all other outputs, by token Jaccard). This is deterministic given a tie-breaking rule (alphabetical).

### 6.3 Explicit Provenance in LLM Path

If the LLM is used for full extraction (retained as an option behind `--llm-extract` flag):
- Prompt must require `source_section` field in output
- Response is validated: if `source_section` doesn't match any clause's `section_path`, the node is rejected
- Attribution to multiple clauses is allowed if the LLM identifies them
- Positional fallback is **removed entirely** — if provenance can't be established, the node is dropped

---

## 7. Implementation Roadmap

### Sprint 1 (Week 1–2): Foundation + Quick Wins

**Goal:** Fix correctness bugs, establish extraction/resolution split, get coverage reporting.

| Task | File(s) | Size | Risk |
|------|---------|------|------|
| Fix normalizer list sorting for ordered sequences | `src/normalizer.ts` | S | Low — tests exist for sort behavior |
| Add acronym whitelist + hyphenated compound preservation | `src/canonicalizer.ts` | S | Low |
| Add CONTEXT type to `CanonicalType` enum | `src/models/canonical.ts` | S | Low — additive |
| Build sentence segmenter | New: `src/sentence-segmenter.ts` | M | Medium — needs good test fixtures |
| Replace line-level extraction with sentence-level | `src/canonicalizer.ts` | M | Medium — all canon tests will shift |
| Implement scoring rubric for type classification | `src/canonicalizer.ts` | M | Medium |
| Add `confidence` field to `CanonicalNode` | `src/models/canonical.ts` | S | Low — additive, optional |
| Add extraction coverage reporting | New: `src/extraction-coverage.ts` | S | Low |
| Wire coverage into `phoenix status` | `src/cli.ts` | S | Low |
| Update all tests for new extraction behavior | `tests/` | L | High — most canon tests need updating |

**Deliverable:** Sentence-level extraction with scoring rubric, CONTEXT type, coverage diagnostics, normalizer fix. All existing pipeline tests pass (updated for new node counts/types).

### Sprint 2 (Week 3–4): Resolution Phase

**Goal:** Build the global graph pass. Typed edges, dedup, hierarchy.

| Task | File(s) | Size | Risk |
|------|---------|------|------|
| Create `CandidateNode` type and extraction→resolution interface | `src/models/canonical.ts` | S | Low |
| Build inverted index + idf-weighted tag utility | New: `src/tag-index.ts` | M | Low |
| Implement dedup/merge (similarity on trigrams, idf-filtered) | New: `src/resolution.ts` | M | Medium |
| Implement typed edge inference | `src/resolution.ts` | M | Medium |
| Implement hierarchy inference from section_path depth | `src/resolution.ts` | M | Low |
| Add `canon_anchor` computation | `src/resolution.ts` | S | Low |
| Add `link_types`, `parent_canon_id`, `canon_anchor` to model | `src/models/canonical.ts` | S | Low — additive |
| Add max-degree cap to linking | `src/resolution.ts` | S | Low |
| Resolution quality metrics in `phoenix status` | `src/cli.ts` | S | Low |
| Update warm-hasher to use only typed edges | `src/warm-hasher.ts` | S | Medium — affects context hash values |
| Update `phoenix inspect` for new edge types + hierarchy | `src/inspect.ts` | M | Low |
| Comprehensive tests for resolution | `tests/functional/resolution.test.ts` | L | — |

**Deliverable:** Two-phase pipeline producing hierarchical, typed canonical graph. Resolution metrics in status. Inspect shows hierarchy and edge types.

### Sprint 3 (Week 5–6): LLM Stabilization + Anchors

**Goal:** LLM-as-normalizer, anchor-based diff, self-consistency.

| Task | File(s) | Size | Risk |
|------|---------|------|------|
| LLM-as-normalizer: single-sentence rewrite | `src/canonicalizer-llm.ts` (rewrite) | M | Medium |
| Self-consistency (k=3, medoid selection) | `src/canonicalizer-llm.ts` | S | Low |
| Anchor-based diff in classifier | `src/classifier.ts` | M | Medium — changes diff semantics |
| Require explicit provenance in LLM-extract mode | `src/canonicalizer-llm.ts` | M | Medium |
| Remove positional fallback | `src/canonicalizer-llm.ts` | S | Low |
| Update shadow pipeline to compare resolution graphs | `src/pipeline.ts` | M | Medium |
| Tests for LLM normalization stability | `tests/unit/` | M | — |

**Deliverable:** LLM path uses normalizer-only by default. Self-consistent. Anchor-based diff reduces phantom invalidation. Shadow pipeline covers resolution.

### Sprint 4 (Week 7–8): Polish + Evaluation

**Goal:** Measure improvements against baselines. Decide on optional enhancements.

| Task | File(s) | Size | Risk |
|------|---------|------|------|
| Build evaluation harness (gold-standard annotated specs) | `tests/eval/` | L | — |
| Measure extraction recall, type accuracy, linking precision | `tests/eval/` | M | — |
| Compare baselines (old vs new) across all fixtures | `tests/eval/` | M | — |
| Decide: local embeddings for linking (transformers.js) | Decision doc | — | Depends on eval results |
| Decide: TextRank keyphrases for tag enrichment | Decision doc | — | Depends on eval results |
| Decide: weakly-supervised type classifier | Decision doc | — | Depends on eval results |
| Documentation update | `docs/` | M | — |

**Deliverable:** Quantified improvement report. Go/no-go decisions on mid-term enhancements. Updated documentation.

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Sentence segmenter handles edge cases poorly | Medium | High | Extensive test fixtures; keep line-level as fallback for list items |
| Scoring rubric under-fits on novel spec styles | Medium | Medium | CONTEXT as safe default; rubric is tunable weights not hard rules |
| Dedup merges nodes that shouldn't be merged | Low | High | Conservative threshold (0.7 similarity); require ≥3 rare shared tags; easy to back out |
| Hierarchy inference creates wrong parent-child links | Medium | Low | Only propose hierarchy from heading structure; don't infer from content |
| Warm-hasher change causes cascade of hash changes | High | Medium | Feature-flag new warm hash; transition gradually; shadow diff before switching |
| LLM normalizer produces unstable output despite temp=0 | Medium | Medium | Self-consistency k=3; fall back to rule normalization |
| Test suite disruption from extraction granularity change | High | Medium | Sprint 1 allocates time explicitly; use snapshot testing for transition |

---

## 9. Measurement Targets

| Metric | Current Baseline | Sprint 1 Target | Sprint 4 Target |
|--------|-----------------|-----------------|-----------------|
| Extraction recall | ~70% | 85% (sentence-level + CONTEXT) | 95% |
| Type accuracy | ~60% (over-REQUIREMENT) | 80% (scoring rubric) | 90% (with resolution type upgrade) |
| Provenance accuracy (rule) | 100% | 100% | 100% |
| Provenance accuracy (LLM) | ~80% | 90% (explicit provenance) | 95% (validated) |
| Linking precision | ~40% | 70% (idf-filtered, typed) | 80% |
| Identity stability (LLM) | ~90% | 95% (normalizer-only) | 98% (self-consistency + anchors) |
| Coverage visibility | None | Per-clause % in status | Per-clause + uncovered sentence detail |
| Linking scalability | O(n²) | O(n·k) via inverted index | O(n·k) confirmed at 5K nodes |

---

## 10. Decisions Needed

| # | Decision | Options | Recommendation | Deadline |
|---|----------|---------|----------------|----------|
| 1 | Accept CONTEXT as 5th canonical type? | Yes / No (keep dropping) | **Yes** — solves coverage and prose extraction simultaneously | Before Sprint 1 |
| 2 | Accept extraction/resolution split? | Two-phase / Keep single-pass | **Two-phase** — enables independent versioning and quality metrics | Before Sprint 1 |
| 3 | Accept normalizer fix for ordered sequences? | Fix sorting / Keep current | **Fix** — current behavior is a correctness bug | Before Sprint 1 |
| 4 | Add `confidence`, `canon_anchor`, `link_types`, `parent_canon_id` to data model? | Now (optional fields) / Later | **Now, as optional fields** — avoids migration later, no breaking change | Before Sprint 2 |
| 5 | LLM default mode: normalizer-only or full extraction? | Normalizer / Extraction / Both behind flag | **Normalizer default**, extraction behind `--llm-extract` flag | Before Sprint 3 |
| 6 | Invest in local embeddings (transformers.js)? | Yes (Sprint 5–6) / Defer | **Defer** — evaluate after Sprint 4 baselines; only pursue if idf-linking doesn't hit 80% precision | After Sprint 4 eval |

---

## Appendix A: Superseded Documents

This plan supersedes and incorporates:
- `docs/CANONICALIZATION.md` — retained as the technical reference for current implementation
- `docs/CANONICALIZATION-REVIEW.md` — Codex automated review; findings incorporated into this plan's design

Both documents remain in the repo as historical reference.

## Appendix B: References

### Requirements engineering
- Mavin et al. (2009/2010). EARS: The Easy Approach to Requirements Syntax.
- Ferrari et al. (2017). NLP for Requirements Engineering: Systematic Literature Review.
- Banko et al. (2007). Open Information Extraction from the Web.
- He et al. (2017). Deep Semantic Role Labeling.

### Similarity, linking, identity
- Reimers & Gurevych (2019). Sentence-BERT. arXiv:1908.10084.
- Broder (1997). MinHash for document resemblance.
- Charikar (2002). SimHash for similarity estimation.
- Malkov & Yashunin (2018). HNSW for approximate nearest neighbors.

### Keyphrases and NLP tooling
- Mihalcea & Tarau (2004). TextRank for keyphrase extraction.
- RAKE (Rose et al., 2010). Rapid Automatic Keyword Extraction.
- `xenova/transformers.js` — local embeddings in Node.
- `wink-nlp` / `compromise` — JS POS and noun-phrase extraction.

### LLM stability
- Wang et al. (2023). Self-Consistency improves chain-of-thought reasoning.
- Structured/JSON-constrained decoding (outlines, guidance).

---

*This is a decision document. It becomes the plan of record once all §10 decisions are signed off.*
