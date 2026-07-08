# Phoenix VCS — System Architecture

## Overview

Phoenix is a causal compiler for intent. It transforms spec documents through a pipeline into generated code, with full provenance tracking and selective invalidation.

The rule-based stages (parsing, normalization, hashing, scoring, clustering, diffing) are deterministic. The LLM-assisted stages (canonicalization, IU clustering, code generation) are **not** byte-deterministic — the same spec can yield different code across runs. Phoenix does not promise semantic determinism (an explicit PRD non-goal); it makes generation *reproducible from its record* (model id, true promptpack hash, toolchain version — all captured in the provenance journal) and *conservative* by gating regeneration on durable evaluations.

## System Layers

```
┌─────────────────────────────────────────────────┐
│                   CLI / Bot Interface            │
├─────────────────────────────────────────────────┤
│              Policy & Evidence Engine            │
├─────────────────────────────────────────────────┤
│             Regeneration Engine                  │
├─────────────────────────────────────────────────┤
│        Implementation Graph (IU Manager)        │
├─────────────────────────────────────────────────┤
│        Canonicalization Pipeline                 │
├─────────────────────────────────────────────────┤
│     Spec Ingestion (Clause Extraction)          │
├─────────────────────────────────────────────────┤
│          Content-Addressed Store                │
│         (Graph DB + Blob Storage)               │
└─────────────────────────────────────────────────┘
```

## Five Core Graphs

1. **Spec Graph** — Clauses extracted from spec documents
2. **Canonical Graph** — Requirements, Constraints, Invariants, Definitions
3. **Implementation Graph** — Implementation Units (IUs) with contracts & boundaries
4. **Evidence Graph** — Tests, analysis results, reviews bound to nodes
5. **Provenance Graph** — All transformation edges connecting the above

## Content Addressing

All nodes use content-based IDs:
- `clause:{sha256(normalized_text + source_doc_id + section_path)}`
- `canon:{sha256(canonical_statement + type + linked_clauses)}`
- `iu:{sha256(kind + contract + boundary_policy)}`

## Directory Structure

```
.phoenix/                    # Phoenix metadata root
  store/objects/             # Content-addressed store (clause + canon blobs)
  graphs/
    spec.json                # Spec graph index (doc → clause ids)
    canonical.json           # Canonical graph index (nodes + clause provenance)
    ius.json                 # Implementation Unit graph (with derived dependencies)
    evidence.json            # Evidence records
    warm-hashes.json         # Warm context hashes
  manifests/
    generated_manifest.json  # Per-file / per-IU content hashes + line provenance
  evaluations/evaluations.json  # Durable behavioral evaluations
  journal.jsonl              # Append-only, hash-chained provenance journal
  changes.json               # Classified change log + rolling D-rate window
  invalidation.json          # Current staleness set (which IUs a spec change made stale)
  canon-stability.json       # Canonical-stability snapshot + last result
  waivers.json               # Drift labels (waiver / temporary_patch / promote_to_requirement)
  promotions.json            # Pending promote-to-requirement records
  pending-confirms.json      # Bot mutating commands awaiting confirmation
  build-status.json          # Last compile-gate result
  state.json                 # System state (BOOTSTRAP_COLD, WARMING, STEADY_STATE)
  config.json                # Provider + architecture configuration
```

The **journal** (`journal.jsonl`) is the unified provenance graph: every
transformation (ingest, canonicalize, plan, regen, invalidate, label, evidence)
appends a hash-chained event, so the history is tamper-evident and any generated
artifact can be traced back to the spec lines that produced it (`phoenix why`).
The graph JSON files are the working indexes; the journal is the authoritative
record of how they came to be.

## Build Phases

| Phase | Components | Dependencies |
|-------|-----------|-------------|
| A | Clause extraction, clause_semhash | None |
| B | Canonicalization, warm hashing, classifier | A |
| C1 | IU module-level, regen, manifest | B |
| C2 | Boundary validator, UnitBoundaryChange | C1 |
| D | Evidence, policy, cascade | C2 |
| E | Shadow pipeline, compaction | D |
| F | Freeq bots | All |
