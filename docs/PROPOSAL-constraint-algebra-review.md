# Expert Review: "A Constraint Algebra for Phoenix"

Reviewer persona: knowledge representation / formal epistemology / semantic-graph validation.
Reviewing: docs/PROPOSAL-constraint-algebra.md

**Bottom line:** the pipeline is the invention; the algebra is a rediscovery. Adopt SHACL's
semantics and OCL's decidable-fragment guidance by name, delete Open Question #2 as already
answered, and redirect the novelty budget to the three things that are actually hard and
actually Phoenix's: extracting correct structure from prose, lowering it to real enforcement
code, and a trust surface that is a *total* function from (method × result) to a verdict where
green is earned, never defaulted.

## Prior art the proposal re-derives (adopt/align)
- **SHACL** (W3C Rec, 2017) is the near-structural twin: binding = targets/focus nodes;
  assertion kinds = Core constraint components; `Opaque` = SHACL-SPARQL escape;
  three-obligations = `sh:parameter` + `sh:validator` + `sh:severity`; grow-new-kinds =
  user-defined constraint components. SHACL exists precisely to be the closed-world VALIDATION
  counterpart to OWL/RDFS open-world INFERENCE — which answers Open Q#2 outright.
- **Integrity-constraint theory:** the SQL-shaped kinds (Bound/Membership/Presence/Uniqueness/
  Cardinality/Reference) are SQL CHECK/IN/NOT NULL/UNIQUE/multiplicity/FK. Reiter ("On Closed
  World Data Bases" 1978; "On Integrity Constraints" 1988) + Levesque (KFOPCE 1984): integrity
  constraints are *epistemic* — about what the KB must know — which is exactly the
  representation-vs-enforcement split; dissolves Q2.
- **OCL** — §5 algebra ≈ OCL invariants; `Expr` ≈ OCL navigation+collection ops; Q1 ("how
  underpowered should Expr be") is the OCL decidability question with a known decidable fragment.
- **JML** — "one spec, two consumers" (runtime assertion checking + static verification) is
  exactly the §6 lowering+checker dual-use.
- **Newell, "The Knowledge Level" (1982)** — representation (knowledge level) vs enforcement
  (symbol level); the right vocabulary for N1/N2.
- **RDF-star / reification** — `Constraint = (binding, assertion, assurance) + provenance` is a
  reified statement with statement-level metadata.
- **EARS** (Mavin, RE'09) and **Attempto Controlled English** — precedent + recall-cue taxonomy
  for the §8 extractor; LLM NL→spec work reports the "silent failure" mode = our §1.

## Genuinely novel / Phoenix's to keep
1. Deterministic **lowering to generated code** (SHACL/OCL validate; they don't generate enforcement).
2. A **trust surface with a never-false-green invariant** tied to verification *method*, incl.
   "statically-checkable but ABSENT ⇒ ERROR" and a **recall/coverage** signal — outside SHACL's world.
3. **NL-extraction-as-classification** with binding-resolution + recall guards (SHACL assumes you
   already have shapes; deriving them from non-expert prose is the hard problem).
4. **`Opaque` population as a backlog metric; recurring `Opaque` earns promotion to a kind** — a
   data-driven grammar-growth governance loop SHACL/OCL lack.

## Verdicts on the open questions
- **Q2 (closed enforcement + open recall):** sound layering, not a contradiction — it's the
  SHACL/OWL split + epistemic ICs. But keep TWO signals: *conformance* (closed, over captured
  constraints) and *coverage confidence* (open); collapsing them re-admits a false green.
- **Q3 (`Opaque` + eval honest?):** it RELOCATES the problem to exactly where §1 failed (a
  term-matching eval). Honest only with a validity criterion: **the eval must fail under a
  mutation that violates the stated property** — wire the existing phase-7 fault-injection
  meta-eval as a hard gate; else the constraint is INCOMPLETE, never green. (Metamorphic/mutation
  testing: Chen 1998; DeMillo–Lipton–Sayward 1978.)
- **Q4 (binding circular?):** partially. Binding-resolution buys **referential integrity**
  (catches §1's dangling `line` ref) but NOT semantic correctness (a confident mis-bind to
  `Habit.title` resolves fine). Add **round-trip verbalization** (structured → NL, diff vs source
  clause, human-confirm on mismatch; cf. ACE OWL verbaliser).
- **Q5 (assurance ladder):** category error — you merged **method** (static|property|behavioral|
  live|manual) with **result** (satisfied|violated|indeterminate|absent). Make §7 a TOTAL function
  over method × result with OK an explicitly enumerated rare cell. Missing cells that leak greens:
  property/behavioral FAILING → ERROR; static INDETERMINATE → INCOMPLETE; unsigned/expired manual
  → INCOMPLETE; Operational is statistical → error-budget, not boolean.

## Algebra fixes (§5)
- **Add `Pattern`/`Format`** (regex) — glaring omission given the Zod lowering target; lowers
  deterministically, statically checkable.
- **Move `immutable` out of `Presence`** — it's a transition constraint over (old,new), not a
  state predicate; belongs with `Lifecycle`.
- **Split `Temporal`** — clock-comparison ("not in future") vs windowed-rate ("N per window") have
  different verification stories.
- **`Presence` ⊆ `Cardinality`** (multiplicity 0..0/0..1/1..1); `Membership`/`Bound(==)` overlap —
  collapse or justify on lowering-ergonomics.
- **`Operational` breaks the boolean-checker contract** — statistical/SLO; route to error-budget.
- **Pin `Expr` to a named decidable fragment:** quantifier-free linear arithmetic (QF-LIA) +
  bounded quantification over an entity's own relations; no recursion; arithmetic-under-quantifier
  lowers to a property test, never a static claim. The danger is arithmetic under quantifiers, not
  quantifiers per se.

## Steelman "you're building a worse OCL/SHACL"
Holds for **representation/semantics** (surrender gracefully — adopt SHACL's frame). Fails for the
**system**: (1) codegen-lowering, (2) recall metric + absent⇒ERROR, (3) NL-extraction pipeline,
(4) app-model (not RDF-triple) substrate — none exist in SHACL/OCL. Verdict: a scoping
instruction, not a refutation. **Steal the representation, own the pipeline.** Reposition as:
"a SHACL-Core-equivalent vocabulary + an OCL-decidable-fragment expression language — adopted, not
invented — wrapped in a novel NL-extraction, deterministic-code-lowering, and assurance-tracking
pipeline neither standard provides."

## Key references
- SHACL — W3C Rec 2017 — https://www.w3.org/TR/shacl/ ; SHACL-AF — https://w3c.github.io/shacl/shacl-af/ ; "SHACL and OWL Compared" — https://spinrdf.org/shacl-and-owl.html
- Reiter, "On Closed World Data Bases" (1978); "On Integrity Constraints" (TARK 1988). Levesque KFOPCE (1984).
- Newell, "The Knowledge Level," Artificial Intelligence 18(1):87–127, 1982.
- Cabot & Gogolla, "OCL: A Definitive Guide" (SFM 2012); OMG OCL 2.4.
- Leavens et al., JML + RAC/verification (FMCO 2003).
- Mavin et al., EARS (RE'09). Fuchs & Schwitter, Attempto Controlled English.
- RDF-star (W3C) for statement-level provenance/assurance.
- Alloy (Jackson, Software Abstractions); TLA+ (Lamport) for the verification-strength ladder.
- Metamorphic testing (Chen 1998); mutation testing (DeMillo–Lipton–Sayward 1978) for the Opaque-eval gate.
