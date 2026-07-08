/**
 * Selective Invalidation — Phoenix's defining capability (PRD §0).
 *
 *   "Changing one spec line invalidates only the dependent subtree —
 *    not the entire repository."
 *
 * Given the classified clause changes from an ingest, this computes exactly
 * which Implementation Units are stale and why, by walking the provenance
 * chain the graphs already encode:
 *
 *   changed clause ──(source_clause_ids)──▶ canonical nodes
 *                  ──(source_canon_ids)───▶ Implementation Units
 *                  ──(dependencies)────────▶ dependent IUs (re-validate)
 *
 * A directly-affected IU needs REGENERATION (its requirements changed). An IU
 * that only *depends* on a changed IU needs RE-VALIDATION (typecheck + boundary
 * + tests), not regeneration — matching the cascade semantics of PRD §11.
 *
 * Class A (trivial/formatting) changes invalidate nothing: identity is intent,
 * and a whitespace edit carries no intent. Everything else invalidates.
 *
 * IUs are keyed by a STABLE key (name, falling back to output path) rather than
 * iu_id, because the current iu_id embeds canonical content hashes and so
 * changes whenever a statement is reworded. Keying on the domain name lets a
 * stale mark survive re-canonicalization and re-planning, so a later selective
 * regen can still find its target. (Phase 3 makes node identity itself stable.)
 */

import type { ClauseDiff } from './models/clause.js';
import { DiffType } from './models/clause.js';
import type { CanonicalNode } from './models/canonical.js';
import type { ImplementationUnit } from './models/iu.js';
import type { ChangeClassification } from './models/classification.js';
import { ChangeClass } from './models/classification.js';

export interface InvalidationCause {
  /** The changed clause (before-id for modified/removed; after-id for added). */
  clause_id: string;
  doc_id?: string;
  change_class: ChangeClass;
  /** Canonical nodes whose source is this clause. */
  canon_ids: string[];
}

export interface StaleIU {
  /** Stable key: the IU's domain name (what `phoenix regen --iu=` matches). */
  key: string;
  iu_id: string;
  iu_name: string;
  reason: 'directly_affected' | 'dependent';
  /** Human-readable provenance chain, e.g. "spec/auth.md L10 [C] → R-PASSWORD → AuthIU". */
  cause_chain: string;
  /** For dependents: the upstream stale IU this one hangs off. */
  via?: string;
}

export interface InvalidationResult {
  /** IUs needing regeneration (their requirements changed). */
  stale: StaleIU[];
  /** IUs needing re-validation only (transitive dependents of stale IUs). */
  revalidate: StaleIU[];
  /** ADDED/REMOVED clauses imply canonicalization may add/drop nodes & IUs. */
  canon_stale: boolean;
  causes: InvalidationCause[];
}

/** The stable regen key for an IU: its name, else its first output path. */
export function iuKey(iu: ImplementationUnit): string {
  return iu.name || iu.output_files[0] || iu.iu_id;
}

export interface InvalidationInput {
  /** Clause diffs paired with their classification (same order/length). */
  changes: Array<{ diff: ClauseDiff; classification: ChangeClassification }>;
  /** Canonical graph as it stood BEFORE this change (references old clause ids). */
  canonNodes: CanonicalNode[];
  /** IUs as they stood before this change. */
  ius: ImplementationUnit[];
  /** Optional map clause_id → doc_id for readable cause chains. */
  clauseDocs?: Map<string, string>;
  /** Optional map clause_id → 1-based start line for readable cause chains. */
  clauseLines?: Map<string, number>;
}

/**
 * Compute the invalidation set for a batch of classified clause changes.
 */
export function computeInvalidation(input: InvalidationInput): InvalidationResult {
  const { canonNodes, ius } = input;

  // Index: clause_id → canon nodes that cite it as source.
  const canonByClause = new Map<string, CanonicalNode[]>();
  for (const n of canonNodes) {
    for (const cid of n.source_clause_ids) {
      (canonByClause.get(cid) ?? canonByClause.set(cid, []).get(cid)!).push(n);
    }
  }
  // Index: canon_id → IUs that cite it as source.
  const iusByCanon = new Map<string, ImplementationUnit[]>();
  for (const iu of ius) {
    for (const cid of iu.source_canon_ids) {
      (iusByCanon.get(cid) ?? iusByCanon.set(cid, []).get(cid)!).push(iu);
    }
  }

  const causes: InvalidationCause[] = [];
  let canonStale = false;

  // directly-affected IU key → the cause chain string that first reached it.
  const directIUs = new Map<string, StaleIU>();

  for (const { diff, classification } of input.changes) {
    const cls = classification.change_class;
    if (diff.diff_type === DiffType.UNCHANGED) continue;
    if (cls === ChangeClass.A) continue; // trivial: no intent changed, no invalidation.

    // ADDED/REMOVED reshape the graph — canonicalization must re-run.
    if (diff.diff_type === DiffType.ADDED || diff.diff_type === DiffType.REMOVED) {
      canonStale = true;
    }

    // The clause id the CURRENT canon graph knows about.
    const clauseId = diff.clause_id_before ?? diff.clause_id_after;
    if (!clauseId) continue;

    const affectedCanon = canonByClause.get(clauseId) ?? [];
    causes.push({
      clause_id: clauseId,
      doc_id: input.clauseDocs?.get(clauseId),
      change_class: cls,
      canon_ids: affectedCanon.map(n => n.canon_id),
    });

    const loc = locLabel(clauseId, input);
    for (const canon of affectedCanon) {
      const affectedIUs = iusByCanon.get(canon.canon_id) ?? [];
      for (const iu of affectedIUs) {
        const key = iuKey(iu);
        if (!directIUs.has(key)) {
          const canonLabel = shorten(canon.statement) || canon.canon_id.slice(0, 8);
          directIUs.set(key, {
            key,
            iu_id: iu.iu_id,
            iu_name: iu.name,
            reason: 'directly_affected',
            cause_chain: `${loc} [${cls}] → ${canonLabel} → ${iu.name}`,
          });
        }
      }
    }
  }

  // Transitive dependents of directly-affected IUs → re-validate (not regenerate).
  const directIds = new Set([...directIUs.values()].map(s => s.iu_id));
  const revalidate = computeDependents(directIUs, ius, directIds);

  return {
    stale: [...directIUs.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    revalidate,
    canon_stale: canonStale,
    causes,
  };
}

/** Walk the IU dependency graph to find dependents of the directly-affected set. */
function computeDependents(
  direct: Map<string, StaleIU>,
  ius: ImplementationUnit[],
  directIds: Set<string>,
): StaleIU[] {
  // dependents[X] = IUs that import X (X appears in their `dependencies`).
  const dependents = new Map<string, ImplementationUnit[]>();
  for (const iu of ius) {
    for (const depId of iu.dependencies) {
      (dependents.get(depId) ?? dependents.set(depId, []).get(depId)!).push(iu);
    }
  }
  const iuById = new Map(ius.map(iu => [iu.iu_id, iu]));

  const result = new Map<string, StaleIU>();
  const queue: Array<{ id: string; viaName: string }> = [...direct.values()].map(s => ({ id: s.iu_id, viaName: s.iu_name }));
  const seen = new Set<string>(directIds);

  while (queue.length > 0) {
    const { id, viaName } = queue.shift()!;
    for (const dependent of dependents.get(id) ?? []) {
      if (seen.has(dependent.iu_id)) continue;
      seen.add(dependent.iu_id);
      const key = iuKey(dependent);
      result.set(key, {
        key,
        iu_id: dependent.iu_id,
        iu_name: dependent.name,
        reason: 'dependent',
        cause_chain: `depends on ${viaName} → re-validate ${dependent.name}`,
        via: viaName,
      });
      queue.push({ id: dependent.iu_id, viaName: dependent.name });
    }
  }
  void iuById;
  return [...result.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function locLabel(clauseId: string, input: InvalidationInput): string {
  const doc = input.clauseDocs?.get(clauseId);
  const line = input.clauseLines?.get(clauseId);
  if (doc && line) return `${doc} L${line}`;
  if (doc) return doc;
  return `clause ${clauseId.slice(0, 8)}`;
}

function shorten(s: string, n = 48): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n) + '…' : clean;
}
