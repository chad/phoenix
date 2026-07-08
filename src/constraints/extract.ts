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
import type { StructuredConstraint, BindingDefect, BoundAssertion, MembershipAssertion, Assertion, AttributeRef } from './model.js';

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

  const ARTICLES = new Set(['a', 'an', 'the', 'of', 'for', 'with', 'its', 'their', 'to']);
  const ADJ = new Set(['optional', 'unique', 'stable', 'valid', 'required', 'visual', 'single', 'new', 'default', 'either']);
  for (const text of texts) {
    const m = text.match(HAS_RE);
    if (!m) continue;
    const entity = singular(m[1].toLowerCase());
    if (!attrs.has(entity)) continue; // only mine attributes for known entities
    // An attribute is the HEAD NOUN of each "a ___, a ___, and a ___" fragment — not
    // every token. "a cadence of either daily or weekly" contributes `cadence`, not
    // `either`/`daily`/`weekly` (those are its value set, not sibling attributes).
    for (const frag of m[2].split(/,|\band\b/)) {
      const words = frag.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(Boolean);
      for (const w of words) {
        const s = singular(w);
        if (ARTICLES.has(w) || ADJ.has(s)) continue;       // skip articles + leading adjectives
        if (s.length <= 2 || STOP.has(s)) continue;
        attrs.get(entity)!.add(s);                          // first content noun = the attribute
        break;                                              // stop at the head; ignore the rest of the fragment
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

// "must be one of daily, weekly" / "one of: a, b and c" / "must be either x or y"
const MEMBERSHIP_RE = /\b(?:must be |is )?(?:one of|any of|either)\s*:?\s+(.+)/i;

/** Parse an enum/value-set assertion, or null. Values are lowercased tokens. */
export function parseMembership(text: string): MembershipAssertion | null {
  // Guard: only treat as membership when the "one of / either" cue is present.
  const m = text.match(MEMBERSHIP_RE);
  if (!m) return null;
  const tail = m[1].replace(/[.;].*$/, ''); // stop at sentence end
  const values = tail
    .split(/\s*,\s*|\s+or\s+|\s+and\s+/i)
    .map(v => v.trim().toLowerCase().replace(/^['"]|['"]$/g, ''))
    .filter(v => v.length > 0 && /^[a-z0-9][a-z0-9_-]*$/.test(v));
  return values.length >= 2 ? { kind: 'membership', values } : null;
}

/** Parse any supported assertion kind from a statement. Bound takes priority. */
export function parseAssertion(text: string): Assertion | null {
  return parseBound(text) ?? parseMembership(text);
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
  const toks = (s: string) => s.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).map(singular).filter(t => t.length > 2 && !STOP.has(t));
  const stmtTokens = [...toks(statement), ...tags.map(t => singular(t.toLowerCase()))];

  // Try resolving from the STATEMENT's own tokens first (the subject the constraint
  // actually names), and only fall back to the surrounding clause text if that fails.
  // Statement-first avoids over-recovering sibling attributes ("cadence must be one
  // of…" must bind to cadence, not to the "name" that appears in the entity's
  // definition clause).
  // The position of the constraint cue in the statement — attributes bind to the
  // attribute NEAREST this cue (word order the token-bag would otherwise lose).
  // "...a cadence of either daily or weekly" → the enum binds to cadence, not to
  // the "name" that also appears earlier in the sentence.
  const lower = statement.toLowerCase();
  const cueM = lower.match(/must not exceed|no more than|at most|maximum|up to|at least|no fewer than|minimum|one of|any of|either|must not be empty|must be/i);
  const cueIdx = cueM && cueM.index !== undefined ? cueM.index : lower.length;
  const attrPos = (attr: string): number => {
    const m = lower.match(new RegExp(`\\b${attr}s?\\b`));
    return m && m.index !== undefined ? m.index : -1;
  };
  /** Rank candidates: the attribute closest-preceding the cue wins; else nearest. */
  const best = (cands: AttributeRef[]): AttributeRef | null => {
    if (cands.length <= 1) return cands[0] ?? null;
    const scored = cands.map(c => ({ c, pos: attrPos(c.attribute) })).filter(x => x.pos >= 0);
    if (scored.length === 0) return null; // present only via tags/context — can't rank
    const preceding = scored.filter(x => x.pos <= cueIdx).sort((a, b) => b.pos - a.pos);
    if (preceding.length > 0) return preceding[0].c;
    return scored.sort((a, b) => Math.abs(a.pos - cueIdx) - Math.abs(b.pos - cueIdx))[0].c;
  };

  const attempt = (present: Set<string>): AttributeRef | null => {
    // Prefer candidates of an entity that is itself named in the statement.
    const entityNamed: AttributeRef[] = [];
    const anyEntity: AttributeRef[] = [];
    for (const [entity, as] of entityAttrs) {
      for (const attr of as) {
        if (!present.has(attr)) continue;
        anyEntity.push({ entity, attribute: attr });
        if (present.has(entity)) entityNamed.push({ entity, attribute: attr });
      }
    }
    return best(entityNamed.length > 0 ? entityNamed : anyEntity);
  };

  const fromStatement = attempt(new Set(stmtTokens));
  if (fromStatement) return { ref: fromStatement };

  const fromContext = attempt(new Set([...stmtTokens, ...toks(contextText)]));
  if (fromContext) return { ref: fromContext };

  const subject = stmtTokens.find(t => !/^\d+$/.test(t)) ?? statement.slice(0, 40);
  return { subject };
}

function id(binding: AttributeRef, a: Assertion): string {
  const shape = a.kind === 'bound' ? `${a.op}:${a.value}` : `in:${[...a.values].sort().join('|')}`;
  return createHash('sha256').update([a.kind, binding.entity, binding.attribute, shape].join('\x00')).digest('hex').slice(0, 16);
}

export interface ExtractionOutput {
  constraints: StructuredConstraint[];
  defects: BindingDefect[];
}

/**
 * Extract structured constraints (Bound + Membership) from the canonical
 * CONSTRAINT/INVARIANT/DEFINITION nodes and resolve their bindings. Returns
 * resolved constraints and unresolved-binding defects (the §1 guard).
 */
export function extractConstraints(
  canonNodes: CanonicalNode[],
  entityAttrs: Map<string, Set<string>>,
  clauseDoc?: (clauseId: string) => { doc?: string; line?: number; text?: string },
): ExtractionOutput {
  const constraints: StructuredConstraint[] = [];
  const defects: BindingDefect[] = [];
  const seen = new Set<string>();

  for (const node of canonNodes) {
    // Enums often live in DEFINITION/CONTEXT nodes ("cadence must be one of…"), so
    // membership is mined more broadly than bounds (which are CONSTRAINT/INVARIANT).
    const assertion = parseAssertion(node.statement);
    if (!assertion) continue;
    if (assertion.kind === 'bound' && node.type !== CanonicalType.CONSTRAINT && node.type !== CanonicalType.INVARIANT) continue;

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

/** Bound-only extraction (back-compat wrapper over extractConstraints). */
export function extractBoundConstraints(
  canonNodes: CanonicalNode[],
  entityAttrs: Map<string, Set<string>>,
  clauseDoc?: (clauseId: string) => { doc?: string; line?: number; text?: string },
): ExtractionOutput {
  const out = extractConstraints(canonNodes, entityAttrs, clauseDoc);
  return {
    constraints: out.constraints.filter(c => c.assertion.kind === 'bound'),
    defects: out.defects.filter(d => d.assertion.kind === 'bound'),
  };
}
