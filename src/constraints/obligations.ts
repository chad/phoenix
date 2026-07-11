/**
 * Obligation detection — the recall guard against SILENT coverage loss.
 *
 * A normative spec sentence ("an account balance can't dip under zero") that the
 * rule-based extractor cannot turn into a structured constraint used to vanish
 * without a trace: no constraint, no diagnostic, no evidence it was ever promised.
 * That is a system-level false green — the spec made a promise and `status` does not
 * even know it exists. This module makes every normative sentence VISIBLE: downstream
 * it is either captured as a checkable constraint / tracked eval, or FLAGGED as an
 * unverified obligation. Never silent.
 *
 * The detector is deliberately lexical and conservative: it recognizes the imperative
 * markers of an obligation (must / never / only / at least / unique / valid / …) and
 * nothing else. A non-normative sentence ("users like fast dashboards") carries no
 * marker and is not an obligation — it raises nothing. Fidelity over recall: a marker
 * that is present but incidental is a tolerable (visible) over-flag; a missed
 * obligation is a silent false green, which is the failure this module forbids.
 */

import type { CanonicalNode } from '../models/canonical.js';
import type { StructuredConstraint, BindingDefect } from './model.js';

/**
 * The normative markers. Order matters only for which name is reported first
 * ("must not" before the bare "must"). Each is matched on a word boundary so a
 * marker embedded in a larger word ("validation", "requirements") does not spuriously
 * fire — except where the inflected forms are deliberately enumerated (reject/require).
 */
const MARKERS: { re: RegExp; name: string }[] = [
  { re: /\bmust not\b/i, name: 'must not' },
  { re: /\bmust\b/i, name: 'must' },
  { re: /\bnever\b/i, name: 'never' },
  { re: /\bcannot\b/i, name: 'cannot' },
  { re: /\bcan['’]t\b/i, name: "can't" },
  { re: /\balways\b/i, name: 'always' },
  { re: /\bonly\b/i, name: 'only' },
  { re: /\bshall\b/i, name: 'shall' },
  { re: /\bshould\b/i, name: 'should' },
  { re: /\breject(?:s|ed|ing)?\b/i, name: 'reject' },
  { re: /\brequire(?:s|d|ment|ments)?\b/i, name: 'require' },
  { re: /\bat least\b/i, name: 'at least' },
  { re: /\bat most\b/i, name: 'at most' },
  { re: /\bunique(?:ly|ness)?\b/i, name: 'unique' },
  { re: /\bvalid\b/i, name: 'valid' },
];

/**
 * The first normative marker carried by `text`, or null if the sentence is not
 * normative. The returned name is the human-readable marker (for the diagnostic).
 */
export function normativeMarker(text: string): string | null {
  for (const m of MARKERS) if (m.re.test(text)) return m.name;
  return null;
}

/** Whether a sentence carries any normative marker (i.e. is an obligation). */
export function isObligation(text: string): boolean {
  return normativeMarker(text) !== null;
}

/** How an obligation was resolved by the trust surface. */
export type ObligationState = 'verified' | 'unverified';

export interface Obligation {
  /** The verbatim normative sentence. */
  statement: string;
  /** The marker that made it an obligation (for the diagnostic detail). */
  marker: string;
  /** verified = produced a checkable constraint or a tracked eval; unverified = silent-risk. */
  state: ObligationState;
  /** Provenance for a diagnostic, when the obligation is a canonical node. */
  canon_id?: string;
  /** Source doc / line, when known. */
  doc?: string;
  line?: number;
}

/** The minimal clause shape the ledger needs (kept structural to stay test-friendly). */
export interface ClauseLike {
  clause_id: string;
  normalized_text: string;
  source_doc_id?: string;
  source_line_range?: [number, number];
}

/**
 * The obligation ledger. Given the canonical graph, the raw clauses, and everything
 * the trust surface already TRACKS (structured constraints, binding defects, and the
 * canon_ids covered by a derived eval that ran to a pass/fail verdict), return every
 * normative sentence with its resolved state. An obligation is:
 *
 *   - verified   — it produced a structured constraint (any of the 7 kinds), a binding
 *                  defect (already a diagnostic), or a derived eval that actually ran;
 *   - unverified — it produced NONE of those: silent coverage loss unless surfaced.
 *
 * `trackedByEval` is the eval-derived tracking set (computed by the caller, which owns
 * the IU sources); constraints + defects are folded in here. Pure and total: every
 * normative node and every normative orphan clause appears exactly once (deduped by
 * sentence text), so the caller can gate `silent = 0`.
 */
export function computeObligations(
  canonNodes: CanonicalNode[],
  clauses: ClauseLike[],
  constraints: StructuredConstraint[],
  defects: BindingDefect[],
  trackedByEval: ReadonlySet<string>,
): Obligation[] {
  const tracked = new Set<string>(trackedByEval);
  for (const c of constraints) if (c.source.canon_id) tracked.add(c.source.canon_id); // a structured constraint
  for (const d of defects) if (d.source.canon_id) tracked.add(d.source.canon_id);      // a binding defect (already a diagnostic)

  const out: Obligation[] = [];
  const seen = new Set<string>();
  const add = (statement: string, marker: string, state: ObligationState, canon_id?: string, doc?: string, line?: number) => {
    const key = statement.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ statement, marker, state, canon_id, doc, line });
  };

  const clauseById = new Map(clauses.map(c => [c.clause_id, c]));

  // Primary: every normative canonical node, resolved against the tracked set.
  for (const n of canonNodes) {
    const marker = normativeMarker(n.statement);
    if (!marker) continue;
    const loc = clauseById.get(n.source_clause_ids[0]);
    add(n.statement, marker, tracked.has(n.canon_id) ? 'verified' : 'unverified', n.canon_id, loc?.source_doc_id, loc?.source_line_range?.[0]);
  }

  // Recall net: a normative raw clause that produced NO canonical node at all was
  // dropped before extraction could see it — the deepest silent loss. (Clauses that
  // DID produce nodes are handled above; excluded here to avoid double counting.)
  const coveredClauses = new Set<string>();
  for (const n of canonNodes) for (const cid of n.source_clause_ids) coveredClauses.add(cid);
  for (const c of clauses) {
    if (coveredClauses.has(c.clause_id)) continue;
    const marker = normativeMarker(c.normalized_text);
    if (!marker) continue;
    add(c.normalized_text, marker, 'unverified', undefined, c.source_doc_id, c.source_line_range?.[0]);
  }

  return out;
}
