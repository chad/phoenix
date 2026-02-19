# Canonicalization: Technical Deep-Dive & Open Problems

**Version:** 1.0  
**Status:** Research review document  
**Audience:** Research team — evaluate alternative approaches to canonicalization  
**Goal:** Explain exactly what canonicalization does, how it's currently implemented, what works, what doesn't, and where we need better ideas.

---

## 1. What Canonicalization Does

Canonicalization is the **central transformation** in Phoenix. It converts raw text extracted from specification documents (clauses) into a typed, linked graph of canonical nodes — structured statements that the rest of the system can reason about.

```
Clause (raw text block)           Canonical Node (structured)
─────────────────────────          ──────────────────────────
"Tasks must support status    →    type: REQUIREMENT
 transitions: open →               statement: "tasks must support status
 in_progress → review → done"        transitions: open → in_progress →
                                       review → done"
                                   tags: [tasks, support, status,
                                          transitions, open, ...]
                                   source_clause_ids: [<clause_id>]
                                   linked_canon_ids: [<related_nodes>]
```

### What it must produce

Each canonical node has:

| Field | Purpose |
|-------|---------|
| `canon_id` | Content-addressed identity: `SHA-256(type + statement + source_clause_id)` |
| `type` | One of: REQUIREMENT, CONSTRAINT, INVARIANT, DEFINITION |
| `statement` | Normalized, unambiguous English sentence expressing one idea |
| `source_clause_ids` | Provenance: which clause(s) this node was extracted from |
| `linked_canon_ids` | Cross-references: other canon nodes this node relates to |
| `tags` | Extracted domain terms for search, linking, and IU grouping |

### Why it matters

Canonicalization is the **bottleneck** of the entire pipeline. Every downstream system depends on its output quality:

- **IU Planner** groups canon nodes into implementation units — if nodes are too coarse, IUs are too broad to selectively invalidate. If nodes are too fine, IUs proliferate.
- **Change Classification** uses canon node identity to determine what changed — if canonicalization is unstable (same input produces different nodes across runs), the classifier sees phantom changes.
- **Selective Invalidation** traces from changed clauses → affected canon nodes → affected IUs. If a clause maps to too many canon nodes, invalidation loses selectivity.
- **Provenance** must be accurate: every canon node must trace back to the specific clause(s) that justify it. Broken provenance means `phoenix inspect` lies.

---

## 2. Current Implementation: Rule-Based Canonicalizer

**File:** `src/canonicalizer.ts` (155 lines)

### 2.1 Algorithm

```
Input:  Clause[]
Output: CanonicalNode[]

For each clause:
  Split clause.raw_text into lines
  For each non-empty, non-heading line:
    Strip list markers (-, *, •, 1.)
    Skip lines shorter than 5 characters
    Classify line type using regex patterns
    If classified:
      Normalize text (lowercase, strip formatting)
      Extract tags (non-stopword tokens > 2 chars)
      Generate canon_id = SHA-256(type + statement + clause_id)
      Create node with [clause_id] as source
    Else:
      Skip (line produces no canonical node)

After all nodes extracted:
  Link nodes by shared terms (≥2 common tags → bidirectional link)
```

### 2.2 Type Classification

The classifier uses ordered regex pattern matching. Most specific patterns (constraints, invariants) are checked first.

**Constraint patterns** (checked first):
```
/\b(?:must not|shall not|forbidden|prohibited|cannot|disallowed)\b/i
/\b(?:limited to|maximum|minimum|at most|at least|no more than)\b/i
```

**Invariant patterns**:
```
/\b(?:always|never|invariant|at all times|guaranteed)\b/i
```

**Requirement patterns** (broadest, checked last):
```
/\b(?:must|shall|required|requires?)\b/i
/\b(?:needs? to|has to|will)\b/i
```

**Definition patterns**:
```
/\b(?:is defined as|means|refers to)\b/i
/:\s+\S/    (colon followed by text)
```

**Heading context fallback:** If no pattern matches a line, the classifier checks the clause's `section_path` (heading hierarchy) for keywords like "constraint", "requirement", "definition", "invariant". This allows lines under a "Security Constraints" heading to be classified as constraints even without explicit keywords.

**If nothing matches:** The line is dropped — it produces no canonical node.

### 2.3 Text Normalization

Before hashing, text is normalized (`src/normalizer.ts`):

- Markdown formatting stripped (bold, italic, links, code fences)
- Headings removed
- Lowercased
- List items sorted alphabetically (so reordering lists doesn't change the hash)
- Whitespace collapsed

This ensures formatting-only changes produce identical normalized output and thus identical `clause_semhash` values.

### 2.4 Term Extraction & Linking

Tags are extracted by tokenizing, removing stopwords (a curated list of ~55 English function words), and keeping tokens > 2 characters.

Linking: O(n²) pairwise comparison. Two nodes are linked if they share ≥ 2 tags. Links are bidirectional.

### 2.5 Concrete Output (TaskFlow Example)

Input: `spec/tasks.md` (34 lines, 4 sections, 18 list items)

| Stage | Count |
|-------|-------|
| Clauses extracted | 5 (one per heading) |
| Canonical nodes | 18 (one per list item) |
| Types | 18 REQUIREMENT, 0 CONSTRAINT, 0 INVARIANT, 0 DEFINITION |
| Linked pairs | 12 bidirectional links |

Input: `tests/fixtures/spec-auth-v1.md` (29 lines, 4 sections)

| Stage | Count |
|-------|-------|
| Clauses extracted | ~6 |
| Canonical nodes | 8 |
| Types | 6 REQUIREMENT, 2 CONSTRAINT, 0 INVARIANT, 0 DEFINITION |

Input: `tests/fixtures/spec-notifications.md`

| Stage | Count |
|-------|-------|
| Canonical nodes | 14 |
| Types | 12 REQUIREMENT, 1 CONSTRAINT, 1 INVARIANT, 0 DEFINITION |

---

## 3. Current Implementation: LLM-Enhanced Canonicalizer

**File:** `src/canonicalizer-llm.ts` (195 lines)

### 3.1 Algorithm

```
Input:  Clause[], LLMProvider | null
Output: CanonicalNode[]

If no LLM provider → fall back to rule-based

Batch clauses into groups of 20
For each batch:
  Build prompt:
    System: "You are a requirements engineer extracting structured canonical nodes..."
    User:   For each clause, output section header + raw text
    Request: JSON array of {type, statement, tags}

  Send to LLM (temperature: 0.1, max_tokens: 4096)
  Parse response:
    Strip markdown fences
    Find JSON array
    Validate each element has type (string) and statement (string)

  For each parsed node:
    Match to best source clause by term overlap
    Generate canon_id = SHA-256(type + statement + source_clause_id)
    Create node

After all batches:
  Link nodes by shared terms (same O(n²) algorithm)

On any failure → fall back to rule-based
```

### 3.2 Source Clause Attribution

The LLM returns flat JSON with no explicit clause references. To establish provenance, the system uses a **best-match heuristic**: for each LLM-returned node, it finds the clause whose text has the most word overlap with the node's statement + tags.

```typescript
function findBestSourceClause(node: LLMCanonNode, clauses: Clause[]): Clause | null {
  // Tokenize node statement + tags → nodeTerms
  // For each clause: count overlap between clause tokens and nodeTerms
  // Return clause with highest overlap
}
```

If no good match, it falls back to positional assignment (node index → clause index, clamped).

### 3.3 LLM Prompt

```
System:
You are a requirements engineer extracting structured canonical nodes
from specification text.

For each meaningful statement, extract a JSON object with:
- type: one of REQUIREMENT, CONSTRAINT, INVARIANT, DEFINITION
- statement: the normalized canonical statement
- tags: array of key domain terms (lowercase, no stop words)

Rules:
- REQUIREMENT: something the system must do
- CONSTRAINT: something the system must NOT do, or limits/bounds
- INVARIANT: something that must ALWAYS or NEVER hold
- DEFINITION: defines a term or concept

Output a JSON array. No markdown fences, no explanation.
Only extract nodes where there is a clear, actionable statement.
Skip headings, meta-text, and filler.
```

---

## 4. What Works

### 4.1 Content-Addressed Identity Is Sound

The `canon_id = SHA-256(type + statement + source_clause_id)` scheme means identical extraction from identical input always produces the same node ID. This is critical for change detection: if a clause doesn't change, its canon nodes keep their IDs, and no downstream invalidation fires.

### 4.2 Provenance Tracking Is Correct (For Rule-Based)

In the rule-based path, every canon node is created directly from a specific clause's text. The `source_clause_ids` array is always correct because the mapping is syntactic — line N of clause C produces node N of clause C.

### 4.3 Fallback Strategy Is Robust

The LLM-enhanced path falls back to rule-based on any failure (no provider, parse error, empty result, timeout). This means canonicalization never blocks on external dependencies.

### 4.4 Normalization Produces Stable Hashes

List sorting, whitespace collapse, and format stripping mean that most cosmetic edits (reindenting, reordering bullets, changing bold to italic) produce identical `clause_semhash` values and thus don't trigger re-canonicalization.

---

## 5. What's Wrong: Known Shortcomings

### 5.1 Rule-Based: Everything Is a REQUIREMENT

**The problem:** The task management spec has 18 canon nodes. All 18 are typed as REQUIREMENT. Zero constraints, zero invariants, zero definitions.

This is clearly wrong. "Tasks must support status transitions: open → in_progress → review → done" is a requirement, but it also implicitly defines "task" and the valid statuses. "Invalid status transitions must be rejected" is a constraint. The rule-based classifier can't see these semantic distinctions — it matches "must" and calls everything a REQUIREMENT.

**Impact:** Type information is used to derive risk tiers, evidence policies, and invariant lists on IU contracts. If everything is REQUIREMENT, risk assessment is degraded and invariants are empty. In the TaskFlow example, zero invariants are extracted, so IU contracts have empty invariant lists.

**Root cause:** Regex patterns are too blunt. "Must" appears in requirements, constraints, and invariants. The patterns need semantic understanding that regex can't provide.

### 5.2 Rule-Based: Line-Level Granularity Is Too Rigid

**The problem:** The canonicalizer operates line-by-line. Each line that matches a pattern becomes one canonical node. This means:

- A multi-line statement split across lines produces multiple incomplete nodes
- A compound statement ("X must do A and must do B") becomes one node instead of two
- Paragraph-style specs (not bulleted lists) often produce zero nodes because no single line matches a pattern strongly enough

**Example failure:** Consider this spec text:
```
Tasks support three assignment modes. In single mode, one person owns
the task. In team mode, the task is shared. The assignee must accept
the assignment before it takes effect.
```

The rule-based canonicalizer would:
- Skip line 1 (no keyword match for "support three assignment modes")
- Skip line 2 (no "must/shall" keyword)
- Extract only line 3 as a REQUIREMENT ("the assignee must accept...")
- Miss the definition of assignment modes entirely

**Impact:** Specs that use flowing prose instead of bulleted lists get significantly fewer canonical nodes extracted. The system penalizes a writing style.

### 5.3 Rule-Based: Dropped Lines Are Silent

**The problem:** When a line doesn't match any pattern and there's no heading context, it's silently dropped. There is no diagnostic, no coverage metric, no way to know that 30% of your spec text was ignored.

**Impact:** Users don't know their spec has uncovered requirements. A clause might have 8 lines but produce only 3 canon nodes. The other 5 lines — which may contain important context, definitions, or implicit constraints — are invisible to the rest of the pipeline.

### 5.4 Term-Based Linking Is Noisy

**The problem:** Nodes are linked if they share ≥ 2 non-stopword tags. With extracted tags like `[tasks, status, transitions, open, ...]`, the word "tasks" appears in nearly every node in a task management spec. This means most nodes end up linked to most other nodes.

**Concrete example:** In the TaskFlow spec, node [15] ("overdue tasks must be flagged automatically") is linked to **5 other nodes** — nearly a third of all nodes. Node [2] ("tasks must support status transitions") is linked to **4 nodes**.

When everything is linked to everything, linking provides no useful information. It's noise, not signal.

**Root cause:** The linking threshold (≥ 2 shared tags) is too low for domains with small vocabularies. And tag extraction is just tokenization + stopword removal — there's no concept of term importance or domain specificity.

### 5.5 LLM Path: Provenance Attribution Is Heuristic

**The problem:** When the LLM extracts canonical nodes, the system doesn't know which clause each node came from. It guesses using word overlap: "which clause's text overlaps most with this node's statement and tags?"

This heuristic breaks when:
- The LLM synthesizes a node from multiple clauses (the node is a composite)
- The LLM rephrases heavily (low word overlap with any single clause)
- Two clauses cover similar vocabulary (ambiguous attribution)

**Impact:** `source_clause_ids` may be wrong for LLM-extracted nodes. This means the provenance graph lies — you trace a canon node back to a clause, but it was actually derived from a different clause (or multiple clauses). This undermines the core promise of Phoenix: "you can trace any generated file back to the spec sentence that caused it."

### 5.6 LLM Path: Instability Across Runs

**The problem:** Even with `temperature: 0.1`, the LLM may produce slightly different statements across runs. "Tasks must support status transitions" might become "The system shall allow task status transitions" on a second run. These produce different normalized text → different `canon_id` → the system sees phantom changes.

**Impact:** Re-running `phoenix canonicalize` on an unchanged spec may produce different canon_ids, triggering unnecessary downstream invalidation. This defeats the purpose of content-addressed identity.

**Root cause:** LLMs are not deterministic functions. Temperature 0.1 is low but not zero, and even at temperature 0, implementation details (batching, floating point, etc.) cause variation.

### 5.7 LLM Path: No Structural Awareness

**The problem:** The LLM receives clause text with section headers, but the prompt doesn't convey structural relationships: "this clause is in the same document as these other clauses," "this section is nested under that section," "these three clauses are sequential."

**Impact:** The LLM can't extract cross-clause relationships. If clause 1 defines "task" and clause 2 references "task" without re-defining it, the LLM extracts from clause 2 without the context that "task" was defined in clause 1. This limits the LLM's ability to produce accurate types (DEFINITION vs. REQUIREMENT) and cross-references.

### 5.8 One-to-One Clause→Node Assumption

**The problem:** Both the rule-based and LLM paths assume each canon node comes from exactly one clause (`source_clause_ids` is always a single-element array in practice). But real requirements often span multiple clauses:

- "Tasks have statuses" (clause in section 1) + "Statuses must follow the transition graph" (clause in section 2) = one canonical requirement that needs both clauses as provenance
- "Users are authenticated" (auth spec) + "Authenticated users can create tasks" (task spec) = cross-document dependency

**Impact:** Canon nodes can't express multi-clause provenance, which means cross-cutting requirements (security constraints that apply to multiple features, definitions used across sections) are either duplicated or attributed to only one source.

### 5.9 No Merge/Dedup Across Clauses

**The problem:** Two clauses in different sections might express the same requirement. The canonicalizer creates two separate nodes with different `canon_id`s (because `source_clause_id` is part of the hash). There is no deduplication.

**Example:**
- Clause in "Task Lifecycle": "Tasks must have a status"
- Clause in "Assignment": "Each task has a status that affects assignment eligibility"

These should arguably be one canonical node with two source clauses. Instead they're two nodes that happen to share some tags.

### 5.10 O(n²) Linking Doesn't Scale

**The problem:** The linking algorithm compares every pair of nodes. For the TaskFlow example (54 total nodes across 3 specs), this is 1,431 comparisons — fine. For a real project with 500 canon nodes, it's 124,750 comparisons. For 5,000 nodes, it's 12.5 million.

The comparison itself is also naive (array intersection of string tags), not just the iteration pattern.

---

## 6. Deeper Structural Problems

### 6.1 No Notion of "Coverage"

The system doesn't track what percentage of a clause's content was extracted into canonical nodes. A clause with 10 sentences might produce 3 canon nodes, and the other 7 sentences are silently ignored. There's no metric for this.

**What we need:** A coverage score per clause: `nodes_extracted / extractable_statements`. This would let `phoenix status` warn: "Clause at spec/tasks.md L14-20 has 35% coverage — 4 statements were not canonicalized."

### 6.2 No Confidence Scoring

Canon nodes have no confidence score. A node extracted by a perfect regex match on "shall not" has the same weight as a node extracted from heading context fallback on an ambiguous line. The downstream systems (IU planner, classifier) can't distinguish high-confidence extractions from low-confidence ones.

### 6.3 Canonicalization Is Not Idempotent Under Composition

If you canonicalize clauses 1–5, then later canonicalize clauses 6–10, and then canonicalize all 10 together, you get different linking results. The pairwise linking step is global — adding new nodes creates new links between existing nodes. This means the order of canonicalization matters for the link graph, even though the node extraction per-clause is independent.

### 6.4 No Hierarchy in Canonical Graph

The canonical graph is flat — all nodes are peers connected by undirected links. But requirements naturally form hierarchies: "The system supports task management" decomposes into "Tasks have lifecycle states" which decomposes into "Status transitions follow the allowed graph." This parent-child structure is lost.

### 6.5 The Statement Is The Identity

Because `canon_id = SHA-256(type + statement + clause_id)`, the statement is the identity. If the LLM slightly rephrases a statement, it's a completely new node. There is no "soft identity" or similarity threshold — you're either identical or you're different.

This creates a tension: we want statements to be normalized (so identity is stable) but also want them to be meaningful (so humans can read them). Heavy normalization helps stability but hurts readability. Light normalization helps readability but hurts stability.

---

## 7. What Better Approaches Might Look Like

These are directions for the research team to evaluate. We're not prescribing solutions — we're naming the design space.

### 7.1 Semantic Chunking Instead of Line Splitting

Instead of splitting on line boundaries, identify **semantic units** within clause text — statements that express a single requirement or constraint, regardless of how many lines they span.

Possible approaches:
- Sentence boundary detection + classification per sentence
- Dependency parsing to identify clause-level semantic units
- LLM-based extraction with explicit sentence boundary identification

### 7.2 Multi-Pass Extraction

```
Pass 1: Extract DEFINITION nodes (terms, concepts)
Pass 2: Extract REQUIREMENT nodes, resolving references to definitions
Pass 3: Extract CONSTRAINT/INVARIANT nodes, linking to requirements they constrain
Pass 4: Cross-document resolution (same term used in different specs)
```

Multi-pass could solve the typing problem (pass 1 establishes vocabulary, later passes use it) and the cross-clause provenance problem (pass 4 links across documents).

### 7.3 Embedding-Based Linking Instead of Keyword Matching

Replace term overlap linking with embedding similarity. Compute a vector embedding for each canon node's statement, then link nodes whose embeddings are within a threshold.

Advantages: captures semantic similarity ("rate limiting" and "throttling" would link). Disadvantages: requires embedding model, threshold tuning, and introduces non-determinism.

### 7.4 Hierarchical Canonical Graph

Add a `parent_canon_id` field. Top-level nodes represent high-level capabilities. Children represent specific requirements. Leaves represent constraints/invariants.

This would enable hierarchical invalidation: changing a leaf only invalidates its subtree, not the whole cluster connected by term overlap.

### 7.5 Stable Canonical Identity (Soft Matching)

Instead of exact hash identity, use a **two-layer identity**:
- `canon_id` (exact): current SHA-256 scheme, changes on any rewording
- `canon_anchor`: a stable identity based on semantic meaning, survives minor rephrasing

The anchor could be:
- SHA-256 of sorted tags (survives statement rewording if tags are stable)
- Embedding hash (locality-sensitive hash of statement embedding)
- Clause-anchored: `SHA-256(source_clause_id + type)` (stable as long as source clause and type don't change)

When comparing old and new canonical graphs, match first by `canon_anchor`, then by `canon_id`. This separates "this node changed its wording" from "this is a completely new node."

### 7.6 LLM With Clause References in Output

Modify the LLM prompt to require explicit clause attribution:

```json
{
  "type": "REQUIREMENT",
  "statement": "Tasks must support status transitions: open → in_progress → review → done",
  "source_clauses": ["Task Lifecycle"],
  "tags": ["task", "status", "transitions"]
}
```

The LLM identifies which section/clause each node came from. This replaces the term-overlap heuristic for provenance.

### 7.7 Coverage-Aware Extraction

After extraction, compute a coverage map: for each sentence/line in the original clause, did any canon node claim it? Report uncovered content as a diagnostic.

This could be combined with a "residual" extraction pass: after the first pass, feed uncovered sentences back to the extractor with a prompt like "these statements were not classified — are they requirements, constraints, definitions, or truly irrelevant?"

### 7.8 Deterministic LLM Normalization

Instead of using the LLM for extraction, use it only for **normalization**: the rule-based extractor identifies candidate nodes, then the LLM normalizes each statement to a canonical form. This preserves the deterministic extraction (same input → same candidates) while improving statement quality.

```
Rule-based: extracts "Tasks must support status transitions: open → in_progress → review → done"
LLM normalizer: "The system shall support task status transitions following the graph: open → in_progress → review → done"
```

The normalized statement is hashed for identity. Because the LLM input is a single sentence (not a whole clause), output variance is much lower.

---

## 8. Evaluation Criteria for New Approaches

Any replacement or augmentation of the canonicalization system must be evaluated against:

| Criterion | Description | Current Baseline |
|-----------|-------------|-----------------|
| **Extraction recall** | % of spec statements that produce at least one canon node | ~70% (prose paragraphs are missed) |
| **Type accuracy** | % of canon nodes with correct type classification | ~60% (everything tends toward REQUIREMENT) |
| **Provenance accuracy** | % of canon nodes with correct source_clause_ids | 100% rule-based, ~80% LLM (heuristic attribution) |
| **Identity stability** | Same input → same canon_ids across runs | 100% rule-based, ~90% LLM (temperature variance) |
| **Linking precision** | % of links that represent genuine semantic relationships | ~40% (keyword overlap is noisy) |
| **Linking recall** | % of genuine semantic relationships that are captured | ~30% (misses synonym and implication relationships) |
| **Cross-clause resolution** | Can a canon node cite multiple source clauses? | No (single clause only) |
| **Coverage visibility** | Does the system report what was NOT extracted? | No |
| **Scalability** | Performance at 1K, 10K, 100K nodes | O(n²) linking is the bottleneck |
| **Latency** | Time to canonicalize 100 clauses | <100ms rule-based, 5–15s LLM |
| **Determinism** | Does repeated execution produce identical output? | Yes rule-based, no LLM |
| **Fallback graceful** | Does the system degrade gracefully without LLM? | Yes |

---

## 9. Code Pointers

| File | Lines | What It Does |
|------|-------|-------------|
| `src/canonicalizer.ts` | 155 | Rule-based extraction: pattern matching, term extraction, linking |
| `src/canonicalizer-llm.ts` | 195 | LLM-enhanced extraction: batched prompt, JSON parsing, heuristic provenance |
| `src/normalizer.ts` | 70 | Text normalization: format stripping, list sorting, whitespace collapse |
| `src/semhash.ts` | 55 | SHA-256 hashing, clause_semhash, context_semhash_cold |
| `src/warm-hasher.ts` | 50 | context_semhash_warm incorporating canonical graph context |
| `src/spec-parser.ts` | 130 | Markdown → Clause[] (section boundary detection, heading hierarchy) |
| `src/models/canonical.ts` | 30 | CanonicalNode and CanonicalGraph type definitions |
| `src/store/canonical-store.ts` | 90 | Persistence layer for canonical graph |
| `tests/functional/canonicalization.test.ts` | 140 | Integration tests for the full canonicalization pipeline |

---

## 10. Summary of What We Need Help With

Ranked by impact:

1. **Better type classification.** The current system classifies almost everything as REQUIREMENT. We need an approach that reliably distinguishes requirements, constraints, invariants, and definitions — ideally without requiring an LLM for every extraction.

2. **Stable multi-clause provenance.** Canon nodes must be able to cite multiple source clauses, and LLM-extracted nodes must have accurate (not heuristic) provenance.

3. **Meaningful linking.** The current keyword-overlap linking produces too many false connections. We need linking that captures actual semantic relationships (constraint-constrains-requirement, definition-defines-term-used-in-requirement) without requiring O(n²) comparisons.

4. **Coverage visibility.** Users need to know what percentage of their spec was successfully canonicalized, and which statements were dropped.

5. **Identity stability under LLM extraction.** If we use LLMs, we need a way to produce stable canon_ids across runs. The current statement-is-identity model breaks with any LLM variance.

6. **Extraction from prose.** The system only handles bulleted lists well. Flowing prose, tables, and mixed-format specs need better support.

We're looking for approaches that maintain Phoenix's core properties — content-addressed identity, explicit provenance, deterministic fallback — while dramatically improving extraction quality, type accuracy, and linking precision.

---

*Generated from Phoenix VCS v0.1.0 codebase. All code is TypeScript, zero runtime dependencies, ~700 lines total for canonicalization.*
