/**
 * Verified-LLM constraint extraction (P1) — say the rule any way you like.
 *
 * The rule-based extractor (extract.ts) is the deterministic FLOOR: high fidelity, modest
 * recall (~53% of the paraphrase corpus captured; the rest are honestly FLAGGED as
 * unverified obligations, never silent). This adds a SECOND pass for exactly those flagged
 * sentences: an LLM PROPOSES a structured constraint `{kind, entity, attribute, params}`,
 * and — this is the whole trust story — the proposal is accepted ONLY by DETERMINISTIC
 * post-checks. The model's judgment is a suggestion; the gate is the authority.
 *
 * The acceptance gate (gate 4 — wrong-capture must stay 0):
 *   1. TYPECHECK against the 9-kind algebra — the kind is real and its params are
 *      well-formed for that kind.
 *   2. BINDING RESOLVES — the entity is a mined entity and (for field kinds) the attribute
 *      is one of its mined attributes; a relational kind names a known entity.
 *   3. LITERALS PRESENT — every value the proposal claims (a bound's number, an enum's
 *      members, a reference's target, a cardinality count, a temporal cue) appears
 *      LITERALLY in the sentence. The model cannot smuggle in a value the spec never said.
 * A proposal that fails ANY check is REJECTED and the sentence stays an unverified
 * obligation — never silently trusted, never a false green.
 *
 * The rule extractor stays the floor and cross-check: this pass runs ONLY on sentences the
 * rules left unverified, so a sentence both paths could claim is decided by the audited
 * rule result (it already captured it), never overridden by the model.
 *
 * The proposer is injected (an interface), so the acceptance gate — the shipped trust
 * boundary — is proven in CI with a SCRIPTED proposer, no live model. A real-LLM proposer
 * (guarded by an API key, never in CI) drives the same gate.
 */

import { createHash } from 'node:crypto';
import type {
  StructuredConstraint, Assertion, AttributeRef,
} from './model.js';

/** A structured proposal from the model (or a scripted stand-in). Deliberately loose —
 *  the acceptance gate is what makes it trustworthy. */
export interface LlmProposal {
  kind: string;
  entity: string;
  attribute: string;
  params?: Record<string, unknown>;
}

/** The context a proposer sees for one sentence: the mined entity/attribute universe. */
export interface ProposalContext {
  sentence: string;
  entities: string[];
  attributesByEntity: Record<string, string[]>;
}

/** A proposer turns a sentence + context into a proposal (or null = "no idea"). Injected so
 *  the acceptance gate is testable with a scripted stand-in (CI) or a real LLM (guarded). */
export type Proposer = (ctx: ProposalContext) => (LlmProposal | null) | Promise<LlmProposal | null>;

export type AcceptResult =
  | { accepted: true; constraint: StructuredConstraint }
  | { accepted: false; reason: string };

const FIELD_KINDS = new Set(['bound', 'membership', 'pattern', 'uniqueness', 'temporal', 'presence']);
const RELATIONAL_KINDS = new Set(['reference', 'cardinality', 'expr', 'temporal-relative']);
const ALL_KINDS = new Set([...FIELD_KINDS, ...RELATIONAL_KINDS]);

/** A normalized view of the sentence for literal-presence checks (lowercased, punctuation
 *  to spaces) plus a word-boundary containment test. */
function makeSentenceProbe(sentence: string) {
  const norm = ' ' + sentence.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  const singular = (t: string) => t.endsWith('ies') ? t.slice(0, -3) + 'y' : t.endsWith('s') ? t.slice(0, -1) : t;
  return {
    hasWord: (w: string): boolean => {
      const t = w.toLowerCase().trim();
      if (!t) return false;
      // Match the token or its singular/plural, on a word boundary.
      return norm.includes(` ${t} `) || norm.includes(` ${singular(t)} `) || norm.includes(` ${t}s `);
    },
    hasNumber: (n: number): boolean => new RegExp(`(?:^|[^0-9])${n}(?:[^0-9]|$)`).test(sentence),
    raw: sentence,
  };
}

const NUMWORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function constraintId(binding: AttributeRef, a: Assertion): string {
  return createHash('sha256').update(['llm', a.kind, binding.entity, binding.attribute, JSON.stringify(a)].join('\x00')).digest('hex').slice(0, 16);
}

/**
 * The deterministic acceptance gate. Returns the accepted constraint or a rejection reason.
 * This is the shipped trust boundary — every branch below is a check the MODEL cannot talk
 * its way past.
 */
export function acceptProposal(
  proposal: LlmProposal,
  sentence: string,
  entityAttrs: Map<string, Set<string>>,
): AcceptResult {
  const kind = String(proposal.kind || '').toLowerCase();
  const entity = String(proposal.entity || '').toLowerCase().trim();
  const attribute = String(proposal.attribute || '').toLowerCase().trim();
  const params = proposal.params ?? {};
  const probe = makeSentenceProbe(sentence);
  const reject = (reason: string): AcceptResult => ({ accepted: false, reason });

  // 1) TYPECHECK — the kind must be one of the 9.
  if (!ALL_KINDS.has(kind)) return reject(`unknown kind "${kind}"`);

  // 2) BINDING RESOLVES — the entity is mined; a field kind's attribute is a mined attribute.
  const attrs = entityAttrs.get(entity);
  if (!attrs) return reject(`entity "${entity}" is not a known entity`);
  if (FIELD_KINDS.has(kind) && !attrs.has(attribute)) {
    return reject(`attribute "${entity}.${attribute}" does not resolve to a mined entity.attribute`);
  }

  // 3) TYPECHECK PARAMS + LITERALS PRESENT — per kind, build the assertion only from values
  //    that appear literally in the sentence.
  let assertion: Assertion;
  switch (kind) {
    case 'bound': {
      const op = params.op === '>=' ? '>=' : params.op === '<=' ? '<=' : null;
      const value = Number(params.value);
      if (!op) return reject('bound: op must be "<=" or ">="');
      if (!Number.isFinite(value)) return reject('bound: value must be a number');
      if (!probe.hasNumber(value)) return reject(`bound: value ${value} is not present in the sentence`);
      const unit = typeof params.unit === 'string' ? params.unit : (/\bcharacters?\b|\bchars?\b/i.test(sentence) ? 'chars' : undefined);
      assertion = { kind: 'bound', op, value, unit };
      break;
    }
    case 'membership': {
      const values = Array.isArray(params.values) ? params.values.map(v => String(v).toLowerCase().trim()).filter(Boolean) : [];
      if (values.length < 2) return reject('membership: need ≥2 values');
      const missing = values.filter(v => !probe.hasWord(v));
      if (missing.length > 0) return reject(`membership: value(s) not in the sentence: ${missing.join(', ')}`);
      assertion = { kind: 'membership', values };
      break;
    }
    case 'pattern': {
      const fmt = String(params.format || '').toLowerCase();
      const named = ['email', 'url', 'uuid', 'date'];
      if (!named.includes(fmt)) return reject(`pattern: format must be one of ${named.join('/')}`);
      const cue = fmt === 'url' ? ['url', 'uri', 'link', 'http', 'https'] : [fmt];
      if (!cue.some(c => probe.hasWord(c))) return reject(`pattern: no "${fmt}" cue in the sentence`);
      assertion = { kind: 'pattern', format: fmt as 'email' | 'url' | 'uuid' | 'date' };
      break;
    }
    case 'uniqueness': {
      // No value literal; the attribute is already verified present via binding. Require a
      // uniqueness-family cue so an arbitrary sentence can't be relabeled unique.
      if (!/\bunique|\bduplicate|\btwice|\bshare\b|\brepeat|\bsame\b/i.test(sentence)) {
        return reject('uniqueness: no uniqueness cue (unique/duplicate/twice/share/repeat/same)');
      }
      assertion = { kind: 'uniqueness' };
      break;
    }
    case 'temporal': {
      const mode = params.mode === 'not-past' ? 'not-past' : params.mode === 'not-future' ? 'not-future' : null;
      if (!mode) return reject('temporal: mode must be not-future/not-past');
      const word = mode === 'not-future' ? 'future' : 'past';
      if (!probe.hasWord(word)) return reject(`temporal: "${word}" not in the sentence`);
      assertion = { kind: 'temporal', mode };
      break;
    }
    case 'presence': {
      // The bound attribute IS the required field; binding already verified it is present.
      if (!probe.hasWord(attribute)) return reject(`presence: field "${attribute}" not named in the sentence`);
      assertion = { kind: 'presence' };
      break;
    }
    case 'reference': {
      const target = String(params.target || attribute || '').toLowerCase().trim();
      if (!entityAttrs.has(target)) return reject(`reference: target "${target}" is not a known entity`);
      if (!probe.hasWord(target)) return reject(`reference: target "${target}" not in the sentence`);
      assertion = { kind: 'reference', target };
      break;
    }
    case 'cardinality': {
      const relation = String(params.relation || attribute || '').toLowerCase().trim();
      if (!relation || !probe.hasWord(relation)) return reject(`cardinality: relation "${relation}" not in the sentence`);
      const min = params.min != null ? Number(params.min) : undefined;
      const max = params.max != null ? Number(params.max) : undefined;
      if (min === undefined && max === undefined) return reject('cardinality: need a min or max');
      for (const [n, label] of [[min, 'min'], [max, 'max']] as const) {
        if (n === undefined) continue;
        if (!Number.isFinite(n)) return reject(`cardinality: ${label} must be a number`);
        const wordForN = Object.entries(NUMWORD).find(([, v]) => v === n)?.[0];
        if (!probe.hasNumber(n) && !(wordForN && probe.hasWord(wordForN))) return reject(`cardinality: ${label} ${n} not in the sentence`);
      }
      assertion = { kind: 'cardinality', ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), relation };
      break;
    }
    case 'temporal-relative': {
      const offsetDays = Number(params.offsetDays);
      const anchorEvent = String(params.anchorEvent || '').toLowerCase().trim();
      const targetState = String(params.targetState || attribute || '').toLowerCase().trim();
      if (!Number.isFinite(offsetDays) || offsetDays <= 0) return reject('temporal-relative: offsetDays must be a positive number');
      if (!/\bafter\b/i.test(sentence)) return reject('temporal-relative: no "after" boundary cue');
      if (!targetState || !probe.hasWord(targetState)) return reject(`temporal-relative: target state "${targetState}" not in the sentence`);
      assertion = { kind: 'temporal-relative', offsetDays, anchorEvent, targetState };
      break;
    }
    case 'expr': {
      // The catch-all invariant. It routes to the executable oracle which ABSTAINS unless it
      // can reduce the statement — so a wrong expr is indeterminate, never a false green. We
      // still gate it: require a relational cue so a flat field rule isn't relabeled expr.
      if (!/\bbelow\b|\bnegative\b|\bsum\b|\btotal\b|\bequal|\bexceed|\bzero\b|\bat least\b|would\b|\bif\b/i.test(sentence)) {
        return reject('expr: no relational/conditional cue');
      }
      assertion = { kind: 'expr', statement: sentence.trim().replace(/\s+/g, ' ') };
      break;
    }
    default:
      return reject(`unhandled kind "${kind}"`);
  }

  // Relational kinds bind to the governing entity directly; the attribute for a field kind
  // is the mined attribute, for a relational kind it is the target/relation/state name.
  const bindingAttr = kind === 'reference' ? (assertion as { target: string }).target
    : kind === 'cardinality' ? (assertion as { relation: string }).relation
    : kind === 'temporal-relative' ? (assertion as { targetState: string }).targetState
    : kind === 'expr' ? 'invariant'
    : attribute;
  const binding: AttributeRef = { entity, attribute: bindingAttr };
  return { accepted: true, constraint: { constraint_id: constraintId(binding, assertion), binding, assertion, source: { statement: sentence } } };
}

export interface LlmExtractionResult {
  /** Constraints the gate accepted (add these to the verified set). */
  accepted: StructuredConstraint[];
  /** Per-sentence rejections (stay unverified obligations — surfaced, never silent). */
  rejected: Array<{ sentence: string; reason: string }>;
}

/**
 * Run the verified-LLM SECOND pass over the sentences the rule extractor left unverified.
 * Each proposal runs through the deterministic acceptance gate; accepted proposals become
 * constraints, rejected ones are returned so the caller keeps them as flagged obligations.
 * `alreadyCaptured` is the set of sentences the rule floor already claimed — skipped here so
 * the audited rule result always wins on a sentence both could claim.
 */
export async function extractWithLlm(
  unverifiedSentences: string[],
  entityAttrs: Map<string, Set<string>>,
  proposer: Proposer,
  alreadyCaptured: ReadonlySet<string> = new Set(),
): Promise<LlmExtractionResult> {
  const entities = [...entityAttrs.keys()];
  const attributesByEntity: Record<string, string[]> = {};
  for (const [e, as] of entityAttrs) attributesByEntity[e] = [...as];

  const accepted: StructuredConstraint[] = [];
  const rejected: Array<{ sentence: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const sentence of unverifiedSentences) {
    const key = sentence.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (alreadyCaptured.has(key)) continue; // rule floor already owns it — never override

    let proposal: LlmProposal | null = null;
    try { proposal = await proposer({ sentence, entities, attributesByEntity }); }
    catch (e) { rejected.push({ sentence, reason: `proposer error: ${(e as Error).message}` }); continue; }
    if (!proposal) { rejected.push({ sentence, reason: 'no proposal' }); continue; }

    const r = acceptProposal(proposal, sentence, entityAttrs);
    if (r.accepted) accepted.push(r.constraint);
    else rejected.push({ sentence, reason: r.reason });
  }
  return { accepted, rejected };
}
