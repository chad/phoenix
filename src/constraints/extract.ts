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
import type { StructuredConstraint, BindingDefect, BoundAssertion, MembershipAssertion, PatternAssertion, UniquenessAssertion, ReferenceAssertion, CardinalityAssertion, ExprAssertion, TemporalAssertion, PresenceAssertion, Assertion, AttributeRef } from './model.js';

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
  // A multi-word IU name ("ledger entry", "gold balance") never matches the
  // single-noun subjects constraints use ("an entry note…"). Alias each content
  // word to the SAME attribute set, so "entry" and "ledger entry" are one entity.
  for (const e of [...entities]) {
    const words = e.split(/\s+/);
    if (words.length < 2) continue;
    for (const w of words.map(singular)) {
      if (w.length <= 2 || STOP.has(w)) continue;
      if (!attrs.has(w)) attrs.set(w, attrs.get(e)!);
    }
  }

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

  // Second pass: mine attributes from constraint-shaped statements too (including
  // CONSTRAINT/INVARIANT nodes, which the definition-only first pass skips). A
  // definition may not enumerate every field ("a transaction records money … with a
  // memo" omits amount/date), but a constraint names it directly: "a transaction
  // <attr> must …". Take the last content noun between the entity and the modal.
  const entityNames = [...attrs.keys()];
  const allTexts = [...canonNodes.map(n => n.statement), ...clauses.map(c => c.normalized_text)];
  for (const text of allTexts) {
    const lower = text.toLowerCase();
    for (const entity of entityNames) {
      const m = lower.match(new RegExp(`\\b${entity}\\b(.*?)\\b(?:must|is|are|should|shall|cannot|can't|has to|have to)\\b`, 'i'));
      if (!m) continue;
      const between = m[1].split(/[^a-z-]+/).map(singular).filter(w => w.length > 2 && !STOP.has(w) && !ARTICLES.has(w) && !ADJ.has(w));
      const attr = between[between.length - 1]; // the noun immediately before the modal
      if (attr) attrs.get(entity)!.add(attr);
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
  const tail = m[1]
    .replace(/[.;].*$/, '')                                          // stop at sentence end
    // stop at the next attribute clause: "credit or debit, and a status of…" →
    // "credit or debit". A new "<conj> a/an/the/its <noun>" begins a different field,
    // so its values must not bleed into this enum. (A plain list "red, and blue"
    // is preserved — "blue" is not an article.)
    .replace(/,?\s+(?:and|with|but|plus|as well as)\s+(?:a|an|the|its|each|their)\s.*$/i, '')
    // Oxford-comma conjunction: "rogue, or cleric" — the split sees ", " first and
    // leaves "or cleric" as one token, silently DROPPING the last value. Normalize.
    .replace(/,\s*(?:or|and)\s+/gi, ', ');
  const values = tail
    .split(/\s*,\s*|\s+or\s+|\s+and\s+/i)
    .map(v => v.trim().toLowerCase().replace(/^['"]|['"]$/g, ''))
    .filter(v => v.length > 0 && /^[a-z0-9][a-z0-9_-]*$/.test(v));
  return values.length >= 2 ? { kind: 'membership', values } : null;
}

/** Parse a format/pattern assertion, or null. Recognizes common named formats. */
export function parsePattern(text: string): PatternAssertion | null {
  const s = text.toLowerCase();
  // Require a normative cue so a passing mention ("has an email") isn't a constraint.
  if (!/\b(?:must|valid|be a|be an|format|matches?|conform)\b/.test(s)) return null;
  if (/\bemail\b/.test(s)) return { kind: 'pattern', format: 'email' };
  if (/\b(?:url|uri|link|https?)\b/.test(s)) return { kind: 'pattern', format: 'url' };
  if (/\buuid\b/.test(s)) return { kind: 'pattern', format: 'uuid' };
  if (/\b(?:iso ?8601|date|timestamp)\b/.test(s) && /\bvalid\b/.test(s)) return { kind: 'pattern', format: 'date' };
  return null;
}

/** Parse a uniqueness assertion, or null: "must be unique" / "must be a unique X". */
export function parseUniqueness(text: string): UniquenessAssertion | null {
  return /\b(?:must be|is|should be)\b[^.]*\bunique\b|\buniquely\b/i.test(text) ? { kind: 'uniqueness' } : null;
}

// "must reference an existing account" / "belongs to an account" / "for an account
// that does not exist". The target is the referenced entity (singular head noun).
const REFERENCE_RE =
  /\b(?:must\s+)?(?:reference|belong to|point to|refers? to|belongs? to)\s+(?:an?\s+)?(?:existing\s+|valid\s+)?([a-z][a-z-]+)|\bfor\s+(?:an?\s+)?([a-z][a-z-]+)\s+that\s+(?:does\s+not|doesn't|must)\s+exist/i;

/** Parse a referential-integrity assertion ("must reference an existing X"), or null. */
export function parseReference(text: string): ReferenceAssertion | null {
  const m = text.match(REFERENCE_RE);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? '').toLowerCase();
  const target = singular(raw);
  return target && target.length > 2 && !STOP.has(target) ? { kind: 'reference', target } : null;
}

const NUMWORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
// "must have at least one line item" / "contains at most 3 tags" — a count on a
// RELATION (a collection), not a scalar bound. Requires a possessive/containment
// verb so scalar bounds ("must not exceed 80 characters") don't match here.
const CARDINALITY_RE =
  /\b(?:have|has|contains?|includes?|with|hold)\b[^.]*?\b(at least|at most|no fewer than|no more than|minimum(?:\s+of)?|maximum(?:\s+of)?|exactly)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+([a-z][a-z -]*?)(?:\.|,|;|:|$|\s+(?:per|for|in|of|that|which)\b)/i;

/** Parse a cardinality assertion on a relation ("at least one line item"), or null. */
export function parseCardinality(text: string): CardinalityAssertion | null {
  const m = text.match(CARDINALITY_RE);
  if (!m) return null;
  const qual = m[1].toLowerCase();
  const n = /^\d+$/.test(m[2]) ? parseInt(m[2], 10) : NUMWORD[m[2].toLowerCase()];
  if (n === undefined) return null;
  const relation = singular(m[3].trim().split(/\s+/).pop()!.toLowerCase()); // head noun of the relation
  // Note: the relation noun is the collection the checker searches for in code
  // ("item" → matches "items"), so it must NOT be filtered by the bound-noise STOP
  // set (which includes "item"); reject only non-noun quantifiers/pronouns.
  const NON_RELATION = new Set(['them', 'it', 'one', 'each', 'other', 'more', 'fewer', 'value', 'thing']);
  if (!relation || relation.length < 2 || NON_RELATION.has(relation)) return null;
  // A measurement UNIT ("maximum of 80 characters") is a scalar length bound, not a
  // relation cardinality — "80 characters" is one string's length, not 80 things. Yield
  // so the bound parser (which owns quantitative units) can claim it. Without this,
  // cardinality mis-captures a bound as `max 80 characters`, a wrong-kind false green.
  const UNIT_NOUN = new Set(['character', 'char', 'byte', 'word', 'letter', 'digit', 'kb', 'mb', 'gb']);
  if (UNIT_NOUN.has(relation)) return null;
  const isMax = /most|no more|maximum/.test(qual);
  return isMax ? { kind: 'cardinality', max: n, relation } : { kind: 'cardinality', min: n, relation };
}

// A relational / conditional invariant that no single-field kind claims: a
// conditional ("if shipped then shipped_at set"), a threshold effect ("would take
// the balance below zero"), or a sign/aggregate invariant ("must never be
// negative", "is the sum of …"). Deliberately narrow AND safe: the checker abstains
// when it can't reduce the statement, so breadth here never yields a false red.
const EXPR_CUES =
  /\bif\b.+\bthen\b|would\s+(?:take|make|cause|leave|put|bring|result)\b|below\s+(?:zero|0)\b|never\s+(?:be|becomes?|goes?|falls?|turns?)\s+negative|non-?negative|\bsum\s+of\b|\btotal\s+of\b|must\s+(?:not\s+)?(?:equal|match)\b/i;
// Inflected forms included: the LLM canonicalizer normalizes "must reject" to
// "rejects" and "must never be" to "never becomes" — normativity must survive that.
const EXPR_NORMATIVE = /\b(?:must|shall|should|cannot|can't|may not|never|always|reject(?:s|ed|ing)?|ensure[sd]?|require[sd]?|if)\b/i;
// A declarative aggregate equality ("the board total equals the sum of all …")
// is normative in substance even with no modal. Guard: a "minus"-formula sentence
// ("balance is the sum of loot minus purchases") is a DEFINITION, not a property
// the runner can test as a plain sum — leave it to the definition path.
const EXPR_DECLARATIVE_AGG = /\bequals?\b[^.]*\bsum of\b/i;

/** Parse a relational/conditional invariant routed to the executable oracle, or null. */
export function parseExpr(text: string): ExprAssertion | null {
  const s = text.trim().replace(/\s+/g, ' ');
  if (EXPR_DECLARATIVE_AGG.test(s) && !/\bminus\b/i.test(s)) return { kind: 'expr', statement: s };
  if (!EXPR_NORMATIVE.test(s) || !EXPR_CUES.test(s)) return null;
  return { kind: 'expr', statement: s };
}

// "a transaction date must not occur in the future" / "the date cannot be in the
// future" / "dates in the past are rejected". Negation + a temporal direction.
const TEMPORAL_FUTURE_RE = /\b(?:not|never|cannot|can['’]t|no)\b[^.]*\bin the future\b|\bfuture\s+dates?\s+are\s+(?:not\s+allowed|rejected|invalid)/i;
const TEMPORAL_PAST_RE = /\b(?:not|never|cannot|can['’]t|no)\b[^.]*\bin the past\b|\bpast\s+dates?\s+are\s+(?:not\s+allowed|rejected|invalid)/i;

/** Parse a temporal assertion ("must not occur in the future"), or null. */
export function parseTemporal(text: string): TemporalAssertion | null {
  if (TEMPORAL_FUTURE_RE.test(text)) return { kind: 'temporal', mode: 'not-future' };
  if (TEMPORAL_PAST_RE.test(text)) return { kind: 'temporal', mode: 'not-past' };
  return null;
}

// The quantifier-free required-fields form: "provide at least a name and an email".
// "at least" followed by an ARTICLE (not a number — numeric counts are cardinality)
// names fields that must be present. Stop at an infinitive/purpose clause.
const PRESENCE_RE = /\b(?:provide|providing|include|including|supply|specify|specifying|give|enter|with)\s+at least\s+((?:an?|the)\s+.+)/i;

/** Parse a presence (required-fields) assertion, or null. `fields` carries the
 *  named field nouns; extraction emits one constraint per resolved field. */
export function parsePresence(text: string): PresenceAssertion | null {
  const m = text.match(PRESENCE_RE);
  if (!m) return null;
  const tail = m[1]
    .replace(/[.;].*$/, '')
    .replace(/\s+(?:to|in order to|when|so that|for)\s.*$/i, ''); // drop the purpose clause
  const fields: string[] = [];
  for (const frag of tail.split(/,|\band\b/)) {
    const fm = frag.trim().match(/^(?:an?|the)\s+([a-z][a-z-]*)/i);
    if (!fm) continue;
    const f = singular(fm[1].toLowerCase());
    if (f.length > 2 && !STOP.has(f)) fields.push(f);
  }
  return fields.length > 0 ? { kind: 'presence', fields } : null;
}

/**
 * Parse any supported assertion kind. Order matters:
 *  - Reference & Cardinality first — their cues ("existing X", "at least one X")
 *    are specific and must not be misread as a scalar bound or pattern.
 *  - Uniqueness BEFORE pattern — "email must be unique" mentions "email" and would
 *    otherwise be mis-parsed as an email-format constraint; the "unique" signal wins.
 *  - Expr LAST — the relational/conditional catch-all, claimed only when no
 *    single-field kind applies.
 */
export function parseAssertion(text: string): Assertion | null {
  return parseReference(text)
    ?? parseCardinality(text)
    ?? parseBound(text)
    ?? parseMembership(text)
    ?? parseUniqueness(text)
    // Presence & temporal BEFORE pattern: "must provide at least a name and an
    // email" mentions "email" and would mis-read as an email-format constraint;
    // "date … in the future" must not be claimed by the date-format reading.
    ?? parsePresence(text)
    ?? parseTemporal(text)
    ?? parsePattern(text)
    ?? parseExpr(text);
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
  const shape = a.kind === 'bound' ? `${a.op}:${a.value}`
    : a.kind === 'membership' ? `in:${[...a.values].sort().join('|')}`
    : a.kind === 'pattern' ? `fmt:${a.format}${a.regex ?? ''}`
    : a.kind === 'reference' ? `ref:${a.target}`
    : a.kind === 'cardinality' ? `card:${a.min ?? ''}..${a.max ?? ''}:${a.relation}`
    : a.kind === 'expr' ? `expr:${a.statement.slice(0, 60)}`
    : a.kind === 'temporal' ? `tmp:${a.mode}`
    : a.kind === 'presence' ? 'required'
    : 'unique';
  return createHash('sha256').update([a.kind, binding.entity, binding.attribute, shape].join('\x00')).digest('hex').slice(0, 16);
}

/**
 * Bind one presence field to its owning entity: the entity whose mined attributes
 * contain the field, preferring an entity NAMED in the statement ("… to create an
 * account" → account.name over some other entity that also has a name).
 */
function bindPresenceField(
  statement: string,
  field: string,
  entityAttrs: Map<string, Set<string>>,
): AttributeRef | null {
  const lower = statement.toLowerCase();
  let anyOwner: AttributeRef | null = null;
  for (const [entity, as] of entityAttrs) {
    if (!as.has(field)) continue;
    if (new RegExp(`\\b${entity}s?\\b`).test(lower)) return { entity, attribute: field };
    anyOwner ??= { entity, attribute: field };
  }
  return anyOwner;
}

/**
 * Bind a relational assertion (reference / cardinality / expr) to the entity whose
 * generated module must enforce it. Unlike scalar bounds, these don't resolve to a
 * single mined attribute — they name the governing entity directly (the holder of a
 * foreign key, the owner of a collection, the actor that must reject a state).
 *
 * The holder is the known entity NAMED in the statement, preferring the one that is
 * NOT the reference target (a FK's holder is the subject, not the pointee). Returns
 * a binding or an unresolved subject (→ a BindingDefect, the §1 guard).
 */
function bindRelational(
  statement: string,
  a: ReferenceAssertion | CardinalityAssertion | ExprAssertion,
  entityAttrs: Map<string, Set<string>>,
): { ref: AttributeRef } | { subject: string } {
  const lower = statement.toLowerCase();
  const pos = (e: string): number => {
    const m = lower.match(new RegExp(`\\b${e}s?\\b`));
    return m && m.index !== undefined ? m.index : -1;
  };
  const mentioned = [...entityAttrs.keys()]
    .map(e => ({ e, p: pos(e) }))
    .filter(x => x.p >= 0)
    .sort((x, y) => x.p - y.p);

  if (a.kind === 'reference') {
    // Holder = earliest-named entity that isn't the target; attribute names the ref.
    const holder = mentioned.find(x => x.e !== a.target) ?? mentioned[0];
    if (!holder) return { subject: a.target };
    return { ref: { entity: holder.e, attribute: a.target } };
  }
  if (a.kind === 'cardinality') {
    const holder = mentioned.find(x => x.e !== a.relation) ?? mentioned[0];
    if (!holder) return { subject: a.relation };
    return { ref: { entity: holder.e, attribute: a.relation } };
  }
  // expr: bind to the STATE OWNER — the entity mentioned nearest BEFORE the
  // invariant cue ("…gold BALANCE never becomes negative" governs the balance,
  // not the adventurer who happens to be the sentence's grammatical subject).
  // The write-path analysis still catches every module that writes the state;
  // this binding only decides which module the nominal fallback checks.
  const cueM = lower.match(/below\s+(?:zero|0)|negative|in the future|sum of|equal/);
  if (cueM && cueM.index !== undefined) {
    const before = mentioned.filter(x => x.p < cueM.index!).sort((x, y) => y.p - x.p);
    if (before.length > 0) return { ref: { entity: before[0].e, attribute: 'invariant' } };
  }
  // Fallback: the entity nearest an action verb (reject/record/…); else the first.
  const actionM = lower.match(/\b(?:reject|record|create|add|update|post|apply|allow|prevent)\b/);
  const anchor = actionM && actionM.index !== undefined ? actionM.index : 0;
  const byAction = [...mentioned].sort((x, y) => Math.abs(x.p - anchor) - Math.abs(y.p - anchor));
  const holder = byAction[0] ?? mentioned[0];
  if (!holder) return { subject: statement.slice(0, 40) };
  return { ref: { entity: holder.e, attribute: 'invariant' } };
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

    // Presence names SEVERAL fields in one sentence ("at least a name and an
    // email") — emit one constraint per resolved field; unresolved fields defect.
    if (assertion.kind === 'presence') {
      for (const field of assertion.fields ?? []) {
        const ref = bindPresenceField(node.statement, field, entityAttrs);
        if (ref) {
          const a: Assertion = { kind: 'presence' }; // fields are transient — the binding carries the attribute
          const cid = id(ref, a);
          if (seen.has(cid)) continue;
          seen.add(cid);
          constraints.push({ constraint_id: cid, binding: ref, assertion: a, source });
        } else {
          defects.push({
            subject: field, assertion: { kind: 'presence' }, source,
            reason: `required field "${field}" does not resolve to any known entity.attribute`,
          });
        }
      }
      continue;
    }

    // Relational kinds name the governing entity directly (a FK holder, a collection
    // owner, an invariant's actor); scalar kinds resolve to a mined attribute.
    const bound = (assertion.kind === 'reference' || assertion.kind === 'cardinality' || assertion.kind === 'expr')
      ? bindRelational(node.statement, assertion, entityAttrs)
      : resolveBinding(node.statement, node.tags ?? [], entityAttrs, loc.text ?? '');
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
