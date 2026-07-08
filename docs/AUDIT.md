# Phoenix VCS — Project Audit Report

> **⚠️ SUPERSEDED (2026-07-08).** This audit describes an early snapshot (Phases
> A–C2, ~4k lines, 142 tests). The codebase has since grown ~3× and the trust
> loops have been closed. Notably resolved since this audit: **H1** (provenance
> graph) is now the hash-chained `journal.jsonl` with `phoenix why`; **M3/M4**
> (manifest/orphan reconciliation, store GC) are addressed by `replaceNodes` +
> content-store `remove`; the classifier→D-rate loop, evidence collection, drift
> labeling, IU dependencies, selective invalidation, two-layer identity, durable
> evaluations, and the fault-injection status eval are all implemented. Kept for
> historical context; do not treat its "not yet fixed" items as current.

**Date:** 2026-02-17  
**Scope:** Phases A, B, C1, C2  
**Lines of code:** ~2,450 source, ~1,800 test (4,258 total)  
**Tests:** 142 passing across 17 test files (14 unit + 3 functional)

---

## ✅ What's Working Well

1. **Clean architecture** — Models, logic, and storage are well-separated. Models are pure types, logic is pure functions (easy to test), stores handle persistence.

2. **Content-addressed design** — Every object (clause, canonical node, IU) is identified by a hash of its content. This is sound and will scale well.

3. **Test coverage** — Every module has unit tests. Three functional tests validate end-to-end pipelines. All 142 pass in ~110ms.

4. **TypeScript strict mode** — `strict: true` enabled, compiles cleanly with no suppressions in source code.

5. **Provenance chain** — The traceability from spec lines → clauses → canonical nodes → IUs → generated files → boundary validation is fully connected.

---

## 🔧 Issues Fixed During Audit

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | **Duplicate boundary diagnostics** — When a package was both forbidden and not in the allowlist, two diagnostics were emitted for the same import. | Medium | Changed to `else if` so forbidden check takes priority. |
| 2 | **Dead code in classifier** — The D-class branch inside the canon-impact block was unreachable (confidence was always ≥ 0.7, threshold was < 0.6). | Low | Removed dead branch. |
| 3 | **`as any` in tests** — Two test lines used `{} as any` for signal objects. | Low | Replaced with properly typed empty signal objects. |

---

## ⚠️ Issues to Address (Not Yet Fixed)

### High Priority

**H1. No provenance graph persistence**  
The PRD specifies a Provenance Graph (Section 2) that records all transformation edges. Currently, provenance is implicit (canonical nodes have `source_clause_ids`, IUs have `source_canon_ids`), but there's no unified provenance store. Every transformation should emit a provenance edge to a dedicated graph.

**H2. Normalizer doesn't handle code blocks**  
Fenced code blocks (` ``` `) are currently processed like regular text — headings and list items inside code blocks get mangled. The parser should skip code block contents during normalization.

**H3. No pre-heading content handling**  
If a spec file has content before the first heading (e.g., a preamble), it's silently discarded by the parser. Only heading-bounded sections are captured. The PRD doesn't explicitly address this, but losing content is wrong.

**H4. Classifier D-class is hard to trigger**  
The current classification logic produces D (uncertain) only when `norm_diff > 0.7 || term_ref_delta > 0.7` AND no canonical impact AND no context shift. This is a very narrow window. The D-rate mechanism needs real exercise.

### Medium Priority

**M1. IU planner grouping is greedy**  
`clusterNodes()` uses BFS to group all transitively connected nodes. In a large spec, this could collapse too many unrelated requirements into a single giant IU because of loose term overlap chains (A links to B links to C...). Should add a max-cluster-size or minimum-link-weight threshold.

**M2. Regeneration is stub-only**  
The regen engine only produces function stubs. This is expected for v1, but the stub quality is minimal — no imports, no types, no contract enforcement in the generated code. The stubs should at least generate TypeScript interfaces from the IU contract.

**M3. Manifest doesn't track deleted files**  
If a file is removed from `output_files` between regenerations, the old manifest entry persists. Need a reconciliation step that detects orphaned manifest entries.

**M4. Content store has no garbage collection**  
Objects are never deleted. After multiple ingestions, stale clause objects accumulate. Need either reference counting or mark-and-sweep relative to the current graph indices.

**M5. Side channel detection is shallow**  
The dep-extractor uses regex patterns. It misses indirect patterns like `const { env } = process; env.SECRET`, dynamic imports, and aliased require calls. Acceptable for v1 but should move to AST-based extraction.

**M6. Spec parser doesn't handle ATX heading edge cases**  
Lines like `# ` (heading marker with no text), `##text` (no space), or setext-style headings (`Title\n====`) are not handled.

### Low Priority

**L1. No .gitignore**  
The project is missing a `.gitignore` for `node_modules/`, `dist/`, and temp `.phoenix/` directories.

**L2. Demo creates temp directories without cleanup**  
`mkdtempSync` in the demo creates temp dirs that are never cleaned up.

**L3. Store uses synchronous fs operations**  
All file I/O is synchronous (`readFileSync`, `writeFileSync`). Fine for a CLI tool, but should be async if this becomes a long-running server.

**L4. No input validation on store operations**  
`ContentStore.put()` and `SpecStore.ingestDocument()` don't validate inputs. A non-hex ID or missing file would produce cryptic errors.

**L5. Warm hasher performance**  
`computeWarmHashes` iterates all canonical nodes for every clause (O(clauses × nodes)). Should build an index of clause→nodes first.

---

## 📊 Coverage Gaps

| Component | Unit Tests | Functional Tests | Gap |
|-----------|-----------|-----------------|-----|
| Normalizer | ✅ 12 | — | Missing: code blocks, nested markdown |
| Spec Parser | ✅ 11 | ✅ via ingestion | Missing: setext headings, pre-heading content |
| Semhash | ✅ 9 | — | — |
| Diff | ✅ 7 | ✅ via ingestion | Missing: large-scale diff (100+ clauses) |
| Canonicalizer | ✅ 13 | ✅ via canonicalization | — |
| Warm Hasher | ✅ 5 | ✅ via canonicalization | — |
| Classifier | ✅ 7 | ✅ via canonicalization | Missing: D-class exercise |
| D-Rate | ✅ 9 | ✅ via canonicalization | — |
| Bootstrap | ✅ 10 | ✅ via canonicalization | — |
| IU Planner | ✅ 7 | ✅ via IU pipeline | Missing: large spec with many clusters |
| Regen | ✅ 6 | ✅ via IU pipeline | — |
| Manifest | — | ✅ via IU pipeline | Missing: dedicated unit tests for ManifestManager |
| Drift | ✅ 5 | ✅ via IU pipeline | — |
| Dep Extractor | ✅ 10 | ✅ via IU pipeline | — |
| Boundary Validator | ✅ 12 | ✅ via IU pipeline | — |
| Content Store | — | ✅ via ingestion | Missing: dedicated unit tests |
| Spec Store | — | ✅ via ingestion | Missing: dedicated unit tests |
| Canonical Store | — | ✅ via canonicalization | Missing: dedicated unit tests |

---

## 🏗️ Recommendations for Phase D+

1. **Build a Provenance Store** before Evidence/Policy (Phase D) — the evidence engine needs provenance edges to bind evidence to the right graph nodes.

2. **Add a CLI entry point** (`phoenix bootstrap`, `phoenix status`, `phoenix ingest`) — the core logic is all functions/classes but there's no user-facing command.

3. **Add integration tests with the real PRD.md** — run the full A→C2 pipeline against the Phoenix PRD itself as a dogfood test.

4. **Consider property-based testing** for the normalizer and diff engine — these are the foundation and need to be bulletproof.

5. **Add structured logging** — every transformation should emit a structured log event that can reconstruct the provenance graph.
