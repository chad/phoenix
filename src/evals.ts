/**
 * Durable Evaluation Generator — the oracle (Phase 5).
 *
 * "If you don't know how you would evaluate regenerated code, regeneration is
 *  reckless. If you do know, regeneration is conservative." Phoenix regenerated
 * code but generated no evaluations, so by its own principles it was improvising.
 * This derives durable, boundary-level evaluations from the canonical graph —
 * the behavioral intent that any implementation must satisfy — and checks them
 * against the generated module. The evals are bound to canonical nodes and
 * survive reimplementation (they assert observable behavior, not internals).
 *
 * Each canonical node becomes one or more Evaluations with given/when/then:
 *   CONSTRAINT  → a failure-mode eval (the forbidden input is rejected)
 *   INVARIANT   → an invariant eval (a property that must always hold)
 *   REQUIREMENT → a domain-rule eval (the capability is present)
 *   contract IO → a boundary-contract eval (the shape is exported)
 *
 * The structural check is deterministic and needs no database: it verifies the
 * generated module actually exposes the constrained fields / operations. It is a
 * modest oracle — it will not catch every behavioral bug — but it catches the
 * class that matters most for regeneration: a regenerated module that silently
 * drops a required field, operation, or validation.
 */

import { createHash } from 'node:crypto';
import type { ImplementationUnit } from './models/iu.js';
import type { CanonicalNode } from './models/canonical.js';
import { CanonicalType } from './models/canonical.js';
import type { Evaluation } from './models/evaluation.js';
import { extractTerms } from './canonicalizer.js';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Domain nouns worth checking a module references (drop generic verbs/stopwords). */
const GENERIC = new Set([
  'the', 'system', 'user', 'users', 'must', 'should', 'can', 'allow', 'allows',
  'provide', 'create', 'update', 'delete', 'manage', 'a', 'an', 'and', 'or', 'of',
  'to', 'be', 'is', 'are', 'with', 'for', 'that', 'this', 'not', 'never', 'always',
  'every', 'each', 'their', 'its', 'have', 'has',
]);

function keyTerms(statement: string): string[] {
  return extractTerms(statement).filter(t => !GENERIC.has(t) && t.length > 2);
}

/**
 * Derive durable evaluations for an IU from its canonical nodes + contract.
 */
export function deriveEvaluations(
  iu: ImplementationUnit,
  canonNodes: CanonicalNode[],
  now: () => string = () => new Date().toISOString(),
): Evaluation[] {
  const evals: Evaluation[] = [];
  const nodes = canonNodes.filter(n => iu.source_canon_ids.includes(n.canon_id) && n.type !== CanonicalType.CONTEXT);
  const created_at = now();

  const push = (
    canon: CanonicalNode,
    binding: Evaluation['binding'],
    assertion: string,
    given: string, when: string, then: string,
  ) => {
    const eval_id = sha256(['eval', iu.iu_id, binding, canon.canon_id, assertion].join('\x00')).slice(0, 16);
    evals.push({
      eval_id, name: assertion.slice(0, 60), iu_id: iu.iu_id, binding,
      origin: 'specified', assertion, given, when, then,
      canon_ids: [canon.canon_id], conservation: binding === 'boundary_contract',
      rationale: `Derived from ${canon.type} "${canon.statement.slice(0, 60)}"`,
      created_at, last_status: 'untested',
    });
  };

  for (const node of nodes) {
    const terms = keyTerms(node.statement);
    switch (node.type) {
      case CanonicalType.CONSTRAINT:
        push(node, 'failure_mode',
          `${iu.name} rejects input violating: ${node.statement.slice(0, 50)}`,
          `a request to ${iu.name}`, `the input violates "${node.statement.slice(0, 40)}"`,
          `the operation is rejected with an error`);
        break;
      case CanonicalType.INVARIANT:
        push(node, 'invariant',
          `${iu.name} maintains: ${node.statement.slice(0, 50)}`,
          `any sequence of operations on ${iu.name}`, `the state is observed`,
          `the property "${node.statement.slice(0, 40)}" holds`);
        break;
      case CanonicalType.REQUIREMENT:
        push(node, 'domain_rule',
          `${iu.name} supports: ${node.statement.slice(0, 50)}`,
          `a valid request`, `the capability is exercised`,
          `the expected outcome is produced`);
        break;
      case CanonicalType.DEFINITION:
        if (terms.length > 0) {
          push(node, 'boundary_contract',
            `${iu.name} exposes the ${terms[0]} shape`,
            `the ${iu.name} module`, `its contract is inspected`,
            `it defines ${terms.slice(0, 3).join(', ')}`);
        }
        break;
    }
  }

  // A boundary-contract eval per declared contract output (the shape consumers depend on).
  for (const output of iu.contract.outputs) {
    const eval_id = sha256(['eval', iu.iu_id, 'boundary_contract', 'output', output].join('\x00')).slice(0, 16);
    if (evals.some(e => e.eval_id === eval_id)) continue;
    evals.push({
      eval_id, name: `${iu.name} returns ${output}`, iu_id: iu.iu_id,
      binding: 'boundary_contract', origin: 'specified',
      assertion: `${iu.name} produces a ${output} at its boundary`,
      given: `a valid request to ${iu.name}`, when: `it completes`, then: `a ${output} is returned`,
      canon_ids: iu.source_canon_ids, conservation: true,
      rationale: 'Derived from IU contract output', created_at, last_status: 'untested',
    });
  }

  return evals;
}

export interface EvalCheckResult {
  eval_id: string;
  /**
   * pass = the property is enforced; fail = enforcement is missing/wrong; the
   * oracle CAUGHT the defect. indeterminate = the property is not statically
   * checkable and the oracle honestly abstains (it must NEVER return `pass` for a
   * property it did not verify — that is the false-green the §1-family forbids).
   */
  status: 'pass' | 'fail' | 'indeterminate';
  reason: string;
}

/**
 * Behavioral check for a property-asserting evaluation (invariant / failure_mode).
 * Recognizes the structured shapes it can actually verify against the module source
 * — non-negativity, numeric bounds, enums, non-empty — and returns a real verdict.
 * For a property it cannot reduce to a checkable shape, it returns `indeterminate`
 * rather than a false pass. This is what makes the oracle catch a logic mutation:
 * code that merely mentions the fields but drops the enforcement fails here.
 */
export function checkProperty(statement: string, source: string): { status: 'pass' | 'fail' | 'indeterminate'; reason: string } {
  const s = statement.toLowerCase();
  const terms = keyTerms(statement);
  const refsField = terms.some(t => source.toLowerCase().includes(t) || source.toLowerCase().includes(t.replace(/s$/, '')));

  // ── non-negativity: "must never be negative", "non-negative", ">= 0", and the
  //    relational overdraft shape "would take/go below zero" / "go negative" ──
  const nonNeg =
    (/\bnegative\b/.test(s) && /\b(?:not|never|non|cannot|can't|no)\b/.test(s)) ||
    /\bbelow\s+(?:zero|0)\b/.test(s) ||
    /\bgo(?:es)?\s+negative\b/.test(s);
  if (nonNeg) {
    if (!refsField) return { status: 'fail', reason: 'invariant field not referenced (enforcement dropped)' };
    // The 0-floor guard must be about the CONSTRAINED quantity — not any unrelated
    // numeric comparison in the module (a stray `conditions.length > 0` must NOT read
    // as a balance guard, or the surface false-greens). Identify the guarded noun (the
    // word before the negativity cue) and require a 0-comparison or field floor
    // co-located with it. Fall back to a strict field floor when the noun is unknown.
    const cueIdx = s.search(/below\s+(?:zero|0)|negative/);
    // The guarded noun is the content word before the cue — skipping the linking
    // verb the canonicalizer may leave there ("balance never BECOMES negative").
    const LINKING = new Set(['be', 'becomes', 'become', 'goes', 'go', 'falls', 'fall', 'turns', 'turn', 'gets', 'get', 'stays', 'stay', 'remains', 'remain', 'dips', 'dip', 'drops', 'drop']);
    const subject = cueIdx >= 0
      ? [...s.slice(0, cueIdx).split(/[^a-z]+/).filter(Boolean)].reverse().find(w => w.length > 2 && !GENERIC.has(w) && !LINKING.has(w))
      : undefined;
    const src = source.toLowerCase();
    const near = (needle: RegExp): boolean => {
      if (!subject) return false;
      for (const m of src.matchAll(needle)) {
        const at = m.index ?? 0;
        if (src.slice(Math.max(0, at - 80), at + 6).includes(subject)) return true;
      }
      return false;
    };
    const floor = /\.min\(\s*0\s*\)|\.nonnegative\(|\.gte\(\s*0\s*\)/g;
    const enforced = subject
      ? (near(/[<>]=?\s*0\b/g) || near(floor))
      : /\.min\(\s*0\s*\)|\.nonnegative\(|\.gte\(\s*0\s*\)/.test(source);
    return enforced
      ? { status: 'pass', reason: `non-negativity of "${subject ?? 'value'}" enforced (a 0-floor guard is co-located)` }
      : { status: 'fail', reason: `no 0-floor guard protects "${subject ?? 'the value'}" against going below 0 on this path` };
  }

  // ── non-empty: "must not be empty" ──
  if (/\bempty\b/.test(s) && /\b(?:not|never|cannot|can't|no)\b/.test(s)) {
    if (!refsField) return { status: 'fail', reason: 'field not referenced (enforcement dropped)' };
    const enforced = /\.min\(\s*[1-9]\d*\s*\)|\.nonempty\(|\.length\s*[<>=!]|!==\s*['"]['"]|length\s*(?:>|>=|===?\s*0)/.test(source);
    return enforced
      ? { status: 'pass', reason: 'non-empty enforced' }
      : { status: 'fail', reason: 'references the field but does not reject empty' };
  }

  // ── numeric bound: "must not exceed N" / "at least N" ──
  const b = statement.match(/(?:must not exceed|no more than|at most|maximum(?:\s+of)?|up to|<=|≤)\s+(\d+)|(?:at least|no fewer than|minimum(?:\s+of)?|>=|≥)\s+(\d+)/i);
  if (b) {
    if (!refsField) return { status: 'fail', reason: 'field not referenced (enforcement dropped)' };
    const n = b[1] ?? b[2];
    const method = b[1] !== undefined ? 'max' : 'min';
    const enforced = new RegExp(`\\.${method}\\(\\s*${n}\\b`).test(source);
    return enforced
      ? { status: 'pass', reason: `.${method}(${n}) present` }
      : { status: 'fail', reason: `references the field but no .${method}(${n}) bound` };
  }

  // ── enum: "must be one of a, b" / "either a or b" ──
  const en = s.match(/(?:one of|any of|either)\s*:?\s+(.+)/);
  if (en) {
    const vals = en[1].replace(/[.;].*$/, '').split(/\s*,\s*|\s+or\s+|\s+and\s+/).map(v => v.trim().replace(/^['"]|['"]$/g, '')).filter(v => /^[a-z0-9_-]+$/.test(v));
    if (vals.length >= 2) {
      const enforced = /z\.enum\(|z\.literal\(/.test(source) && vals.some(v => source.toLowerCase().includes(`'${v}'`) || source.toLowerCase().includes(`"${v}"`));
      return enforced
        ? { status: 'pass', reason: 'enum enforced' }
        : { status: 'fail', reason: 'value set not enforced as an enum/literal union' };
    }
  }

  // Not reducible to a checkable shape — abstain honestly (never a false pass).
  return { status: 'indeterminate', reason: 'property is not statically checkable (needs an executable/behavioral eval)' };
}

/**
 * Structurally check an evaluation against the generated module source. This is
 * the deterministic oracle: for constraint/definition/boundary evals it verifies
 * the module references the constrained domain terms (a regenerated module that
 * dropped the field fails); for others it verifies the module is non-trivial
 * (not an unimplemented stub). It never claims more than it checks.
 */
export function checkEvaluation(
  evaluation: Evaluation,
  moduleSource: string,
  canonById: Map<string, CanonicalNode>,
): EvalCheckResult {
  const src = moduleSource.toLowerCase();

  // A stub (throws "not implemented") satisfies no behavioral eval.
  if (/not implemented|todo|throw new error\(['"]stub/i.test(moduleSource) && moduleSource.length < 400) {
    return { eval_id: evaluation.eval_id, status: 'fail', reason: 'module is an unimplemented stub' };
  }

  // Property-asserting evals (invariant / failure_mode) get a REAL enforcement
  // check, not term-matching. checkProperty catches a logic mutation (code that
  // mentions the fields but drops the enforcement) and abstains (indeterminate)
  // when the property isn't statically checkable — it never false-greens.
  if (evaluation.binding === 'invariant' || evaluation.binding === 'failure_mode') {
    const statements = evaluation.canon_ids.map(cid => canonById.get(cid)?.statement).filter((x): x is string => !!x);
    const statement = statements.join('. ') || evaluation.assertion;
    const r = checkProperty(statement, moduleSource);
    return { eval_id: evaluation.eval_id, status: r.status, reason: r.reason };
  }

  // Collect the domain terms this eval is about.
  const terms = new Set<string>();
  for (const cid of evaluation.canon_ids) {
    const node = canonById.get(cid);
    if (node) for (const t of keyTerms(node.statement)) terms.add(t);
  }

  if (terms.size === 0) {
    // No specific terms to check — require only that the module has real content.
    return moduleSource.trim().length > 120
      ? { eval_id: evaluation.eval_id, status: 'pass', reason: 'module has substantive content' }
      : { eval_id: evaluation.eval_id, status: 'fail', reason: 'module is effectively empty' };
  }

  // The module must reference at least one of the eval's domain terms (singular or
  // plural). A regenerated module that dropped the field/operation fails here.
  const referenced = [...terms].filter(t => src.includes(t) || src.includes(t.replace(/s$/, '')) || src.includes(t + 's'));
  if (referenced.length > 0) {
    return { eval_id: evaluation.eval_id, status: 'pass', reason: `references ${referenced.slice(0, 3).join(', ')}` };
  }
  return { eval_id: evaluation.eval_id, status: 'fail', reason: `module does not reference any of: ${[...terms].slice(0, 4).join(', ')}` };
}
