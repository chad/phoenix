/**
 * Spec proposals — the spec talks back (P2).
 *
 * When verification fails on a binding defect or a normative sentence that produced no
 * checkable constraint (an unverified obligation), the frozen extractor's cues are the
 * contract: the system knows exactly which spec shapes it can bind, so it can PROPOSE a
 * rewording of the exact spec line — never apply one. Intent is human-sovereign: every
 * proposal is a suggestion the author takes or leaves, then re-runs canonicalize.
 *
 * The discipline that makes this safe (and keeps it from becoming an extractor by the
 * back door): a proposal is surfaced ONLY when re-running the FROZEN extractor on the
 * reworded line captures a constraint with no defect. The re-extraction receipt rides
 * with the proposal, so the human sees what the machine would bind before accepting.
 * Rewordings that don't validate are never shown as fixes — they're reported honestly
 * as "no confident proposal".
 *
 * Three proposal shapes:
 *   rewording              — a validated line-level edit (defects: qualify the subject
 *                            with its entity; obligations: canonicalize the cue phrase)
 *   informational          — conflicting bounds: the spec contradicts itself; no
 *                            confident rewording exists, so we name both lines and stop
 *   no-confident-proposal  — nothing we tried validates; said so, in the open
 */

import type { CanonicalNode } from './models/canonical.js';
import { CanonicalType } from './models/canonical.js';
import type { Clause } from './models/clause.js';
import type { ImplementationUnit } from './models/iu.js';
import { mineEntityAttributes, extractConstraints } from './constraints/extract.js';
import { computeObligations } from './constraints/obligations.js';
import type { StructuredConstraint, BindingDefect } from './constraints/model.js';

export interface SpecProposal {
  kind: 'rewording' | 'informational' | 'no-confident-proposal';
  /** The spec file (relative path) and 1-based line this proposal edits. */
  doc: string;
  line: number;
  /** The exact spec line as it stands. */
  original: string;
  /** The proposed replacement line (rewording proposals only). */
  proposed?: string;
  /** What this proposal resolves: the defect subject or the obligation marker. */
  resolves: string;
  /** Why this rewording, in one sentence. */
  rationale: string;
  /** The re-extraction receipt: what the frozen extractor captures on the proposed line. */
  validation?: string;
  /** Other entities whose qualification also validates (the human disambiguates). */
  alternatives?: string[];
}

export interface SpecProposalInput {
  ius: ImplementationUnit[];
  canonNodes: CanonicalNode[];
  clauses: Clause[];
  /** Spec file contents by doc id (relative path) → raw lines. */
  specLines: Map<string, string[]>;
  /** Canon ids already tracked by a derived eval that ran to a verdict (status parity). */
  trackedByEval?: Set<string>;
}

// ─── validation: re-run the frozen extractor on the reworded line ─────────────

/** Mirror the canonical statement shape: no bullet marker, lowercased, no trailing period. */
function normalizeForValidation(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/\.\s*$/, '').trim().toLowerCase();
}

let syntheticSeq = 0;

function describe(c: StructuredConstraint): string {
  const { entity, attribute } = c.binding;
  const a = c.assertion;
  switch (a.kind) {
    case 'bound': return `${entity}.${attribute} (bound ${{ '<=': '≤', '>=': '≥', '<': '<', '>': '>', '==': '=' }[a.op] ?? a.op} ${a.value}${a.unit === 'chars' ? ' chars' : ''})`;
    case 'membership': return `${entity}.${attribute} (one of ${a.values.join(', ')})`;
    case 'presence': return `${entity}.${attribute} (required)`;
    case 'uniqueness': return `${entity}.${attribute} (unique)`;
    case 'reference': return `${entity} → ${a.target} (reference)`;
    case 'cardinality': return `${entity}.${a.relation ?? attribute} (${a.min !== undefined ? `≥ ${a.min}` : ''}${a.max !== undefined ? ` ≤ ${a.max}` : ''})`;
    case 'pattern': return `${entity}.${attribute} (${a.format})`;
    case 'temporal': return `${entity}.${attribute} (${a.mode})`;
    case 'temporal-relative': return `${entity}.${attribute} (${a.offsetDays}d after ${a.anchorEvent} → ${a.targetState})`;
    case 'expr': return `${entity}.${attribute} (expr)`;
  }
}

/**
 * The gate every proposal passes through: build a synthetic canon node from the
 * reworded line, re-mine entity attributes WITH that node present (a real re-run would
 * see it), and re-run the frozen extractor. Valid only when the line yields at least
 * one constraint and no defect. Returns the receipt for the human, or null.
 */
function validateRewording(
  proposedLine: string,
  ius: ImplementationUnit[],
  canonNodes: CanonicalNode[],
  clauses: Clause[],
): string | null {
  const syn: CanonicalNode = {
    canon_id: `proposal-${syntheticSeq++}`, type: CanonicalType.CONSTRAINT,
    statement: normalizeForValidation(proposedLine),
    source_clause_ids: [], linked_canon_ids: [], tags: [],
  } as unknown as CanonicalNode;
  const attrs = mineEntityAttributes(ius, [...canonNodes, syn], clauses);
  const { constraints, defects } = extractConstraints([syn], attrs);
  if (defects.length > 0 || constraints.length === 0) return null;
  return `re-extraction captures: ${constraints.map(describe).join('; ')}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rank validated qualifier entities by SECTION PROXIMITY — mechanical bindability is
 * not correctness ("Reference avatar characteristics" once validated on a soundtrack
 * line, because every qualifier binds). The entity that the surrounding section
 * actually talks about outranks the alphabet; an entity nobody mentions nearby scores
 * zero, and an all-zero field means NO confident proposal.
 */
function rankBySectionProximity<T extends { entity: string }>(
  candidates: T[],
  specLines: string[] | undefined,
  line1: number,
): { ranked: Array<T & { mentions: number }>; anyMentioned: boolean } {
  if (!specLines || specLines.length === 0 || line1 < 1) {
    return { ranked: candidates.map(c => ({ ...c, mentions: 0 })), anyMentioned: false };
  }
  const idx = Math.min(line1 - 1, specLines.length - 1);
  // The enclosing section: previous heading (inclusive) to next heading (exclusive).
  let start = 0, end = specLines.length;
  for (let i = idx; i >= 0; i--) if (/^#{1,6}\s/.test(specLines[i])) { start = i; break; }
  for (let i = idx + 1; i < specLines.length; i++) if (/^#{1,6}\s/.test(specLines[i])) { end = i; break; }

  const scored = candidates.map(c => {
    const re = new RegExp(`\\b${escapeRe(c.entity)}\\b`, 'i');
    let mentions = 0, nearest = Number.MAX_SAFE_INTEGER;
    for (let i = start; i < end; i++) {
      if (i === idx) continue; // the defect line itself doesn't vouch for a qualifier
      if (re.test(specLines[i])) { mentions++; nearest = Math.min(nearest, Math.abs(i - idx)); }
    }
    return { ...c, mentions, nearest };
  });
  scored.sort((a, b) => b.mentions - a.mentions || a.nearest - b.nearest || (a.entity < b.entity ? -1 : 1));
  return { ranked: scored, anyMentioned: scored.some(s => s.mentions > 0) };
}

/** A located spec line: the exact document line a canon statement lives on. */
interface LocatedLine { doc: string; line: number; rawLine: string }

/**
 * Resolve a canon node's statement to its EXACT spec line. Clauses are section-level
 * chunks (one clause spans a heading and its bullets), so the clause's own start line
 * usually is not the statement's line — find the bullet line inside the clause text
 * whose normalized form matches the statement. Falls back to the clause start.
 */
function resolveLine(
  canonId: string | undefined,
  statement: string,
  fallbackDoc: string | undefined,
  fallbackLine: number | undefined,
  canonById: Map<string, CanonicalNode>,
  clauseById: Map<string, Clause>,
  specLines: Map<string, string[]>,
): LocatedLine {
  const norm = (s: string) => normalizeForValidation(s);
  const want = norm(statement);
  const node = canonId ? canonById.get(canonId) : undefined;
  const clause = node?.source_clause_ids[0] ? clauseById.get(node.source_clause_ids[0]) : undefined;
  if (clause) {
    const lines = clause.raw_text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const got = norm(lines[i]);
      if (got && (got === want || got.includes(want) || want.includes(got))) {
        return { doc: clause.source_doc_id, line: clause.source_line_range[0] + i, rawLine: lines[i] };
      }
    }
  }
  // Fallback: the line number extraction recorded (clause start), read from the file.
  const doc = fallbackDoc ?? clause?.source_doc_id ?? '?';
  const line = fallbackLine ?? clause?.source_line_range[0] ?? 0;
  const rawLine = specLines.get(doc)?.[line - 1] ?? statement;
  return { doc, line, rawLine };
}

/**
 * A binding defect names a subject the graph can't place ("the room tension…" — no
 * entity). The deterministic repair: name the entity. We try every known entity, keep
 * every qualification the frozen extractor accepts, and surface the first (the receipt
 * shows the binding so the human can judge; alternatives are listed).
 */
function proposeForDefect(
  d: BindingDefect,
  input: SpecProposalInput,
  canonById: Map<string, CanonicalNode>,
  clauseById: Map<string, Clause>,
): SpecProposal {
  const { ius, canonNodes, clauses } = input;
  const loc = resolveLine(d.source.canon_id, d.source.statement, d.source.doc, d.source.line, canonById, clauseById, input.specLines);
  const original = loc.rawLine;
  const base: Omit<SpecProposal, 'kind'> = {
    doc: loc.doc, line: loc.line, original,
    resolves: `binding defect "${d.subject}" (${d.assertion.kind})`,
    rationale: '', validation: undefined,
  };

  // Where does the subject appear in the raw line? Insert the entity right before it.
  const subjRe = new RegExp(`\\b${escapeRe(d.subject.replace(/^(?:the|a|an)\s+/i, ''))}\\b`, 'i');
  const m = subjRe.exec(original);
  if (!m) {
    return { ...base, kind: 'no-confident-proposal',
      rationale: `the defect subject "${d.subject}" was not found in the spec line — no safe insertion point for an entity qualifier` };
  }
  const validated: Array<{ entity: string; proposed: string; receipt: string }> = [];
  for (const entity of [...mineEntityAttributes(ius, canonNodes, clauses).keys()].sort()) {
    if (new RegExp(`\\b${escapeRe(entity)}\\b`, 'i').test(original)) continue; // already named
    const proposed = `${original.slice(0, m.index)}${entity} ${original.slice(m.index)}`;
    const receipt = validateRewording(proposed, ius, canonNodes, clauses);
    if (receipt) validated.push({ entity, proposed, receipt });
  }
  if (validated.length === 0) {
    return { ...base, kind: 'no-confident-proposal',
      rationale: `qualifying the subject with each known entity (${[...mineEntityAttributes(ius, canonNodes, clauses).keys()].sort().join(', ') || 'none'}) never re-extracts cleanly — the spec likely needs a definition sentence for this attribute, not just a rewording` };
  }

  // Bindability found candidates; section proximity decides which one is CORRECT.
  const { ranked, anyMentioned } = rankBySectionProximity(validated, input.specLines.get(loc.doc), loc.line);
  if (!anyMentioned) {
    return { ...base, kind: 'no-confident-proposal',
      rationale: `every entity qualifier binds mechanically (${ranked.map(v => v.entity).join(', ')}), but none of them is mentioned anywhere in this section — the right entity is likely missing from the graph; name it by hand` };
  }
  const [first, ...rest] = ranked;
  return {
    ...base, kind: 'rewording', proposed: first.proposed, validation: first.receipt,
    rationale: `qualify the unbound subject "${d.subject}" with its entity ("${first.entity}", mentioned ${first.mentions}× in this section) so the frozen extractor can bind it`,
    alternatives: rest.filter(v => v.mentions > 0).map(v => `${v.entity} (${v.mentions}× nearby — ${v.receipt})`),
  };
}

// ─── strategy 2: canonicalize an obligation's cue phrase ──────────────────────

interface CueRewrite { name: string; pattern: RegExp; rewrite: (m: RegExpMatchArray) => string }

/** "daily or weekly" / "daily and weekly" / "daily, weekly, or monthly" → "daily, weekly". */
function listOf(text: string): string {
  return text.split(/\s*(?:,|\bor\b|\band\b)\s*/i).map(s => s.trim()).filter(Boolean).join(', ');
}

/**
 * The cue-canonicalization table. Each rule maps a normative shape the frozen rule
 * floor is known to MISS onto the canonical shape it captures. The table is safe by
 * construction: nothing ships unless validateRewording proves the reworded line
 * extracts — a bad rule simply never surfaces.
 */
const CUE_REWRITES: CueRewrite[] = [
  // bounds → "must not exceed N" / "must be at least N"
  { name: 'capped-at', pattern: /\bmust be capped at\b/i, rewrite: () => 'must not exceed' },
  { name: 'limited-to-number', pattern: /\bmust be limited to (\d[\d,]*)/i, rewrite: m => `must not exceed ${m[1]}` },
  { name: 'never-run-past', pattern: /\bmust never run past\b/i, rewrite: () => 'must not exceed' },
  { name: 'maximum-of', pattern: /\bhas a maximum of (\d[\d,]*)/i, rewrite: m => `must not exceed ${m[1]}` },
  // membership → "must be one of a, b"
  { name: 'can-only-be', pattern: /\bcan only be ([^.;]+)/i, rewrite: m => `must be one of ${listOf(m[1])}` },
  { name: 'must-always-be', pattern: /\bmust always be ([^.;]+)/i, rewrite: m => `must be one of ${listOf(m[1])}` },
  { name: 'restricted-to', pattern: /\bmust be restricted to ([^.;]+)/i, rewrite: m => `must be one of ${listOf(m[1])}` },
  { name: 'other-than-rejected', pattern: /\bother than ([^.;]+?) is rejected/i, rewrite: m => `must be one of ${listOf(m[1])}` },
  { name: 'outside-refused', pattern: /\boutside ([^.;]+?) must be refused/i, rewrite: m => `must be one of ${listOf(m[1])}` },
  { name: 'is-any-of', pattern: /\bis any of ([^.;]+)/i, rewrite: m => `must be one of ${listOf(m[1])}` },
  { name: 'must-be-either', pattern: /\bmust be either ([^.;]+)/i, rewrite: m => `must be one of ${listOf(m[1])}` },
  // uniqueness → "must be unique"
  { name: 'shall-not-repeat', pattern: /\bshall not repeat\b/i, rewrite: () => 'must be unique' },
  { name: 'never-appear-twice', pattern: /\bshould never appear twice\b/i, rewrite: () => 'must be unique' },
  { name: 'duplicate-rejected', pattern: /\bduplicate ([\w ]+?) are rejected\b/i, rewrite: m => `${m[1]} must be unique` },
  { name: 'cannot-share', pattern: /\btwo (\w+)s cannot share an? (\w+)/i, rewrite: m => `a ${m[1]} ${m[2]} must be unique` },
  { name: 'reject-a-second', pattern: /\breject a second (\w+) with an existing (\w+)/i, rewrite: m => `a ${m[1]} ${m[2]} must be unique` },
  // cardinality → "must have at least one …"
  { name: 'cannot-be-empty-of', pattern: /\bcannot be empty of ([\w ]+?)(?:\.|$)/i, rewrite: m => `must have at least one ${m[1]}` },
  { name: 'without-any-rejected', pattern: /\bwithout any ([\w ]+?) is rejected/i, rewrite: m => `must have at least one ${m[1]}` },
  { name: 'must-always-include', pattern: /\bmust always include an? ([\w ]+?)(?:\.|$)/i, rewrite: m => `must have at least one ${m[1]}` },
  { name: 'requires-at-least', pattern: /\brequires at least\b/i, rewrite: () => 'must have at least' },
  { name: 'no-fewer-than', pattern: /\b(?:shall carry|must hold) no fewer than\b/i, rewrite: () => 'must have at least' },
  { name: 'minimum-of', pattern: /\bincludes a minimum of\b/i, rewrite: () => 'must have at least' },
];

function proposeForObligation(
  o: { statement: string; marker: string; doc?: string; line?: number; canon_id?: string },
  input: SpecProposalInput,
  canonById: Map<string, CanonicalNode>,
  clauseById: Map<string, Clause>,
): SpecProposal {
  const { ius, canonNodes, clauses } = input;
  // Clause-level obligations (normative text no canon node covers) can span many lines
  // — a line-wise rewording is only meaningful on a single-sentence statement.
  if (!o.canon_id && o.statement.includes('\n')) {
    return {
      kind: 'no-confident-proposal', doc: o.doc ?? '?', line: o.line ?? 0, original: o.statement.split('\n')[0],
      resolves: `unverified obligation ("${o.marker}")`,
      rationale: 'normative clause spans multiple lines — a validated line-level rewording is not applicable; reword by hand',
    };
  }
  const loc = resolveLine(o.canon_id, o.statement, o.doc, o.line, canonById, clauseById, input.specLines);
  const original = loc.rawLine;
  const base: Omit<SpecProposal, 'kind'> = {
    doc: loc.doc, line: loc.line, original,
    resolves: `unverified obligation ("${o.marker}")`,
    rationale: '', validation: undefined,
  };
  for (const rule of CUE_REWRITES) {
    const m = rule.pattern.exec(original);
    if (!m) continue;
    const proposed = original.replace(rule.pattern, rule.rewrite(m));
    if (proposed === original) continue;
    const receipt = validateRewording(proposed, ius, canonNodes, clauses);
    if (receipt) {
      return {
        ...base, kind: 'rewording', proposed, validation: receipt,
        rationale: `canonicalize the cue ("${rule.name}") to a shape the frozen extractor captures — the obligation becomes a checkable constraint`,
      };
    }
  }
  return { ...base, kind: 'no-confident-proposal',
    rationale: `no cue canonicalization re-extracts cleanly — this sentence may need a new constraint kind, a durable eval, or a by-hand rewrite` };
}

// ─── informational: conflicting bounds (the spec contradicts itself) ──────────

function conflictingBounds(constraints: StructuredConstraint[]): SpecProposal[] {
  const byKey = new Map<string, StructuredConstraint[]>();
  for (const c of constraints) {
    if (c.assertion.kind !== 'bound') continue;
    const k = `${c.binding.entity}.${c.binding.attribute}|${c.assertion.op}`;
    byKey.set(k, [...(byKey.get(k) ?? []), c]);
  }
  const out: SpecProposal[] = [];
  for (const [k, group] of byKey) {
    const values = new Set(group.map(g => (g.assertion as { value: number }).value));
    if (values.size <= 1) continue;
    const [entityAttr] = k.split('|');
    const first = group[0];
    const lines = group.map(g => {
      const a = g.assertion as { op: string; value: number };
      return `  ${g.source.doc ?? '?'}:${g.source.line ?? '?'}  "${g.source.statement}"  (${a.op} ${a.value})`;
    });
    out.push({
      kind: 'informational',
      doc: first.source.doc ?? '?', line: first.source.line ?? 0,
      original: first.source.statement,
      resolves: `conflicting bounds on ${entityAttr}`,
      rationale: `the spec contradicts itself — no confident rewording exists; pick one value:\n${lines.join('\n')}`,
    });
  }
  return out;
}

// ─── the entry point ──────────────────────────────────────────────────────────

export function proposeSpecFixes(input: SpecProposalInput): SpecProposal[] {
  const { ius, canonNodes, clauses } = input;
  const clauseById = new Map(clauses.map(c => [c.clause_id, c]));
  const canonById = new Map(canonNodes.map(n => [n.canon_id, n]));
  const entityAttrs = mineEntityAttributes(ius, canonNodes, clauses);
  const { constraints, defects } = extractConstraints(canonNodes, entityAttrs, (cid) => {
    const c = clauseById.get(cid);
    return c ? { doc: c.source_doc_id, line: c.source_line_range[0], text: c.raw_text } : {};
  });
  const obligations = computeObligations(canonNodes, clauses, constraints, defects, input.trackedByEval ?? new Set())
    .filter(o => o.state === 'unverified');

  const proposals: SpecProposal[] = [];
  for (const d of defects) proposals.push(proposeForDefect(d, input, canonById, clauseById));
  for (const o of obligations) proposals.push(proposeForObligation(o, input, canonById, clauseById));
  proposals.push(...conflictingBounds(constraints));
  return proposals;
}

// ─── rendering: unified diffs grouped by file, with provenance ────────────────

/**
 * Render the proposals as unified-style hunks grouped by file, each with its
 * provenance (what it resolves, why, and the re-extraction receipt). The diff is for
 * the HUMAN to apply — phoenix never edits the spec. Application path: edit the spec,
 * re-run `phoenix canonicalize`, re-run `phoenix status`.
 */
export function renderSpecProposals(proposals: SpecProposal[]): string {
  const rewordings = proposals.filter(p => p.kind === 'rewording');
  const informational = proposals.filter(p => p.kind === 'informational');
  const noConfidence = proposals.filter(p => p.kind === 'no-confident-proposal');
  const out: string[] = [];

  const byDoc = new Map<string, SpecProposal[]>();
  for (const p of rewordings) byDoc.set(p.doc, [...(byDoc.get(p.doc) ?? []), p]);
  for (const [doc, group] of [...byDoc.entries()].sort()) {
    out.push(`--- a/${doc}`, `+++ b/${doc}`);
    for (const p of group.sort((a, b) => a.line - b.line)) {
      out.push(`@@ -${p.line},1 +${p.line},1 @@`,
        `-${p.original}`, `+${p.proposed}`,
        `# resolves: ${p.resolves}`,
        `# rationale: ${p.rationale}`,
        `# validation: ${p.validation}`);
      if (p.alternatives?.length) out.push(`# also validates with: ${p.alternatives.join(' | ')}`);
    }
    out.push('');
  }
  if (informational.length > 0) {
    out.push(`# ── informational (no confident rewording — the spec contradicts itself) ──`);
    for (const p of informational) out.push(`# ${p.resolves}\n${p.rationale}`, '');
  }
  if (noConfidence.length > 0) {
    out.push(`# ── no confident proposal (${noConfidence.length}) — flagged honestly, fix by hand ──`);
    for (const p of noConfidence) out.push(`# ${p.doc}:${p.line}  "${p.original.trim()}"\n#   ${p.resolves} — ${p.rationale}`);
    out.push('');
  }
  if (out.length === 0) out.push('# no spec proposals — nothing unbound, nothing unverified, nothing conflicting');
  return out.join('\n');
}
