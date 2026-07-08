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

export interface ConstraintSource {
  canon_id?: string;
  doc?: string;
  line?: number;
  statement: string;
}

export interface StructuredConstraint {
  constraint_id: string;
  binding: AttributeRef;
  assertion: BoundAssertion;
  source: ConstraintSource;
}

/**
 * A constraint whose subject could not be bound to a known entity.attribute. This is
 * exactly the §1 mechanism: the requirement graph named a subject the graph does not
 * contain. Reported as an ERROR before any code is generated.
 */
export interface BindingDefect {
  subject: string;               // the unresolved subject phrase
  assertion: BoundAssertion;
  source: ConstraintSource;
  reason: string;
}
