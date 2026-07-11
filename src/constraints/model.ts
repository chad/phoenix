/**
 * Structured constraints — the first shape family of the SHACL spine.
 *
 * Slice 1 is deliberately ONE kind (`Bound`) and ONE target form (`AttributeRef`).
 * A constraint is (binding, assertion): what it is about, and what must hold. The
 * binding is a typed, resolvable reference into the canonical/IU graph — an
 * unresolvable binding is the §1 failure ("habit name" mis-extracted as "line")
 * and is surfaced as a defect at canonicalization time, before codegen.
 */

export interface AttributeRef {
  entity: string;      // an IU / domain entity, e.g. "habit"
  attribute: string;   // one of its attributes, e.g. "name"
}

export type BoundOp = '<=' | '>=';

export interface BoundAssertion {
  kind: 'bound';
  op: BoundOp;
  value: number;
  /** e.g. "chars" for a string-length bound; undefined for a plain numeric bound. */
  unit?: string;
}

/** An enum / value-set constraint: "cadence must be one of daily, weekly". */
export interface MembershipAssertion {
  kind: 'membership';
  values: string[];
}

/** A format / regex constraint: "email must be a valid email address". */
export interface PatternAssertion {
  kind: 'pattern';
  /** A named format when recognized (email, url, uuid, date), else 'regex'. */
  format: 'email' | 'url' | 'uuid' | 'date' | 'regex';
  /** The raw regex when format === 'regex'. */
  regex?: string;
}

/** A uniqueness constraint: "a customer email must be unique". */
export interface UniquenessAssertion {
  kind: 'uniqueness';
}

/**
 * A referential-integrity constraint: "a transaction must reference an existing
 * account". The `target` is the referenced entity (singular); enforcement is a
 * foreign-key declaration or an existence guard against the target's table.
 */
export interface ReferenceAssertion {
  kind: 'reference';
  target: string;
}

/**
 * A cardinality constraint on a relation: "an order must have at least one line
 * item" (min 1), "at most 3 tags" (max 3). `relation` is the related thing's head
 * noun (singular); enforcement is a non-empty / count guard on the collection.
 */
export interface CardinalityAssertion {
  kind: 'cardinality';
  min?: number;
  max?: number;
  relation: string;
}

/**
 * A relational / conditional invariant that is NOT a single-field shape — e.g.
 * "reject a cleared debit that would take an account balance below zero" or "if
 * shipped then shipped_at is set". These cannot be decided by a single-attribute
 * static check; they route to the executable oracle path (checkProperty), which
 * returns a real verdict when it can reduce the statement and ABSTAINS otherwise —
 * it never false-greens. `statement` carries the normative sentence verbatim.
 */
export interface ExprAssertion {
  kind: 'expr';
  statement: string;
}

/** The (growing) closed assertion algebra — see docs/DESIGN-shacl-spine.md §4. */
export type Assertion =
  | BoundAssertion
  | MembershipAssertion
  | PatternAssertion
  | UniquenessAssertion
  | ReferenceAssertion
  | CardinalityAssertion
  | ExprAssertion;

export interface ConstraintSource {
  canon_id?: string;
  doc?: string;
  line?: number;
  statement: string;
}

export interface StructuredConstraint {
  constraint_id: string;
  binding: AttributeRef;
  assertion: Assertion;
  source: ConstraintSource;
}

/**
 * A constraint whose subject could not be bound to a known entity.attribute. This is
 * exactly the §1 mechanism: the requirement graph named a subject the graph does not
 * contain. Reported as an ERROR before any code is generated.
 */
export interface BindingDefect {
  subject: string;               // the unresolved subject phrase
  assertion: Assertion;
  source: ConstraintSource;
  reason: string;
}
