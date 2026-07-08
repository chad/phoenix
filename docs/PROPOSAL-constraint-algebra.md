# Proposal: A Constraint Algebra for Phoenix

**Status:** Draft for expert review
**Author:** Phoenix working session
**Context:** Phoenix VCS compiles plain-language specs → a canonical requirement graph → Implementation Units → generated code, with selective invalidation and a trust dashboard (`phoenix status`) as the primary UX. This proposal concerns how *constraints* (the normative content of a spec) are represented in the canonical graph.

---

## 1. The motivating failure

A spec said: *"A habit name must not be empty and must not exceed 80 characters."*

- The canonicalizer emitted a `CONSTRAINT` node whose free-text statement was **"The line must not exceed 80 characters"** — it **dropped the subject** (`habit name` → `line`) and left the bound (`80`, `≤`, `chars`) trapped in prose.
- Because the constraint lost its binding to `Habit.name`, code generation never had a legible obligation to implement; the generated Zod schema enforced `min(1)` but not `max(80)`.
- The durable evaluation derived from the constraint **falsely passed** — it only checked that the module *textually referenced* the words "habit"/"name," never that a 101-char name is rejected.
- Net: `phoenix status` showed **green** on a spec constraint that the code does not honor. For a system whose thesis is *"trust > cleverness,"* a false green on the trust surface is the cardinal failure.

Root cause is **representation**, not verification: the intent was captured wrong (mis-bound, unstructured), so everything downstream inherited the error. Testing/monitoring can catch a *symptom* at runtime; they cannot fix that the source of truth was wrong.

## 2. Goals and non-goals

**Goals**
- G1. A **repeatable, machine-checkable representation** of constraints that survives rewording and is diffable/reviewable.
- G2. **Deterministic lowering** of a constraint to enforcement (schema/DB/guard) where possible — remove reliance on the LLM "noticing" prose.
- G3. **Deterministic verification** of an implementation against a constraint where possible (prefer static over behavioral over live).
- G4. **Totality of representation:** every normative clause is representable — either as a typed constraint or as an explicitly-opaque one carrying a mandatory evaluation. Nothing falls through to silent prose.
- G5. **Honest trust surface:** every constraint self-reports an *assurance level*, so `status` can never emit a false green (the §1 failure becomes a hard error).

**Non-goals**
- N1. **Not** universal deterministic enforcement. Arbitrary semantics are undecidable; we grow the enforceable fraction, we do not promise it is total.
- N2. **Not** a universal ontology of all possible constraints. The failure mode of this idea is a sprawling predicate enum or a `{type, params:{…anything}}` catch-all (prose with ceremony). The algebra is deliberately **small, closed at any version, and empirically grown.**
- N3. **Not** a general theorem prover or a Turing-complete rule language.

**Guiding distinction:** *totality of representation, growth (never completeness) of deterministic enforcement.* These are separate axes and must not be conflated.

## 3. The core atom

A constraint is a triple:

```
Constraint = (binding, assertion, assurance)
```

- **binding** — *what the constraint is about*: typed reference(s) into the canonical/IU graph (not strings).
- **assertion** — *what must hold*: a value from a closed algebra (§5), or an opaque statement + required eval.
- **assurance** — *how we know it holds, and at what cost*: a verification method + level.

Provenance (source clause + line, extraction method, pipeline version) and a stable identity are attached to every constraint (see §9).

## 4. Binding — typed references into the graph

The binding is the load-bearing generalization; §1 was fundamentally a binding failure.

```
Ref =
  | EntityRef(entity_id)                       // Habit
  | AttributeRef(entity_id, attribute)         // Habit.name
  | RelationRef(from_entity, relation, to)     // Order → lineItems
  | ActionRef(entity_id, action)               // Project.delete
  | SystemRef                                  // whole-system / cross-cutting

Binding = { primary: Ref, others?: Ref[] }
```

Invariant: **every Ref must resolve** against the current canonical/IU graph. An unresolvable ref (e.g., `line`) is a **defect surfaced at canonicalization time**, before codegen — this alone would have caught §1.

## 5. The assertion algebra

A closed, versioned tagged union. Several kinds carry a small expression sub-language; a terminal `Opaque` kind guarantees totality.

```
Assertion =
  | Bound        { field: Ref, op: <= | < | >= | > | == | !=, value: Scalar, unit?: Unit }
  | Membership   { field: Ref, set: Scalar[] }            // enums (often mined from DEFINITIONs)
  | Presence     { field: Ref, mode: required | forbidden | immutable | optional }
  | Uniqueness   { fields: Ref[], scope?: Ref }           // unique (habit, date)
  | Cardinality  { relation: RelationRef, op, n: int }    // an order has >= 1 line item
  | Reference    { field: Ref, target: EntityRef, on_missing: reject | ... }  // FK / "habit must exist"
  | Lifecycle    { action: ActionRef, when: Expr, then: allow | forbid | require }  // no delete project with tasks
  | Temporal     { field?: Ref, quantity: Expr, window: Duration, op, value }  // rate limits; "date not in future"
  | Invariant    { expr: Expr }                            // total >= 0 ; if shipped then shipped_at set
  | Operational  { metric: MetricRef, op, value, scope?: Ref }  // p95 latency < 200ms enterprise
  | Opaque       { statement: string, required_eval: EvalRef }  // escape hatch — prose + MANDATORY eval

// Small, deliberately underpowered expression sub-language (NOT Turing-complete):
Expr =
  | FieldRef(Ref)
  | Literal(Scalar)
  | Compare(Expr, op, Expr)
  | And(Expr, Expr) | Or(Expr, Expr) | Not(Expr)
  | Implies(Expr, Expr)                                   // "when P then Q"
  | Quantifier(forall|exists, over: RelationRef, Expr)    // over an entity's OWN related records only
```

`Opaque` is what makes the algebra **total**: anything that fits no structured kind is captured as prose **plus a mandatory `EvalRef`**. It is *deliberately* unstructured, never *unverified*. The population of `Opaque` constraints is itself a metric — a backlog of "constraints we cannot yet enforce deterministically."

## 6. Each kind's three obligations

A kind earns its place in the catalog only by supplying:

1. **lowering**(assertion, target) → enforcement artifact. `Bound(Habit.name, <=, 80)` → Zod `.max(80)`; `Uniqueness` → a DB UNIQUE index; `Invariant(expr)` → a validation guard. Deterministic; the target architecture owns the mapping.
2. **checker**(assertion, artifact) → `satisfied | violated | indeterminate`, preferring static analysis of the generated code/schema, falling back to a generated property/behavioral test.
3. **verification_level** ∈ `{ static, property, behavioral, live, manual }`.

`Opaque` supplies only (3) = the level implied by its eval; it has no deterministic lowering by definition.

## 7. Assurance semantics on the trust surface

Each constraint reports (method, level, last_result). `phoenix status` maps this to a diagnostic **without ever emitting a false green**:

| Situation | Verdict |
|---|---|
| statically-checkable, present & correct in code | OK |
| statically-checkable, **absent/incorrect** in code | **ERROR** ← the §1 `max(80)` case |
| behavioral/property, eval passing | OK |
| `Opaque` with a passing eval | OK |
| `Opaque` with **no** eval | INCOMPLETE |
| binding **unresolvable** | **ERROR** (the "line" case) |
| `Operational` | deferred to monitoring, labeled `live` |

## 8. Extraction

The extractor's target changes from "parse prose" to **"classify each unit of normative content into a kind, resolve its binding, fill the payload; else `Opaque` + eval."** Normative content includes DEFINITIONs (enums, value sets hide there), not only modal ("must"/"never") sentences.

Two guards convert failure from silent to visible:
- **Fidelity — binding resolution.** Every produced constraint's refs must resolve; unresolved ⇒ flagged defect (catches §1).
- **Recall — completeness pass.** A clause carrying a recognizable cue (a quantitative bound, a modal negative, "unique," "at most/at least") that yields *no* structured constraint and is *not* marked `Opaque` is a surfaced coverage gap. Recall cannot be guaranteed from NL; the design goal is **visible absence**, and the structured constraint set becomes the human-review artifact (rigor relocated to the spec/canonical layer).

## 9. Set-level properties (things prose cannot give)

- **Consistency:** over a typed set you can detect **contradiction** (`<=80` and `<=100` on `Habit.name`) and **redundancy/subsumption**.
- **Invalidation:** editing `80 → 60` is a one-field diff on one constraint, scoped to `Habit.name` — a precise, minimal invalidation, versus a fuzzy prose delta.
- **Stable identity:** a constraint's identity = `hash(kind, binding, structural-shape)`, which survives rewording of the source clause (the value/op live in fields, not prose), aligning with Phoenix's two-layer identity (stable anchor vs content hash).

## 10. Worked examples

| Spec sentence | Constraint |
|---|---|
| "a habit name must not exceed 80 characters" | `Bound(Habit.name, <=, 80, chars)` — static |
| "cadence must be one of: daily, weekly" | `Membership(Habit.cadence, [daily, weekly])` — static |
| "a habit cannot be checked in more than once on the same date" | `Uniqueness([CheckIn.habit, CheckIn.date])` — static (DB) |
| "reject a check-in for a habit that does not exist" | `Reference(CheckIn.habit → Habit, on_missing=reject)` — static/behavioral |
| "a check-in date must not be in the future" | `Temporal(CheckIn.date, op=<=, value=today)` — behavioral |
| "an order total must never be negative" | `Invariant(Order.total >= 0)` — static/property |
| "delete a project only if it contains no tasks" | `Lifecycle(Project.delete, when=count(tasks)>0, then=forbid)` — behavioral |
| "p95 latency < 200ms for enterprise traffic" | `Operational(p95_latency, <, 200ms, scope=enterprise)` — live |
| "the streak is the number of consecutive periods completed up to today" | `Opaque("streak = consecutive completed periods up to today", eval=streak_property_test)` — behavioral via eval |

## 11. Open questions for review

1. **`Invariant`/`Expr` scope.** How underpowered should the expression language start? Proposal: comparisons + boolean ops + field refs + `Implies` + quantifiers over an entity's *own* relations only; force everything richer into `Opaque`, and let recurring `Opaque` constraints *earn* promotion into new kinds (versioned via the existing `extraction_rules_version`).
2. **Open- vs closed-world.** Enforcement leans closed-world (absence of a permitting rule ⇒ forbidden); the trust dashboard's recall metric is unavoidably open-world (we cannot prove we captured every intended constraint). Is treating these two layers with different world assumptions coherent, or a latent contradiction?
3. **The `Opaque` escape.** Is "prose + mandatory eval" an honest terminal, or does it merely relocate the §1 problem into the eval (which can itself be shallow)? What discipline keeps an `Opaque` eval from being a term-matcher?
4. **Binding to a graph that is itself LLM-extracted.** Refs resolve against a canonical/IU graph produced by the same fallible pipeline. Does binding-resolution give real assurance, or circular assurance?
5. **Assurance honesty.** Is the `{static, property, behavioral, live, manual}` ladder the right typology, and does mapping it to OK/ERROR/INCOMPLETE actually prevent false greens in cases we haven't enumerated?

## Appendix: type sketch (TypeScript)

```ts
type Unit = 'chars' | 'ms' | 'count' | 'bytes' | 'percent' | /* … */ string;
type Scalar = string | number | boolean;

interface ConstraintProvenance { source_doc: string; line: number; extraction_method: 'rule'|'llm'; pipeline_version: string; }

interface Constraint {
  constraint_id: string;            // stable: hash(kind, binding, shape)
  binding: Binding;
  assertion: Assertion;             // the tagged union of §5
  assurance: { method: 'lowered'|'eval'|'monitor'|'manual'; level: 'static'|'property'|'behavioral'|'live'|'manual'; eval_ref?: string; };
  provenance: ConstraintProvenance;
}
```
