# Design Note: SHACL as Phoenix's Conceptual Spine

**Status:** Draft for expert review
**Supersedes framing of:** `PROPOSAL-constraint-algebra.md` (now recast as the *first shape family*)
**Incorporates:** `PROPOSAL-constraint-algebra-review.md` (KR/epistemology review)

---

## 0. Thesis

Phoenix is already a semantic-graph system that has not named itself as one: five typed,
content-addressed graphs (Spec, Canonical, Implementation, Evidence, Provenance), typed edges,
and a collection of bespoke "walk the graph and report problems" subsystems (boundary validator,
drift detector, evidence/policy engine, cascade, D-rate, invalidation). **SHACL** (W3C Shapes
Constraint Language) is the mature, standardized vocabulary for exactly this: shapes that target
nodes and report structured, severity-tagged results.

We **adopt SHACL's semantics and vocabulary, not its substrate.** Phoenix stays app-model-shaped
(entities/attributes/relations/IUs), not an RDF triple store — the JSON-Schema-vs-SHACL
impedance is real and our data is tree/record-shaped. This is the review's *"steal the
representation, own the pipeline,"* generalized from constraints to the whole system:

> Converge on **semantics** (shapes, targets, paths, focus nodes, constraint components,
> validation reports, severity, the closed-validation/open-inference split); diverge on
> **serialization** (no RDF; our own typed store).

## 1. Concept map (SHACL → Phoenix's five graphs)

| SHACL concept | Phoenix realization (today, un-named) | What adoption buys |
|---|---|---|
| **Shape** — named expectations over a class of nodes | An implicit, in-code schema for CanonicalNode / IU / EvidenceRecord | A declarative, validatable schema for our *own* graph |
| **Target** — how a shape selects its nodes | The proposal's `binding`; also boundary-policy scope, evidence-policy scope, classifier fire conditions | One selection language for "which nodes does this rule apply to" |
| **Property path** — sequence / inverse / `*` navigation | `phoenix why` (clause→canon→IU→file, + inverse); selective invalidation (dependent subtree = reachability) | Declarative traversal instead of five hand-rolled walks |
| **Validation report** — {focus node, value, source shape, source component, severity, message} | `Diagnostic` {severity, category, subject, message} — a weaker ad-hoc version | A first-class, queryable, diffable result model (§3) |
| **Constraint component** — params + validator + severity | boundary/drift/evidence/cascade/D-rate — five bespoke validators | One component model → conceptual-mass reduction |
| **Severity** — Violation / Warning / Info | error / warning / info, hardcoded in emitters | Severity as a *declared property of the shape* |
| **Closed shape** (`sh:closed`) | boundary policy's `forbidden`/`allowed_ius` | A principled place to say "dependencies are closed" |
| **SHACL rules (SHACL-AF)** — infer new triples | derived views (streak/rollups/dashboard); canon edge inference | "asserted vs derived" — matters for invalidation & provenance |
| **RDF-star / reified statement** — statement-level metadata | the provenance journal; the `assurance` field | Statement-level provenance/assurance as a first-class model |

## 2. Non-goals

- **N1. Not RDF.** No triple store, no SPARQL engine, no `.ttl`. Semantics only.
- **N2. Not universal deterministic enforcement.** *Totality of representation, growth of
  enforcement* (Newell's knowledge-level vs symbol-level). Arbitrary semantics are undecidable.
- **N3. Not a big-bang rewrite.** Phased (§6); each phase stands alone.
- **N4. SHACL is a frame, not a solution.** It does nothing for the genuinely hard Phoenix
  problems — extracting structure from prose, deterministic codegen lowering, recall. It gives a
  clean, standard structure to the parts that are graph-validation-shaped.

## 3. The unifying primitive: `Shape` + `ValidationResult`

The highest-leverage single move. Every checking subsystem becomes a **Shape** that emits
**ValidationResult**s; `phoenix status` becomes a fold of shapes over the graphs → one report.

```ts
interface Shape {
  shape_id: string;
  target: Target;                 // which nodes this applies to (§4 binding is one Target form)
  component: string;              // the constraint-component kind (e.g. 'bound', 'boundary', 'drift')
  params: Record<string, unknown>;
  severity: 'violation' | 'warning' | 'info';
  message: string;                // template
}

interface ValidationResult {
  focus: Ref;                     // the node/artifact validated (SHACL sh:focusNode)
  path?: string;                  // which property of the focus failed (SHACL sh:resultPath) — kept separate from focus
  value?: unknown;               // the offending value, when applicable (sh:value)
  source_shape: string;
  source_component: string;
  result: 'conforms' | 'violates' | 'indeterminate' | 'absent';
  method: 'static' | 'property' | 'behavioral' | 'live' | 'manual';
  severity: 'violation' | 'warning' | 'info';
  message: string;
  recommended_actions: string[];  // carried over from Diagnostic — the trust surface must still say what to do
  provenance?: { source_doc?: string; line?: number };
}
```

Note on fidelity (per review): this is a **check-outcome record**, not literally `sh:ValidationResult`
— SHACL results *only ever denote non-conformance* and surface conformance as the report-level
`sh:conforms` boolean. We deliberately diverge (one record carries conforms/violates/indeterminate/
absent) to serve the total-function goal (§7). Also note the graphs differ: SHACL validates
DATA↔SHAPE over triples; Phoenix validates SPEC↔CODE, so `focus`/`path` mean "which schema element,"
not "which data triple."

`Diagnostic` becomes a rendering of `ValidationResult` (keeping `recommended_actions`). Every status
line is traceable to the shape and focus node that produced it.

**Crucial correction (review):** a SHACL-style report closes only **conformance** — "no violation
result ⇒ `sh:conforms`" — which *cannot* cover §1, because a missing constraint yields *zero
results* and thus a false green. So never-false-green is **not** a property of the report alone. It
requires the fold to treat *expected-and-selected-but-absent* enforcement as a first-class ERROR
input (§7), plus the separate open-world **coverage** signal for "constraints we may have missed."
Report closes conformance; fold + absence + coverage closes green.

## 4. First shape family: the Constraint Algebra (v2)

The `PROPOSAL-constraint-algebra.md` algebra, **recast as a shape family and corrected per the
review**. Explicitly: this is a **SHACL-Core-equivalent constraint vocabulary + an
OCL-decidable-fragment expression language — adopted, not invented.**

**Atom:** `Constraint = (binding, assertion, assurance)`.

**Binding** — a `Target`/`Ref` into the canonical/IU graph (SHACL focus node + OCL context). Two
guards, addressing the review's Q4:
- *Referential integrity* — every Ref must resolve, or it is a canonicalization-time defect.
  (Catches the §1 dangling `line` ref — the actual failure mechanism.)
- *Round-trip verbalization* — render the structured constraint back to NL and diff it against the
  source clause; surface mismatches for human confirmation. (Catches *confident mis-binding* —
  `Habit.title` when the user meant `Habit.name` — which resolves fine and would otherwise pass.)

**Assertion algebra** (revised; SHACL component ≈ noted):

| Kind | Payload | Static? | SHACL/SQL analogue |
|---|---|---|---|
| `Bound` | field, op, value, unit | ✔ static | `sh:minInclusive`/`maxInclusive`, `sh:minLength`/`maxLength`; SQL CHECK |
| `Pattern` *(added)* | field, regex, flags | ✔ static | `sh:pattern`; Zod `.regex`; SQL `~` |
| `Membership` | field, set | ✔ static | `sh:in`; SQL `IN` / enum |
| `Cardinality` | relation, op, n | ✔ static | `sh:minCount`/`maxCount` |
| `Presence` | field, required\|forbidden\|optional | ✔ static | degenerate `Cardinality` (0..0/0..1/1..1) — kept for lowering ergonomics, documented as such |
| `Uniqueness` | fields, scope | ✔ static (DB) | SQL `UNIQUE` |
| `Reference` | field → entity, on_missing | ✔ static / behavioral | SQL `FOREIGN KEY`; `sh:node` |
| `Transition` *(was `immutable`)* | field, from→to rule | behavioral | (no SHACL core; a state-machine constraint) |
| `Clock` *(Temporal, split)* | field, op, now-relative | behavioral | comparison against clock |
| `RateLimit` *(Temporal, split)* | quantity, window, op, value | behavioral / live | windowed aggregate |
| `Invariant` | `Expr` (see fragment) | static / property | OCL invariant |
| `Operational` | metric, op, value, scope | **live (statistical)** | SLO / error-budget — breaks the boolean checker; own verdict |
| `Opaque` | statement, **required_eval** | per eval | SHACL-SPARQL escape |

**`Expr` fragment** (review Q1, pinned): quantifier-free **linear** arithmetic (QF-LIA,
SMT-decidable) + boolean ops + `Implies` + **bounded** quantification over an entity's *own*
relations. **No recursion/fixpoint. No arithmetic under quantifiers as a static claim** (that
lowers to a property test). The danger is arithmetic-under-quantifiers, not quantifiers per se.
New kinds are grown *empirically*: a recurring `Opaque` earns promotion into a first-class kind,
versioned via `extraction_rules_version`. The `Opaque` population is a backlog metric.

**Three obligations per kind** (the JML "one spec, two consumers" design — enforce + verify):
1. `lowering(assertion, target)` → enforcement artifact (Zod / DB constraint / guard). *Phoenix's
   own contribution — SHACL/OCL validate, they do not generate enforcement.*
2. `checker(assertion, artifact)` → `conforms | violates | indeterminate`, prefer static.
3. `verification_level`.

**`Opaque` honesty gate** (review Q3, decisive): an `Opaque` eval is OK-eligible **only if it fails
under a mutation that violates its stated property**. **This is a new build** (mutation/metamorphic
testing at the *per-eval* level), only *patterned on* the Phase-7 approach — the existing Phase-7
harness injects **status-level** faults (drift/missing/forbidden/stale), not per-eval property
mutations, so it is not a wire-up. Until that harness exists, every `Opaque`/property/behavioral
`OK` cell is **unreachable and degrades to `INCOMPLETE`** — never green.

## 5. Self-validation: shapes over Phoenix's own graph

Node shapes for `CanonicalNode`, `IU`, `EvidenceRecord`, and `Constraint` turn canonicalization
quality into a validation report. The §1 mis-binding becomes a **shape violation at
canonicalization time** ("constraint references an unresolved subject") — caught before codegen,
not three layers downstream. The system that validates specs validates itself.

## 6. Phased adoption

- **Phase A — `ValidationResult` unification.** Introduce `Shape`/`ValidationResult`; make
  `Diagnostic` a rendering of it; port `status` to fold results. Highest leverage, self-contained,
  immediately hardens the trust surface. *No behavior change beyond structure + honesty.*
- **Phase B — Constraint algebra as first shape family.** Structured `Constraint` model + the
  statically-checkable kinds (`Bound`, `Pattern`, `Membership`, `Presence`, `Cardinality`,
  `Uniqueness`, `Reference`); extraction into them with the two binding guards; `lowering` +
  static `checker`; wire into `status`. **Deliverable acceptance test: the §1 `max(80)` gap is a
  hard ERROR, not a false green.**
- **Phase C — migrate existing validators** (boundary, drift, evidence, cascade) onto the
  component model. Conceptual-mass reduction; no new capability.
- **Phase D (optional) — self-validation shapes + SHACL-style rules** for derived views.

## 7. Assurance semantics — the total function (review Q5)

`status` verdict is a **total function over `method × result`**, with `OK` an explicitly
enumerated, rare cell — never a default. **`absent` is split** (review): a shape whose target did
*not* select the focus produces **no result** (not-applicable ≠ error); `absent` below means
*target-selected, statically-lowerable, but no enforcement artifact found* — the §1 cell. And a
present-but-wrong artifact (`.max(100)` when spec says `80`) is `violates`, not `absent` (requires
the checker to read the emitted literal and compare).

| method \ result | conforms | violates | absent (selected & required) | indeterminate |
|---|---|---|---|---|
| static | **OK** | ERROR | ERROR (the §1 cell) | INCOMPLETE |
| property/behavioral | INCOMPLETE¹ | ERROR | INCOMPLETE | INCOMPLETE |
| manual | **OK** (iff signed & unexpired) | ERROR | INCOMPLETE | INCOMPLETE |

¹ Unreachable-as-OK until the per-eval mutation gate exists; degrades to INCOMPLETE (see §4).
Not-applicable (target didn't select) ⇒ *no result*, never a cell here.

**`Operational` is quarantined out of this table.** An SLO is a rate-over-window, not a node
conformance; its verdict ("error-budget breach") is not commensurable with ERROR/OK. Operational
metrics render into the report as their own signal, are not shapes, and never feed the conformance
verdict.

Two independent signals are always shown, never collapsed (review Q2): **conformance** (closed-world,
over captured constraints) and **coverage confidence** (open-world, "constraints we may have missed"
— the recall metric). Collapsing them re-admits a false green.

## 8. Epistemic grounding (vocabulary we adopt)

- **SHACL/OWL split** — closed-world validation vs open-world inference (answers the old Open Q2).
- **Reiter/Levesque epistemic integrity constraints** — constraints are about what the KB must
  *know*; grounds representation-vs-enforcement.
- **Newell, "The Knowledge Level" (1982)** — knowledge level (binding+assertion) vs symbol level
  (lowering); grounds "totality of representation, growth of enforcement."
- **JML** — one spec, two consumers (RAC + static verification) = our lowering + checker.
- **OCL** — decidable-fragment guidance for `Expr`.
- **EARS / Attempto ACE** — controlled-NL intermediate + recall-cue taxonomy for extraction;
  round-trip verbalization precedent.
- **Metamorphic / mutation testing (Chen 1998; DeMillo–Lipton–Sayward 1978)** — the `Opaque` gate.

## 9. Open questions

1. Do we introduce an explicit `Shape` object users can author, or keep shapes internal
   (derived from the constraint model + hardcoded node shapes) in v1?
2. `Target` expressiveness — do we need property *paths* (multi-hop) in Phase A, or only direct
   Refs until Phase D?
3. Migration order in Phase C — which existing validator is the cleanest first port to prove the
   component model without destabilizing `status`?
4. Coverage-confidence metric — how is "constraints we may have missed" computed and displayed
   without itself becoming noise?
