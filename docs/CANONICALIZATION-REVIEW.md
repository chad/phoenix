# Phoenix Canonicalization — Review, Gaps, and Refinement Plan

**Version:** 2026-02-19  
**Source:** Automated code review (OpenAI Codex) of `docs/CANONICALIZATION.md` against codebase  
**Audience:** Phoenix core team (research + engineering)  
**Scope:** Independent review of current canonicalization with prioritized improvements and references

---

## Executive Summary

Canonicalization is central to Phoenix. The current rule-based engine is fast, deterministic, and preserves provenance; the LLM path adds recall but weakens determinism and provenance. Key pain points are over-typing to REQUIREMENT, missed statements in prose, noisy O(n²) linking, lack of coverage/confidence, and identity instability when statements are rephrased. We recommend a staged refinement:

- **Near term** (no external deps): sentence-level extraction with coverage diagnostics, better typing rules, preserve ordered sequences in normalization, less noisy/scalable linking, and multi-clause provenance.
- **Mid term** (local-only ML): deterministic local embeddings for linking/anchors, unsupervised keyphrase extraction, and weakly-supervised type classifier.
- **LLM, stabilized**: use LLM for normalization only or require explicit clause references; add self-consistency to reduce variance.
- **Graph/identity**: introduce typed edges, optional hierarchy, and a soft "anchor" identity alongside strict hash.

These changes maintain Phoenix's core properties (content-addressed identity, explicit provenance, deterministic fallback) while measurably improving extraction quality, type accuracy, and linking precision.

---

## Strengths (What Works Today)

- **Determinism and fallback**: Rule-based path is stable and always available; LLM path fully degrades to rules on failure.
- **Explicit provenance**: Rule extractor maps nodes to clauses with high fidelity; leveraged by `warm-hasher` and `canonical-store`.
- **Normalization for stability**: Formatting-only changes do not churn `clause_semhash`; downstream diffs remain clean.
- **Test coverage at pipeline level**: Functional tests exercise parse → canonicalize → warm hash → classify flows.

---

## Gaps and Risks (Beyond the Known Issues)

These are issues identified through code review that go beyond what CANONICALIZATION.md already documents:

- **Normalizer reorders lists**: Sorting list items breaks ordered semantics (e.g., transition sequences like `open → in_progress → review → done`), causing meaning drift and brittle hashes. This is a **correctness bug**, not just a quality issue.
- **Acronym loss in tags**: Tokens ≤2 chars (`id`, `ui`, `api`, `jwt`, `sso`, `otp`) are dropped by `extractTerms`, degrading tags and links in domains with heavy acronym usage.
- **No typed relations**: `linked_canon_ids` are untyped, undirected, based on term overlap; downstream systems can't use relation semantics (constrains, defines, refines).
- **Statement-as-identity tension**: Small rephrasings create new IDs; including `source_clause_id` in the hash prevents dedup across sections even when the same requirement appears twice.

---

## Quick Wins (Low-Risk, High-Impact)

### 1. Sentence-first extraction and coverage
- Segment clause text into sentences; split compound sentences with coordinated modals ("must A and must B" → two candidates).
- Classify per sentence; compute coverage per clause (extracted / total sentences) and emit diagnostics for uncovered sentences.

### 2. Stronger rule features for typing
- **Constraints**: negation ("must not", "may not", "cannot"), bound phrases ("at most/least", "no more than/fewer than", numeric ranges).
- **Invariants**: adverbs ("always", "never", "at all times", "regardless", "must remain").
- **Definitions**: copular patterns ("X is/means/refers to …"), colon heuristics with noun-phrase guard to avoid enumerations.

### 3. Preserve ordered sequences in normalization
- Do not sort numbered lists; avoid sorting bullet lists that contain arrows (→, ->), ordinals, or comma-delimited sequences.
- Treat transition lines as atomic sequences (preserve order in normalized text).

### 4. Reduce noisy linking without embeddings
- Build an inverted index over tags; generate candidate links only for pairs sharing ≥2 low-idf tags; cap node degree.
- Optionally use MinHash/SimHash on tag sets for candidate generation, then exact-check overlap.

### 5. Multi-clause provenance (deterministic)
- Attribute a node to top-2 clauses by similarity over `normalized_text` (BM25/cosine on tf-idf), above a threshold; drop positional fallback.

### 6. Domain term retention
- Whitelist short acronyms in `extractTerms`: `id`, `ui`, `api`, `jwt`, `sso`, `otp`, `ip`, `db`, `tls`, `rsa`, `aes`, `rs256`, `hs256`, `oidc`, `oauth`, `2fa`.

### 7. Confidence scoring
- Add `confidence` to `CanonicalNode` (e.g., 1.0 for strict pattern match, 0.7 for mixed cues, 0.3 for heading-only); use to filter/downweight low-confidence nodes in warm context and planners.

---

## Mid-Term Enhancements (Local, Deterministic)

### Local sentence embeddings
- Use `transformers.js` (xenova/transformers.js) to run MiniLM/E5 embeddings locally in Node for linking and anchor identity; keep thresholds conservative.
- Introduce `canon_anchor` as an LSH/SimHash over embeddings; maintain `canon_id` as strict identity.

### Unsupervised keyphrases
- Implement TextRank/RAKE to extract multi-word phrases; supplement token tags with phrases for better linking.

### Weakly-supervised type classifier
- Train a small, explainable classifier (tf-idf + logistic regression/SVM) with labeling functions (negation, bounds, temporal, definitional cues) to improve type accuracy deterministically.

---

## LLM Usage, Stabilized

### LLM as normalizer only
- Keep deterministic rule-based candidate extraction; use LLM to rewrite each sentence into a canonical form. Validate with JSON schema, temperature 0; hash normalized sentence.

### LLM with explicit provenance
- Require `source_clauses` (headings/line spans) in output; reject responses without attribution; fallback to rules if validation fails.

### Self-consistency
- Query k times at temp 0 per sentence; select lexical medoid/majority for type/tags to reduce variance; deterministic tie-breakers.

---

## Graph and Identity Evolution

### Typed edges and optional hierarchy
- Relation types: `defines`, `refines`, `constrains`, `invariant_of`, `duplicates`, `relates_to`.
- Add optional `parent_canon_id`; use heading depth + similarity to propose hierarchies; use typed edges in `warm-hasher` context.

### Soft identity anchor
- Add `canon_anchor` (e.g., SimHash/LSH of embedding or MinHash of tags) to match across minor rephrasing.
- Diff logic: match by anchor first, then compare `canon_id` to decide "same concept, changed wording" vs "new node."

---

## Implementation Sketch (Files and Changes)

| File | Changes |
|------|---------|
| `src/normalizer.ts` | Don't sort numbered lists; protect bullet items with arrows/ordinals; preserve transition sequences; preserve hyphenated compounds as single tokens |
| `src/canonicalizer.ts` | Add sentence segmentation; split coordinated modals; expand type patterns with scoring rubric; add `confidence` field; extend `extractTerms` with acronym whitelist and phrase retention |
| `src/canonicalizer-llm.ts` | Require `source_clauses` in schema; validate and attribute to multiple clauses; remove positional fallback; fall back to rule-based if schema invalid |
| `src/warm-hasher.ts` | Include only typed edges and/or high-confidence nodes in warm context; cap linked IDs to reduce incidental invalidations |
| New: tag inverted index utility | Build idf-weighted candidate generator; cap max neighbors; replace O(n²) linking in both paths |
| CLI and diagnostics | Print per-clause coverage %, uncovered sentence snippets, and top reasons for drop |

---

## Measurement and Targets

| Metric | Current | Target |
|--------|---------|--------|
| Extraction recall | ~70% | +15–25% on prose-heavy specs |
| Type accuracy | ~60% | +20–30% absolute with enhanced rules/weak supervision |
| Linking precision | ~40% | +25–40% absolute using idf-weighted candidates or embeddings |
| Provenance accuracy (rule) | 100% | 100% (maintain) |
| Provenance accuracy (LLM) | ~80% | ≥95% with explicit sources; multi-clause enabled |
| Identity stability (rule) | 100% | 100% (maintain) |
| Identity stability (LLM) | ~90% | Stabilized via normalization + anchors |
| Scalability | O(n²) linking | Near-linear with candidate pruning; supports 5–10k nodes |

---

## References (Academic & OSS)

### Semantic extraction and typing
- Reimers & Gurevych (2019). Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks. arXiv:1908.10084.
- Mavin et al. (2009/2010). EARS: The Easy Approach to Requirements Syntax.
- Ferrari et al. (2017). NLP for Requirements Engineering: Systematic Literature Review.
- Banko et al. (2007). Open Information Extraction from the Web. (OpenIE/OLLIE line of work).
- He et al. (2017). Deep Semantic Role Labeling.

### Linking, similarity, anchors
- Broder (1997). On the resemblance and containment of documents (MinHash).
- Charikar (2002). Similarity Estimation Techniques from Rounding Algorithms (SimHash).
- Malkov & Yashunin (2018). HNSW for Approximate Nearest Neighbors.

### Keyphrases and JS tooling
- Mihalcea & Tarau (2004). TextRank for keyphrase extraction.
- RAKE (Rose et al., 2010). Rapid Automatic Keyword Extraction.
- KeyBERT (Grootendorst, 2020). Keyphrase extraction via embeddings.
- `xenova/transformers.js` — run MiniLM/E5 locally in Node.
- `wink-nlp` / `compromise` — JS POS and noun-phrase extraction.

### LLM stability and structured output
- Structured/JSON-constrained decoding (OSS: outlines, guidance-style libs).
- Wang et al. (2023). Self-Consistency improves chain-of-thought (ensembling for stability).

---

## Proposed Roadmap (6–8 weeks)

| Week | Focus |
|------|-------|
| 1–2 | **Quick wins**: Sentence segmentation; coverage reporting; improved rule patterns; acronym whitelist; stop sorting sequences. Inverted-index linking with idf filtering; cap node degree; update warm-hasher to use high-confidence links only. |
| 3–4 | **Multi-clause provenance and typed edges**: Add multi-source attribution; heuristics-based typed relations; CLI diagnostics. |
| 5–6 | **Local embeddings and anchors** (optional flag): Integrate transformers.js; compute anchors; evaluate on fixtures; keep behind feature flag. |
| 7–8 | **LLM stabilization** (optional): LLM normalization path; explicit clause references schema; self-consistency; fallbacks and tests. |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Semantic drift from normalizer changes | Guard with tests on ordered lists/transitions; feature flag if needed |
| Over-linking regressions | Cap links per node; require idf-weighted overlap; toggle embedding/anchor features behind flags |
| LLM nondeterminism | Keep rule path primary; use LLM only for normalization with strict schema; add self-consistency |
| Performance regressions | Benchmark linking pre/post; ensure near-linear behavior with candidate pruning |

---

## Open Questions for the Team

1. Confirm acceptance of sentence-level extraction and coverage reporting in CLI.
2. Approve normalization change to preserve ordered sequences.
3. Choose initial path for linking: idf-filtered tags vs local embeddings.
4. Decide whether to introduce `confidence`, typed edges, and `canon_anchor` in the data model now (fields can be optional, defaulted).

---

*Automated code review generated 2026-02-19. Source: OpenAI Codex analysis of Phoenix VCS codebase.*
