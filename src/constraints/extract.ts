/**
 * Bound-constraint extraction + binding resolution (rule-based, deterministic).
 *
 * Two steps:
 *  1. Mine the entity→attributes universe from DEFINITION-style statements
 *     ("a habit has a name, a color, and a cadence").
 *  2. Scan CONSTRAINT/INVARIANT canonical nodes for a quantitative bound
 *     ("must not exceed 80 characters", "at least 1") and resolve the subject to a
 *     known entity.attribute. Unresolvable ⇒ a BindingDefect (the §1 catch).
 *
 * Rule-first by design: the point of the slice is a deterministic, testable vertical,
 * not an NLP showcase. Recall (constraints we failed to recognize) is deferred to the
 * open-world coverage signal; this pass owns fidelity (nothing mis-bound sails through).
 */

import { createHash } from 'node:crypto';
import type { CanonicalNode } from '../models/canonical.js';
import { CanonicalType } from '../models/canonical.js';
import type { Clause } from '../models/clause.js';
import type { ImplementationUnit } from '../models/iu.js';
import type { StructuredConstraint, BindingDefect, BoundAssertion, AttributeRef } from './model.js';

const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'be', 'to', 'of', 'in', 'for', 'on', 'with', 'and',
  'or', 'not', 'no', 'must', 'may', 'shall', 'should', 'can', 'cannot', 'have', 'has',
  'that', 'this', 'it', 'its', 'each', 'every', 'any', 'their', 'system', 'user', 'users',
  'exceed', 'least', 'most', 'more', 'fewer', 'than', 'up', 'at', 'characters', 'character',
  'chars', 'char', 'items', 'item', 'value', 'values', 'field', 'must', 'contain',
]);

function singular(t: string): string {
  if (/(?:ss|us|is|ics)$/.test(t)) return t;
  if (t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.endsWith('s')) return t.slice(0, -1);
  return t;
}

/**
 * Mine entity → attribute names. Entities are IU names; attributes are mined from
 * definition-shaped statements about those entities across the canonical graph and
 * (as a fallback) the raw clauses.
 */
export function mineEntityAttributes(
  ius: ImplementationUnit[],
  canonNodes: CanonicalNode[],
  clauses: Clause[] = [],
): Map<string, Set<string>> {
  const entities = new Set(ius.map(iu => singular(iu.name.toLowerCase().trim())));
  const attrs = new Map<string, Set<string>>();
  for (const e of entities) attrs.set(e, new Set());

  const HAS_RE = /\b(?:an?|each|every)?\s*([a-z][a-z-]+)\s+(?:has|have|contains?|includes?)\s+(.+)/i;
  const texts: string[] = [
    ...canonNodes.filter(n => n.type === CanonicalType.DEFINITION || n.type === CanonicalType.CONTEXT || n.type === CanonicalType.REQUIREMENT).map(n => n.statement),
    ...clauses.map(c => c.normalized_text),
  ];

  for (const text of texts) {
    const m = text.match(HAS_RE);
    if (!m) continue;
    const entity = singular(m[1].toLowerCase());
    if (!attrs.has(entity)) continue; // only mine attributes for known entities
    // Attribute nouns: split the tail on commas/and, take the salient noun of each fragment.
    for (const frag of m[2].split(/,|\band\b/)) {
      const tokens = frag.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(Boolean);
      for (const tok of tokens) {
        const s = singular(tok);
        if (s.length > 2 && !STOP.has(s)) attrs.get(entity)!.add(s);
      }
    }
  }
  return attrs;
}

const BOUND_RE =
  /\b(?:must not exceed|not exceed|no more than|at most|maximum(?:\s+of)?|up to|<=|≤)\s+(\d+)|\b(?:at least|no fewer than|minimum(?:\s+of)?|>=|≥)\s+(\d+)/i;

function detectUnit(text: string): string | undefined {
  if (/\bcharacters?\b|\bchars?\b/i.test(text)) return 'chars';
  if (/\bitems?\b|\bentries\b|\belements?\b/i.test(text)) return 'items';
  return undefined;
}

/** Parse a bound assertion from a statement, or null if it carries no quantitative bound. */
export function parseBound(text: string): BoundAssertion | null {
  const m = text.match(BOUND_RE);
  if (!m) return null;
  if (m[1] !== undefined) return { kind: 'bound', op: '<=', value: parseInt(m[1], 10), unit: detectUnit(text) };
  if (m[2] !== undefined) return { kind: 'bound', op: '>=', value: parseInt(m[2], 10), unit: detectUnit(text) };
  return null;
}

/** Resolve the subject of a bounded statement to a known entity.attribute.
 *  `contextText` is the source clause's full text — used to recover a subject the
 *  sentence segmenter dropped when splitting a compound sentence ("A tag label must
 *  not be empty AND must not exceed 40 characters" → the bound fragment alone). */
function resolveBinding(
  statement: string,
  tags: string[],
  entityAttrs: Map<string, Set<string>>,
  contextText = '',
): { ref: AttributeRef } | { subject: string } {
  const tokens = [
    ...statement.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/),
    ...tags.map(t => t.toLowerCase()),
    ...contextText.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/),
  ].map(singular).filter(t => t.length > 2 && !STOP.has(t));
  const present = new Set(tokens);

  // Prefer an (entity, attribute) pair where BOTH the entity and one of its attributes appear.
  for (const [entity, as] of entityAttrs) {
    if (!present.has(entity)) continue;
    for (const attr of as) if (present.has(attr)) return { ref: { entity, attribute: attr } };
  }
  // Fall back: exactly one entity's attribute appears (subject entity implied by context).
  const hits: AttributeRef[] = [];
  for (const [entity, as] of entityAttrs) {
    for (const attr of as) if (present.has(attr)) hits.push({ entity, attribute: attr });
  }
  if (hits.length === 1) return { ref: hits[0] };

  // Unresolved — surface the most salient non-stop noun as the offending subject.
  const subject = tokens.find(t => !/^\d+$/.test(t)) ?? statement.slice(0, 40);
  return { subject };
}

function id(binding: AttributeRef, a: BoundAssertion): string {
  return createHash('sha256').update(['bound', binding.entity, binding.attribute, a.op, String(a.value)].join('\x00')).digest('hex').slice(0, 16);
}

export interface ExtractionOutput {
  constraints: StructuredConstraint[];
  defects: BindingDefect[];
}

/**
 * Extract bound constraints from the canonical CONSTRAINT/INVARIANT nodes and resolve
 * their bindings. Returns resolved constraints and unresolved-binding defects.
 */
export function extractBoundConstraints(
  canonNodes: CanonicalNode[],
  entityAttrs: Map<string, Set<string>>,
  clauseDoc?: (clauseId: string) => { doc?: string; line?: number; text?: string },
): ExtractionOutput {
  const constraints: StructuredConstraint[] = [];
  const defects: BindingDefect[] = [];
  const seen = new Set<string>();

  for (const node of canonNodes) {
    if (node.type !== CanonicalType.CONSTRAINT && node.type !== CanonicalType.INVARIANT) continue;
    const assertion = parseBound(node.statement);
    if (!assertion) continue;

    const loc = clauseDoc && node.source_clause_ids[0] ? clauseDoc(node.source_clause_ids[0]) : {};
    const source = { canon_id: node.canon_id, statement: node.statement, doc: loc.doc, line: loc.line };

    const bound = resolveBinding(node.statement, node.tags ?? [], entityAttrs, loc.text ?? '');
    if ('ref' in bound) {
      const cid = id(bound.ref, assertion);
      if (seen.has(cid)) continue;
      seen.add(cid);
      constraints.push({ constraint_id: cid, binding: bound.ref, assertion, source });
    } else {
      defects.push({
        subject: bound.subject,
        assertion,
        source,
        reason: `constraint subject "${bound.subject}" does not resolve to any known entity.attribute`,
      });
    }
  }
  return { constraints, defects };
}
