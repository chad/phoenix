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

/**
 * A temporal constraint on a date-like attribute: "a transaction date must not
 * occur in the future". Enforcement is a validator comparing the value against
 * now/today (e.g. a `.refine(isNotFuture, …)` on the field).
 */
export interface TemporalAssertion {
  kind: 'temporal';
  mode: 'not-future' | 'not-past';
}

/**
 * A relative-temporal state invariant: a state TRANSITION that must happen a fixed
 * offset of time after an anchor event — "an account must be archived 90 days after
 * its last transaction", "a record retires 90 days after the last entry". Unlike the
 * absolute TemporalAssertion (a field must not be in the future), this governs a
 * derived state that flips at an elapsed-time boundary, so it can only be PROVEN by
 * advancing a clock in the live harness (seed an aged record, set NOW past the
 * boundary, assert the transition) — the static path abstains. `offsetDays` is the
 * boundary, `anchorEvent` the verbatim anchor phrase, `targetState` the state word.
 */
export interface TemporalRelativeAssertion {
  kind: 'temporal-relative';
  offsetDays: number;
  anchorEvent: string;
  targetState: string;
}

/**
 * A required-field (presence) constraint, from the quantifier-free "at least"
 * form: "provide at least a name and an email". Each named field must exist in
 * the input schema and must NOT be optional/nullish. The parser returns the field
 * list in `fields`; extraction emits ONE constraint per resolved field, so a
 * bound PresenceAssertion governs exactly its binding's attribute.
 */
export interface PresenceAssertion {
  kind: 'presence';
  /** Transient (parser → extraction): the fields named by the sentence. */
  fields?: string[];
}

/** The (growing) closed assertion algebra — see docs/DESIGN-shacl-spine.md §4. */
export type Assertion =
  | BoundAssertion
  | MembershipAssertion
  | PatternAssertion
  | UniquenessAssertion
  | ReferenceAssertion
  | CardinalityAssertion
  | ExprAssertion
  | TemporalAssertion
  | TemporalRelativeAssertion
  | PresenceAssertion;

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
