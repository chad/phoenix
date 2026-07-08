# Phoenix VCS — Complete Manual

**Version 0.1.0 (Alpha)**

Phoenix is a regenerative version control system. It compiles intent — expressed as Markdown specs — into a content-addressed graph of requirements, generated code, and provenance. Every transformation is traceable. Changing one spec line invalidates only the dependent subtree, not the entire repository.

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Core Concepts](#2-core-concepts)
3. [The Five Graphs](#3-the-five-graphs)
4. [Phase A — Spec Ingestion](#4-phase-a--spec-ingestion)
5. [Phase B — Canonicalization](#5-phase-b--canonicalization)
6. [Phase C — Implementation Units](#6-phase-c--implementation-units)
7. [Phase D — Evidence & Policy](#7-phase-d--evidence--policy)
8. [Phase E — Shadow Pipeline & Compaction](#8-phase-e--shadow-pipeline--compaction)
9. [Phase F — Bot Interface](#9-phase-f--bot-interface)
10. [API Reference](#10-api-reference)
11. [Configuration](#11-configuration)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Quick Start

```bash
# Install
npm install phoenix-vcs

# Run the interactive demo
npx tsx demo.ts

# Run tests
npm test
```

### Minimal Example

```typescript
import {
  parseSpec, extractCanonicalNodes, planIUs,
  generateIU, diffClauses, classifyChanges,
} from 'phoenix-vcs';

// Parse a spec
const clauses = parseSpec(specContent, 'spec/auth.md');

// Canonicalize
const canonNodes = extractCanonicalNodes(clauses);

// Plan Implementation Units
const ius = planIUs(canonNodes, clauses);

// Generate code
const result = generateIU(ius[0]);
// result.files → Map<path, content>
// result.manifest → IUManifest with content hashes
```

---

## 2. Core Concepts

### Content Addressing

Every object in Phoenix (clause, canonical node, IU, evidence record) is identified by a SHA-256 hash of its content. If the content changes, the ID changes. If it doesn't, the ID is stable. This gives us:

- **Deduplication** — identical content is stored once
- **Integrity** — any tampering changes the hash
- **Reproducibility** — the rule-based stages are deterministic (same input → same output). LLM-assisted stages (canonicalization, clustering, code generation) are not byte-deterministic; instead each generation records its model id, true promptpack hash, and toolchain version in the provenance journal, so the run is reproducible *from its record* and gated by durable evaluations.

Two identity layers work together: **canon_id** is content-addressed (changes on any edit — the content version), while **canon_anchor** is the stable identity (type + domain tags — survives rewording), which is what makes canonical stability measurable and selective invalidation precise.

### Selective Invalidation

Phoenix's defining capability. When a spec changes, Phoenix traces the impact through:

```
Spec line → Clause → Canonical Nodes → IUs → Generated Files → Evidence → Dependents
```

Only the affected subtree is invalidated and regenerated. Everything else stays untouched.

### Trust Surface

`phoenix status` is the primary UX. If it's trustworthy, Phoenix works. If it's noisy or wrong, the system dies. Every design decision optimizes for status being **explainable, conservative, and correct-enough to rely on.**

### Bootstrap States

Phoenix tracks system maturity through three states:

| State | Meaning | D-Rate Alarms | Severity |
|-------|---------|--------------|----------|
| `BOOTSTRAP_COLD` | First parse, no canonical graph | Suppressed | N/A |
| `BOOTSTRAP_WARMING` | Canonical graph exists, stabilizing | Active | Downgraded |
| `STEADY_STATE` | D-rate acceptable, system trusted | Active | Normal |

---

## 3. The Five Graphs

Phoenix maintains five interconnected, content-addressed graphs:

### 3.1 Spec Graph

Clauses extracted from Markdown spec documents. Each clause is a heading + body section.

```
clause_id → { source_doc_id, source_line_range, raw_text, normalized_text,
              section_path, clause_semhash, context_semhash_cold }
```

### 3.2 Canonical Graph

Structured requirements extracted from clauses: Requirements, Constraints, Invariants, Definitions.

```
canon_id → { type, statement, source_clause_ids, linked_canon_ids, tags }
```

### 3.3 Implementation Graph

Implementation Units — stable compilation boundaries mapping requirements to generated code.

```
iu_id → { kind, name, risk_tier, contract, source_canon_ids, dependencies,
           boundary_policy, evidence_policy, output_files }
```

### 3.4 Evidence Graph

Proof that generated code meets its risk-tier requirements: test results, analysis reports, human signoffs.

```
evidence_id → { kind, status, iu_id, canon_ids, artifact_hash, message }
```

### 3.5 Provenance Graph

All transformation edges connecting the above. Every extraction, generation, and validation produces a provenance edge that records what was done, when, by what tool, with what input.

---

## 4. Phase A — Spec Ingestion

### Clause Extraction

Phoenix splits Markdown documents on heading boundaries. Each heading + its body = one clause.

```typescript
import { parseSpec } from 'phoenix-vcs';

const clauses = parseSpec(markdownContent, 'spec/auth.md');
// Returns: Clause[]
```

**Section paths** track heading hierarchy: `["Authentication Service", "API Endpoints", "POST /auth/login"]`

**Pre-heading content** is captured as a `(preamble)` clause.

### Normalization

Before hashing, text is normalized to eliminate formatting noise:

- Heading markers (`##`) removed
- Bold/italic/code markers removed
- Lowercased
- Whitespace collapsed
- **List items sorted alphabetically** — reordering bullets doesn't change the hash
- Code blocks replaced with `(code block)` placeholder

### Semantic Hashing

Two hashes per clause:

| Hash | Formula | Purpose |
|------|---------|---------|
| `clause_semhash` | `SHA-256(normalized_text)` | Pure content identity |
| `context_semhash_cold` | `SHA-256(text + section_path + neighbor_hashes)` | Structural awareness |

### Diffing

```typescript
import { diffClauses } from 'phoenix-vcs';

const diffs = diffClauses(oldClauses, newClauses);
// Each diff: { diff_type: UNCHANGED|MODIFIED|ADDED|REMOVED|MOVED, ... }
```

### Persistence

```typescript
import { SpecStore } from 'phoenix-vcs';

const store = new SpecStore('.phoenix');
const result = store.ingestDocument('spec/auth.md', projectRoot);
const clauses = store.getClauses('spec/auth.md');
```

---

## 5. Phase B — Canonicalization

### Canonical Node Extraction

Phoenix scans each clause for semantic patterns:

| Pattern | Type |
|---------|------|
| "must", "shall", "required" | REQUIREMENT |
| "must not", "forbidden", "limited to" | CONSTRAINT |
| "always", "never" | INVARIANT |
| ": ", "is defined as" | DEFINITION |

Heading context also applies: lines under "## Security Constraints" are classified as constraints.

```typescript
import { extractCanonicalNodes } from 'phoenix-vcs';

const canonNodes = extractCanonicalNodes(clauses);
```

### Term-Based Linking

Nodes sharing ≥2 significant terms are automatically linked, forming a requirements graph.

### Warm Context Hashing

After canonicalization, `context_semhash_warm` incorporates canonical graph context:

```typescript
import { computeWarmHashes } from 'phoenix-vcs';

const warmHashes = computeWarmHashes(clauses, canonNodes);
// Map<clause_id, warm_hash>
```

### A/B/C/D Change Classification

Every clause diff is classified using multiple signals:

| Class | Meaning | Signals |
|-------|---------|---------|
| **A** | Trivial | No semhash change, formatting only |
| **B** | Local Semantic | Content changed, limited blast radius |
| **C** | Contextual Shift | Canonical graph affected, structural context shifted |
| **D** | Uncertain | Classifier can't decide — needs human review |

```typescript
import { classifyChanges } from 'phoenix-vcs';

const classifications = classifyChanges(diffs, canonBefore, canonAfter, warmBefore, warmAfter);
```

### D-Rate Tracking

The rate of D-class (uncertain) classifications is tracked over a rolling window:

| Level | Rate | Action |
|-------|------|--------|
| TARGET | ≤5% | Normal operation |
| ACCEPTABLE | ≤10% | Monitor |
| WARNING | ≤15% | Tune classifier |
| ALARM | >15% | Override friction increases |

---

## 6. Phase C — Implementation Units

### IU Planning

```typescript
import { planIUs } from 'phoenix-vcs';

const ius = planIUs(canonNodes, clauses);
```

Groups canonical nodes into module-level IUs by:
- Shared source clauses
- Term-based linking
- Transitive graph connectivity

Each IU gets a risk tier, contract, boundary policy, and evidence policy.

### Code Generation

```typescript
import { generateIU } from 'phoenix-vcs';

const result = generateIU(iu);
// result.files: Map<path, content>
// result.manifest: IUManifest
```

### Drift Detection

```typescript
import { detectDrift } from 'phoenix-vcs';

const report = detectDrift(manifest, projectRoot, waivers);
// report.entries: DriftEntry[] with CLEAN|DRIFTED|WAIVED|MISSING status
```

Manual edits must be labeled:
- `promote_to_requirement` — edit becomes a new spec clause
- `waiver` — signed exception
- `temporary_patch` — expires on a date

### Boundary Validation

Each IU declares what it's allowed to touch:

```yaml
boundary_policy:
  code:
    allowed_packages: [express, bcrypt]
    forbidden_packages: [axios]
    forbidden_paths: [./internal/**]
  side_channels:
    config: [DATABASE_URL]
    databases: []
    external_apis: []
```

```typescript
import { extractDependencies, validateBoundary } from 'phoenix-vcs';

const depGraph = extractDependencies(sourceCode, filePath);
const diagnostics = validateBoundary(depGraph, iu);
```

---

## 7. Phase D — Evidence & Policy

### Policy Evaluation

```typescript
import { evaluatePolicy } from 'phoenix-vcs';

const evaluation = evaluatePolicy(iu, evidenceRecords);
// evaluation.verdict: 'PASS' | 'FAIL' | 'INCOMPLETE'
```

### Evidence Kinds

| Kind | Risk Tiers |
|------|-----------|
| typecheck | All |
| lint | All |
| boundary_validation | All |
| unit_tests | Medium+ |
| property_tests | High+ |
| static_analysis | High+ |
| threat_note | High+ |
| human_signoff | Critical |

### Cascading Failures

```typescript
import { computeCascade } from 'phoenix-vcs';

const events = computeCascade(evaluations, ius);
// Produces BLOCK actions on failed IUs
// Produces RE_VALIDATE actions on dependents
```

---

## 8. Phase E — Shadow Pipeline & Compaction

### Shadow Pipeline

Safe canonicalization upgrades by running old and new pipelines in parallel:

```typescript
import { runShadowPipeline } from 'phoenix-vcs';

const result = runShadowPipeline(oldConfig, newConfig, oldNodes, newNodes);
// result.classification: SAFE | COMPACTION_EVENT | REJECT
// result.metrics: { node_change_pct, orphan_nodes, risk_escalations, ... }
```

### Compaction

```typescript
import { runCompaction, shouldTriggerCompaction } from 'phoenix-vcs';

const { trigger, reason } = shouldTriggerCompaction(storageStats);
if (trigger) {
  const event = runCompaction(objects, reason);
  // event.preserved: { node_headers, provenance_edges, approvals, signatures }
}
```

**Never deleted:** node headers, provenance edges, approvals, signatures.

---

## 9. Phase F — Bot Interface

### Command Grammar

```
BotName: action [key=value ...]
```

### Available Commands

| Bot | Command | Mutating | Description |
|-----|---------|----------|-------------|
| SpecBot | ingest | ✓ | Ingest a spec document |
| SpecBot | diff | | Show clause diff |
| SpecBot | clauses | | List clauses |
| ImplBot | plan | ✓ | Plan IUs from canonical graph |
| ImplBot | regen | ✓ | Regenerate code for an IU |
| ImplBot | drift | | Check drift status |
| PolicyBot | status | | Show trust dashboard |
| PolicyBot | evidence | | Show evidence for an IU |
| PolicyBot | cascade | | Show cascade effects |
| PolicyBot | evaluate | | Evaluate policy for an IU |

### Confirmation Model

Mutating commands require confirmation:

```
> SpecBot: ingest spec/auth.md

SpecBot wants to: Ingest spec document: spec/auth.md
Reply 'ok' or 'phx confirm a1b2c3d4e5f6' to proceed.

> ok
```

Read-only commands execute immediately.

```typescript
import { parseCommand, routeCommand } from 'phoenix-vcs';

const cmd = parseCommand('PolicyBot: status');
const response = routeCommand(cmd);
```

---

## 10. API Reference

### Core Functions

| Function | Input | Output |
|----------|-------|--------|
| `parseSpec(content, docId)` | Markdown string | `Clause[]` |
| `normalizeText(raw)` | Raw text | Normalized string |
| `diffClauses(before, after)` | Two clause arrays | `ClauseDiff[]` |
| `extractCanonicalNodes(clauses)` | Clause array | `CanonicalNode[]` |
| `computeWarmHashes(clauses, nodes)` | Clauses + canon | `Map<string, string>` |
| `classifyChanges(diffs, ...)` | Diffs + context | `ChangeClassification[]` |
| `planIUs(nodes, clauses)` | Canon + clauses | `ImplementationUnit[]` |
| `generateIU(iu)` | Single IU | `RegenResult` |
| `detectDrift(manifest, root)` | Manifest + path | `DriftReport` |
| `extractDependencies(source, path)` | Source code | `DependencyGraph` |
| `validateBoundary(graph, iu)` | Deps + IU | `Diagnostic[]` |
| `evaluatePolicy(iu, evidence)` | IU + records | `PolicyEvaluation` |
| `computeCascade(evals, ius)` | Evals + IUs | `CascadeEvent[]` |
| `runShadowPipeline(old, new, ...)` | Configs + nodes | `ShadowResult` |
| `runCompaction(objects, trigger)` | Objects + trigger | `CompactionEvent` |
| `parseCommand(raw)` | String | `BotCommand` |
| `routeCommand(cmd)` | BotCommand | `BotResponse` |

### Stores

| Store | Purpose |
|-------|---------|
| `ContentStore` | Content-addressed object storage |
| `SpecStore` | Spec graph persistence |
| `CanonicalStore` | Canonical graph persistence |
| `EvidenceStore` | Evidence record persistence |
| `ManifestManager` | Generated file manifest |

---

## 11. Configuration

### `.phoenix/` Directory Structure

```
.phoenix/
  store/objects/          # Content-addressed objects
  graphs/
    spec.json             # Spec graph index
    canonical.json        # Canonical graph index
    evidence.json         # Evidence records
  manifests/
    generated_manifest.json
  state.json              # Bootstrap state
```

### Risk Tier Evidence Requirements

| Tier | Required Evidence |
|------|------------------|
| Low | typecheck, lint, boundary_validation |
| Medium | + unit_tests |
| High | + property_tests, static_analysis, threat_note |
| Critical | + human_signoff |

---

## 12. Troubleshooting

### "DRIFT DETECTED" on phoenix status

A generated file was modified directly. Options:
1. **Revert** the manual edit and let Phoenix regenerate
2. **Promote** the edit to a requirement: `promote_to_requirement`
3. **Waive** with justification: `waiver` (requires signing)
4. **Patch** temporarily: `temporary_patch` (set expiry date)

### High D-Rate (>15%)

The classifier is uncertain about too many changes. Options:
1. Write more specific spec language (avoid ambiguity)
2. Review D-class changes and provide feedback
3. Check if a canonicalization pipeline upgrade is needed

### Boundary Violation Errors

An IU's code imports something not allowed by its boundary policy. Options:
1. Remove the import
2. Update the boundary policy to allow it (and document why)
3. Move the functionality to an IU that's allowed to use that dependency

### Cascade BLOCK

An upstream IU failed evidence. Options:
1. Fix the failing evidence (e.g., fix the type error)
2. Check if the evidence is stale and re-run
3. All downstream IUs are blocked until the upstream is fixed

---

*Phoenix VCS — Trust > Cleverness*
