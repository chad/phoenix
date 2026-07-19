/**
 * Phoenix Capability Suite — the honest, seeded Red/Green ledger.
 *
 * Each case asserts one capability the system claims (or should). GREEN cases are
 * proven and locked; RED cases are known-broken and documented — the backlog. The
 * red/green labels here were set by EMPIRICALLY PROBING the current code, not by
 * aspiration: a case is only green if it demonstrably passes today.
 *
 * When you fix a red, its case flips to a PROMOTION in the scorecard; change
 * `expect` to 'green' to lock the win. When a green breaks, it surfaces as a
 * REGRESSION and fails CI.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { CapabilityCase } from './harness.js';
import { parseSpec } from '../spec-parser.js';
import { diffClauses } from '../diff.js';
import { extractCanonicalNodes } from '../canonicalizer.js';
import { CanonicalType } from '../models/canonical.js';
import type { CanonicalNode } from '../models/canonical.js';
import { classifyChange } from '../classifier.js';
import { ChangeClass } from '../models/classification.js';
import { DiffType } from '../models/clause.js';
import { computeInvalidation, iuKey, dependentsToRegenerate } from '../invalidation.js';
import type { ImplementationUnit } from '../models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../models/iu.js';
import { checkBound, checkConstraint } from '../constraints/check.js';
import { checkConstraintAst } from '../constraints/check-ast.js';
import { extractBoundConstraints, extractConstraints, mineEntityAttributes } from '../constraints/extract.js';
import type { StructuredConstraint } from '../constraints/model.js';
import { deriveEvaluations, checkEvaluation, checkProperty } from '../evals.js';
import { runAggregateProperty } from '../constraints/exec-runner.js';
import { runGatedLiveEval, referenceApp, referencePlans, referenceFkApp, referenceFkSchema, referenceFkPlans, runGatedRelativeTemporal, referenceClockApp, type AppHandle, type PrepareResult, type RelativeTemporalSeed } from '../live-harness.js';
import { parseTableSchemas, seedForTarget, type SeedPlanInput } from '../live-seed.js';
import { bootSpecForTarget } from '../live-verify.js';
import { acceptProposal } from '../constraints/extract-llm.js';
import { synthesizeGuard, isMechanical } from '../repair-template.js';
import { Journal } from '../journal.js';
import { verdictOf } from '../models/validation.js';
import type { CheckMethod, CheckResult } from '../models/validation.js';
import { resolveTarget } from '../architectures/index.js';
import { extractFetchRoutes } from '../iu-deps.js';
import { parseSchema, checkModuleSchema } from '../schema-contract.js';
import { deriveSchema } from '../schema-plan.js';
import { buildPrompt } from '../llm/prompt.js';
import { runRepairLoop, routeFindings } from '../repair.js';
import type { RepairTarget, Repairer } from '../repair.js';
import { computeObligations, isObligation } from '../constraints/obligations.js';
import type { RepairFinding } from '../models/repair.js';

// ─── test-data helpers ───────────────────────────────────────────────────────

function iu(name: string, canonIds: string[] = [], deps: string[] = []): ImplementationUnit {
  return {
    iu_id: 'iu-' + name, kind: 'module', name, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: canonIds, dependencies: deps,
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: [`src/generated/${name}/${name}.ts`],
  };
}
function canon(type: CanonicalType, statement: string, id: string, clause = 'cl', tags: string[] = []): CanonicalNode {
  return { canon_id: id, type, statement, source_clause_ids: [clause], linked_canon_ids: [], tags } as unknown as CanonicalNode;
}
const boundConstraint = (): StructuredConstraint => ({
  constraint_id: 'x', binding: { entity: 'habit', attribute: 'name' },
  assertion: { kind: 'bound', op: '<=', value: 80, unit: 'chars' }, source: { statement: 's' },
});

// ─── the suite ───────────────────────────────────────────────────────────────

export const CAPABILITY_SUITE: CapabilityCase[] = [

  // ── ingestion ──
  {
    id: 'ingestion.formatting-invariant', capability: 'ingestion', tier: 'unit', expect: 'green',
    description: 'A whitespace-only spec edit produces no clause change.',
    run: () => {
      const before = parseSpec('# A\n\n## S\n\n- A habit name must not be empty\n', 'd.md');
      const after = parseSpec('# A\n\n## S\n\n- A habit   name must not   be empty\n', 'd.md');
      const changed = diffClauses(before, after).filter(d => d.diff_type !== DiffType.UNCHANGED && d.diff_type !== DiffType.MOVED);
      return { passed: changed.length === 0, detail: `${changed.length} non-trivial diffs (expected 0)` };
    },
  },

  // ── canonicalization ──
  {
    id: 'canonicalization.classifies-constraint-type', capability: 'canonicalization', tier: 'unit', expect: 'green',
    description: 'A "must not exceed" sentence is typed as a CONSTRAINT.',
    run: () => {
      const nodes = extractCanonicalNodes(parseSpec('# A\n\n## S\n\n- A habit name must not exceed 80 characters\n', 'd.md'));
      const hasConstraint = nodes.some(n => n.type === CanonicalType.CONSTRAINT);
      return { passed: hasConstraint, detail: hasConstraint ? 'CONSTRAINT node produced' : 'no CONSTRAINT node' };
    },
  },
  {
    id: 'canonicalization.standalone-bound-preserves-subject', capability: 'canonicalization', tier: 'unit', expect: 'green',
    description: 'A standalone bounded sentence keeps its subject noun in the canonical statement.',
    run: () => {
      const nodes = extractCanonicalNodes(parseSpec('# A\n\n## S\n\n- A habit name must not exceed 80 characters\n', 'd.md'))
        .filter(n => n.type === CanonicalType.CONSTRAINT);
      const ok = nodes.length > 0 && nodes.every(n => /habit|name/i.test(n.statement));
      return { passed: ok, detail: nodes.map(n => `"${n.statement}"`).join('; ') || 'no constraint node' };
    },
  },
  {
    id: 'canonicalization.compound-sentence-preserves-subject', capability: 'canonicalization', tier: 'unit', expect: 'green',
    description: 'A compound-sentence constraint keeps its subject on every fragment.',
    run: () => {
      const nodes = extractCanonicalNodes(parseSpec('# T\n\n## T\n\n- A tag label must not be empty and must not exceed 40 characters\n', 'd.md'))
        .filter(n => n.type === CanonicalType.CONSTRAINT || n.type === CanonicalType.INVARIANT);
      // Every constraint fragment should still name a domain noun (tag/label).
      const ok = nodes.length > 0 && nodes.every(n => /tag|label/i.test(n.statement));
      const subjectless = nodes.filter(n => !/tag|label/i.test(n.statement)).map(n => `"${n.statement}"`);
      return { passed: ok, detail: subjectless.length ? `subjectless fragment(s): ${subjectless.join(', ')}` : 'all fragments carry the subject' };
    },
  },

  // ── classification ──
  {
    id: 'classification.value-change-is-not-trivial', capability: 'classification', tier: 'unit', expect: 'green',
    description: 'Changing a numeric bound (80→60) classifies as a real change (not trivial A).',
    run: () => {
      const before = parseSpec('# A\n\n## S\n\n- A habit name must not exceed 80 characters\n', 'd.md');
      const after = parseSpec('# A\n\n## S\n\n- A habit name must not exceed 60 characters\n', 'd.md');
      const diff = diffClauses(before, after).find(d => d.diff_type === DiffType.MODIFIED);
      if (!diff) return { passed: false, detail: 'no MODIFIED diff produced' };
      const cls = classifyChange(diff, [], []).change_class;
      return { passed: cls !== ChangeClass.A, detail: `classified ${cls} (must not be A)` };
    },
  },
  {
    id: 'classification.formatting-is-trivial', capability: 'classification', tier: 'unit', expect: 'green',
    description: 'A whitespace-only change to a clause classifies as trivial (A) or is not a change at all.',
    run: () => {
      const before = parseSpec('# A\n\n## S\n\n- Users can archive a project\n', 'd.md');
      const after = parseSpec('# A\n\n## S\n\n- Users can   archive a project\n', 'd.md');
      const diffs = diffClauses(before, after);
      const nontrivial = diffs.filter(d => d.diff_type === DiffType.MODIFIED);
      if (nontrivial.length === 0) return { passed: true, detail: 'normalized to no change' };
      const cls = classifyChange(nontrivial[0], [], []).change_class;
      return { passed: cls === ChangeClass.A, detail: `classified ${cls}` };
    },
  },

  // ── selective invalidation ──
  {
    id: 'invalidation.classA-invalidates-nothing', capability: 'selective-invalidation', tier: 'unit', expect: 'green',
    description: 'A trivial (class A) change invalidates no IUs.',
    run: () => {
      const before = parseSpec('# A\n\n## S\n\n- A habit name must not be empty\n', 'd.md')[0];
      const diff = { diff_type: DiffType.MODIFIED, clause_id_before: before.clause_id, clause_id_after: before.clause_id, clause_before: before, clause_after: before };
      const nodes = [canon(CanonicalType.CONSTRAINT, 's', 'cn', before.clause_id)];
      const ius = [iu('habit', ['cn'])];
      const res = computeInvalidation({ changes: [{ diff: diff as never, classification: { change_class: ChangeClass.A, confidence: 1, signals: {} as never } }], canonNodes: nodes, ius });
      return { passed: res.stale.length === 0, detail: `${res.stale.length} stale (expected 0)` };
    },
  },
  {
    id: 'invalidation.single-clause-one-subtree', capability: 'selective-invalidation', tier: 'unit', expect: 'green',
    description: 'A class-B change to one clause marks exactly its IU stale, dependents to re-validate.',
    run: () => {
      const before = parseSpec('# A\n\n## S\n\n- A habit name must not exceed 80 characters\n', 'd.md')[0];
      const after = parseSpec('# A\n\n## S\n\n- A habit name must not exceed 60 characters\n', 'd.md')[0];
      const diff = { diff_type: DiffType.MODIFIED, clause_id_before: before.clause_id, clause_id_after: after.clause_id, clause_before: before, clause_after: after };
      const nodes = [canon(CanonicalType.CONSTRAINT, 's', 'cn', before.clause_id)];
      const habit = iu('habit', ['cn']);
      const dash = iu('dashboard', [], ['iu-habit']); // depends on habit
      const res = computeInvalidation({ changes: [{ diff: diff as never, classification: { change_class: ChangeClass.B, confidence: .8, signals: {} as never } }], canonNodes: nodes, ius: [habit, dash] });
      const staleKeys = res.stale.map(s => s.key);
      const revalKeys = res.revalidate.map(s => s.key);
      const ok = staleKeys.length === 1 && staleKeys[0] === iuKey(habit) && revalKeys.includes(iuKey(dash));
      return { passed: ok, detail: `stale=[${staleKeys}] revalidate=[${revalKeys}]` };
    },
  },

  // ── constraint enforcement (the SHACL-spine first shape family) ──
  {
    id: 'constraint.bound-absent-is-error', capability: 'constraint-enforcement', tier: 'unit', expect: 'green',
    description: 'A spec bound the code does NOT enforce is caught (absent), not a false green — the §1 fix.',
    run: () => {
      const r = checkBound(boundConstraint(), 'const S = z.object({ name: z.string().min(1) });');
      return { passed: r.result === 'absent' && verdictOf('static', r.result) === 'error', detail: `checker=${r.result}, verdict=${verdictOf('static', r.result)}` };
    },
  },
  {
    id: 'constraint.bound-wrong-is-error', capability: 'constraint-enforcement', tier: 'unit', expect: 'green',
    description: 'A spec bound the code enforces with the WRONG value is caught (violates).',
    run: () => {
      const r = checkBound(boundConstraint(), 'const S = z.object({ name: z.string().min(1).max(100) });');
      return { passed: r.result === 'violates' && r.found === 100, detail: `checker=${r.result}, found=${r.found}` };
    },
  },
  {
    id: 'constraint.unresolved-binding-is-defect', capability: 'constraint-enforcement', tier: 'unit', expect: 'green',
    description: 'A constraint whose subject binds to no known entity.attribute is a pre-codegen defect (the §1 mechanism).',
    run: () => {
      const attrs = mineEntityAttributes([iu('habit')], [canon(CanonicalType.DEFINITION, 'a habit has a name and a color', 'd')]);
      const { defects, constraints } = extractBoundConstraints([canon(CanonicalType.CONSTRAINT, 'the line must not exceed 80 characters', 'c', 'cl', ['line'])], attrs);
      return { passed: constraints.length === 0 && defects.length === 1, detail: `${defects.length} defect(s), ${constraints.length} bound` };
    },
  },
  {
    id: 'constraint.membership-kind-is-captured-and-checked', capability: 'constraint-enforcement', tier: 'unit', expect: 'green',
    description: 'An enum constraint is captured as a Membership constraint and statically checked against the code.',
    run: () => {
      const attrs = mineEntityAttributes([iu('habit')], [canon(CanonicalType.DEFINITION, 'a habit has a name and a cadence', 'd')]);
      const { constraints } = extractConstraints([canon(CanonicalType.CONSTRAINT, 'cadence must be one of daily, weekly', 'c', 'cl', ['cadence'])], attrs);
      const m = constraints.find(c => c.assertion.kind === 'membership');
      if (!m) return { passed: false, detail: 'membership constraint not captured' };
      // And the static checker distinguishes conforming from non-enforcing code.
      const good = checkConstraint(m, `const S = z.object({ cadence: z.enum(['daily','weekly']) });`);
      const bad = checkConstraint(m, `const S = z.object({ cadence: z.string() });`);
      return { passed: good.result === 'conforms' && bad.result === 'absent', detail: `bound=${m.binding.entity}.${m.binding.attribute}, good=${good.result}, bad=${bad.result}` };
    },
  },
  {
    id: 'constraint.pattern-kind-is-captured-and-checked', capability: 'constraint-enforcement', tier: 'unit', expect: 'green',
    description: 'A format constraint ("must be a valid email") is captured as a Pattern constraint and statically checked.',
    run: () => {
      const attrs = mineEntityAttributes([iu('customer')], [canon(CanonicalType.DEFINITION, 'a customer has an email and a name', 'd')]);
      const { constraints } = extractConstraints([canon(CanonicalType.CONSTRAINT, 'a customer email must be a valid email address', 'c', 'cl', ['email'])], attrs);
      const p = constraints.find(c => c.assertion.kind === 'pattern');
      if (!p) return { passed: false, detail: 'pattern constraint not captured' };
      const good = checkConstraint(p, `const S = z.object({ email: z.string().email() });`);
      const bad = checkConstraint(p, `const S = z.object({ email: z.string() });`);
      return { passed: good.result === 'conforms' && bad.result === 'absent', detail: `good=${good.result}, bad=${bad.result}` };
    },
  },
  {
    id: 'constraint.uniqueness-kind-is-captured-and-checked', capability: 'constraint-enforcement', tier: 'unit', expect: 'green',
    description: 'A uniqueness constraint ("email must be unique") is captured and statically checked for a UNIQUE declaration.',
    run: () => {
      const attrs = mineEntityAttributes([iu('customer')], [canon(CanonicalType.DEFINITION, 'a customer has an email and a name', 'd')]);
      const { constraints } = extractConstraints([canon(CanonicalType.CONSTRAINT, 'a customer email must be unique', 'c', 'cl', ['email'])], attrs);
      const u = constraints.find(c => c.assertion.kind === 'uniqueness');
      if (!u) return { passed: false, detail: 'uniqueness not captured' };
      const good = checkConstraint(u, 'CREATE TABLE customer (id INTEGER, email TEXT UNIQUE, name TEXT)');
      const bad = checkConstraint(u, 'CREATE TABLE customer (id INTEGER, email TEXT, name TEXT)');
      return { passed: good.result === 'conforms' && bad.result === 'absent', detail: `good=${good.result}, bad=${bad.result}` };
    },
  },
  {
    id: 'constraint.reference-kind-is-captured-and-checked', capability: 'constraint-enforcement', tier: 'unit', expect: 'green',
    description: 'A referential constraint ("must reference an existing account") is captured as a Reference constraint and checked for a FK / existence guard.',
    run: () => {
      const attrs = mineEntityAttributes([iu('transaction'), iu('account')], [canon(CanonicalType.DEFINITION, 'a transaction has an account and an amount', 'd')]);
      const { constraints } = extractConstraints([canon(CanonicalType.CONSTRAINT, 'a transaction must reference an existing account', 'c', 'cl', ['transaction', 'account'])], attrs);
      const r = constraints.find(c => c.assertion.kind === 'reference');
      if (!r) return { passed: false, detail: 'reference constraint not captured' };
      // Enforced by an app-level existence guard; unenforced when the FK is written blind.
      const good = checkConstraint(r, 'if (!db.prepare("SELECT id FROM accounts WHERE id = ?").get(account_id)) return err(400);');
      const bad = checkConstraint(r, 'db.prepare("INSERT INTO transactions (account_id) VALUES (?)").run(account_id);');
      const target = (r.assertion as { target: string }).target;
      return { passed: r.binding.entity === 'transaction' && target === 'account' && good.result === 'conforms' && bad.result === 'absent',
        detail: `bind=${r.binding.entity}→${target}, good=${good.result}, bad=${bad.result}` };
    },
  },
  {
    id: 'constraint.cardinality-kind-is-captured-and-checked', capability: 'constraint-enforcement', tier: 'unit', expect: 'green',
    description: 'A cardinality constraint ("an order must have at least one line item") is captured as a Cardinality constraint and checked for a non-empty / count guard.',
    run: () => {
      const attrs = mineEntityAttributes([iu('order')], [canon(CanonicalType.DEFINITION, 'an order has a total and line items', 'd')]);
      const { constraints } = extractConstraints([canon(CanonicalType.CONSTRAINT, 'an order must have at least one line item', 'c', 'cl', ['order', 'line', 'item'])], attrs);
      const r = constraints.find(c => c.assertion.kind === 'cardinality');
      if (!r) return { passed: false, detail: 'cardinality constraint not captured' };
      const good = checkConstraint(r, 'const S = z.object({ items: z.array(LineItem).min(1) });');
      const bad = checkConstraint(r, 'const S = z.object({ items: z.array(LineItem) });');
      return { passed: (r.assertion as { min?: number }).min === 1 && good.result === 'conforms' && bad.result === 'absent',
        detail: `min=${(r.assertion as { min?: number }).min}, good=${good.result}, bad=${bad.result}` };
    },
  },
  {
    id: 'constraint.expr-invariant-routed-to-oracle', capability: 'constraint-enforcement', tier: 'unit', expect: 'green',
    description: 'A relational invariant ("reject a debit that would take a balance below zero") is captured as an Expr constraint and routed to the executable oracle — CAUGHT when the guard is missing, conforms when present, and abstained (never false-green) when not statically reducible.',
    run: () => {
      const attrs = mineEntityAttributes([iu('account')], [canon(CanonicalType.DEFINITION, 'an account has a balance', 'd')]);
      const { constraints } = extractConstraints([canon(CanonicalType.CONSTRAINT, 'the system must reject a debit that would take an account balance below zero', 'c', 'cl', ['account', 'balance'])], attrs);
      const e = constraints.find(c => c.assertion.kind === 'expr');
      if (!e) return { passed: false, detail: 'expr invariant not captured' };
      const caught = checkConstraint(e, 'function debit(a, amount){ /* account balance */ a.balance -= amount; return a; }');
      const guarded = checkConstraint(e, 'function debit(a, amount){ if (a.balance - amount < 0) throw new Error("overdraft"); a.balance -= amount; }');
      const abstains = checkProperty('an account must be archived 90 days after its last transaction', 'function archive(){ /* ... */ }');
      return { passed: caught.result === 'violates' && guarded.result === 'conforms' && abstains.status === 'indeterminate',
        detail: `caught=${caught.result}, guarded=${guarded.result}, abstain=${abstains.status}` };
    },
  },
  {
    id: 'constraint.executable-aggregate-invariants-not-yet-proven', capability: 'constraint-enforcement', tier: 'unit', expect: 'green',
    description: 'A cross-entity aggregate invariant is PROVEN by execution (mutation-gated), caught when wrong — and the gate itself is honest: an eval too weak to kill planted bugs certifies nothing.',
    run: () => {
      const attrs = mineEntityAttributes([iu('dashboard'), iu('account')], [canon(CanonicalType.DEFINITION, 'a dashboard has a total', 'd')]);
      const { constraints } = extractConstraints([canon(CanonicalType.CONSTRAINT, 'the dashboard total must equal the sum of all account balances', 'c', 'cl', ['dashboard', 'total', 'account'])], attrs);
      const e = constraints.find(c => c.assertion.kind === 'expr');
      if (!e) return { passed: false, detail: 'expr invariant not captured' };
      // PROVEN by execution: randomized trials + the mutation gate (planted bugs must die).
      const correct = 'function total(accts){ return accts.reduce((s,a)=>s+a.balance,0); } // dashboard total = sum of account balances';
      const wrong = 'function total(accts){ return accts.reduce((s,a)=>s-a.balance,0); } // subtracts instead of summing';
      const proven = checkConstraint(e, correct);
      const caught = checkConstraint(e, wrong);
      return { passed: proven.result === 'conforms' && proven.method === 'behavioral-gated' && caught.result === 'violates',
        detail: `correct=${proven.result}(${proven.method ?? 'static'}), wrong=${caught.result}` };
    },
  },
  {
    id: 'constraint.temporal-kind-is-captured-and-checked', capability: 'constraint-enforcement', tier: 'unit', expect: 'green',
    description: 'A temporal constraint ("a transaction date must not occur in the future") is captured and checked for a not-future validator; a format-only refine does NOT count.',
    run: () => {
      const attrs = mineEntityAttributes([iu('transaction')], [canon(CanonicalType.DEFINITION, 'a transaction has an amount and a date', 'd')]);
      const { constraints } = extractConstraints([canon(CanonicalType.CONSTRAINT, 'a transaction date must not occur in the future', 'c', 'cl', ['transaction', 'date'])], attrs);
      const t = constraints.find(c => c.assertion.kind === 'temporal');
      if (!t) return { passed: false, detail: 'temporal constraint not captured' };
      const good = checkConstraint(t, `const S = z.object({ date: z.string().refine(isNotFuture, 'Date cannot be in the future') });`);
      const bad = checkConstraint(t, `const S = z.object({ date: z.string() });`);
      const trap = checkConstraint(t, `const S = z.object({ date: z.string().refine(isValidDate, 'Invalid date') });`); // format ≠ temporal
      return { passed: good.result === 'conforms' && bad.result === 'absent' && trap.result === 'absent',
        detail: `good=${good.result}, bad=${bad.result}, formatOnly=${trap.result}` };
    },
  },
  {
    id: 'constraint.presence-kind-is-captured-and-checked', capability: 'constraint-enforcement', tier: 'unit', expect: 'green',
    description: 'The quantifier-free required-fields form ("provide at least a name and an email") captures one Presence constraint per field, checked as required-and-non-optional.',
    run: () => {
      const attrs = mineEntityAttributes([iu('account')], [canon(CanonicalType.DEFINITION, 'an account has a name and an email', 'd')]);
      const { constraints } = extractConstraints([canon(CanonicalType.REQUIREMENT, 'the system requires a user to provide at least a name and an email to create an account', 'c', 'cl', ['account', 'name', 'email'])], attrs);
      const ps = constraints.filter(c => c.assertion.kind === 'presence');
      if (ps.length !== 2) return { passed: false, detail: `expected 2 presence constraints, got ${ps.length}` };
      const good = checkConstraint(ps[0], `const S = z.object({ name: z.string().min(1), owner_email: z.string().email() });`);
      const bad = checkConstraint(ps[0], `const S = z.object({ name: z.string().optional(), owner_email: z.string() });`);
      return { passed: good.result === 'conforms' && bad.result === 'absent',
        detail: `fields=[${ps.map(p => p.binding.attribute).join(',')}], good=${good.result}, optional=${bad.result}` };
    },
  },
  {
    id: 'intake.verified-llm-extraction-is-gated', capability: 'constraint-enforcement', tier: 'unit', expect: 'green',
    description: 'The verified-LLM second pass lifts paraphrase recall ONLY through a deterministic acceptance gate: a proposal grounded in the sentence (kind typechecks, binding resolves, literals present) is accepted; a hallucinated value, a binding to a non-existent attribute, and an unknown kind are all REJECTED — so wrong-capture stays 0 while recall rises.',
    run: () => {
      const attrs = mineEntityAttributes([iu('habit')], [canon(CanonicalType.DEFINITION, 'a habit has a name and a cadence', 'd')]);
      const good = acceptProposal({ kind: 'bound', entity: 'habit', attribute: 'name', params: { op: '<=', value: 80, unit: 'chars' } },
        'a habit name may be no more than 80 characters', attrs);
      const smuggled = acceptProposal({ kind: 'bound', entity: 'habit', attribute: 'name', params: { op: '<=', value: 100 } },
        'a habit name may be no more than 80 characters', attrs);           // value not in sentence
      const unbound = acceptProposal({ kind: 'membership', entity: 'habit', attribute: 'colour', params: { values: ['a', 'b'] } },
        'a habit colour is one of a, b', attrs);                            // colour is not a mined attribute
      const unknownKind = acceptProposal({ kind: 'wat', entity: 'habit', attribute: 'name' }, 'x', attrs);
      const ok = good.accepted && (good.accepted && good.constraint.assertion.kind === 'bound')
        && !smuggled.accepted && !unbound.accepted && !unknownKind.accepted;
      return { passed: ok, detail: `grounded=${good.accepted}, smuggledValue=${smuggled.accepted}, unboundAttr=${unbound.accepted}, unknownKind=${unknownKind.accepted}` };
    },
  },
  {
    id: 'oracle.live-app-property-evals-not-yet-run', capability: 'oracle', tier: 'unit', expect: 'green',
    description: 'An aggregate invariant on a module WITH external dependencies (a real DB + HTTP surface) is PROVEN by the live harness — boot the app, drive it, earn behavioral-gated conforms through the mutation gate — not refused as the sandbox runner must.',
    run: async () => {
      // The honest flip: the sandbox runner REFUSES a module that imports its world
      // (indeterminate: "needs the live app harness"). Here we prove the harness by
      // running it for real against a genuine app — a node:http server backed by a
      // genuine node:sqlite database (a module WITH external dependencies + state,
      // exactly the shape exec-runner cannot touch). We assert BOTH halves of the
      // contract: (a) the sandbox runner still refuses the dependency-carrying source,
      // and (b) the live harness earns a mutation-gated conforms by execution.
      const withDeps = `import { db } from '../../db.js';\nexport function total(){ return db.prepare('SELECT SUM(balance) AS s FROM accounts').get().s ?? 0; }`;
      const refused = runAggregateProperty({ agg: 'sum', field: 'balance' }, withDeps);

      const dir = mkdtempSync(join(tmpdir(), 'phx-eval-live-'));
      writeFileSync(join(dir, 'app.mjs'), referenceApp(), 'utf8');
      const { plan } = referencePlans().find(p => p.label === 'aggregate')!;
      const live = await runGatedLiveEval({
        bootSpec: { projectRoot: dir, command: ['node', 'app.mjs'], readyTimeoutMs: 12_000 },
        plan, targetFile: 'app.mjs',
      });
      const ok = refused.status === 'indeterminate'
        && live.status === 'pass' && live.gated && live.method === 'behavioral-gated' && live.mutantsApplicable > 0;
      return { passed: ok, detail: `sandbox=${refused.status} (refuses deps); live=${live.status}/${live.method} gated=${live.gated} (killed ${live.mutantsKilled}/${live.mutantsApplicable})` };
    },
  },
  {
    id: 'oracle.live-harness-mutation-gate-is-honest', capability: 'oracle', tier: 'unit', expect: 'green',
    description: 'The live harness NEVER certifies a broken app: a guard-stripped app fails the live eval (mutant killed by real execution) and a non-booting app abstains — behavioral-gated conforms is earned, never observed.',
    run: async () => {
      // Guard-stripped app: the overdraft guard is deleted → real execution must catch it.
      const broken = referenceApp().replace(/if \(balance < 0\).*\n/, '');
      const dirB = mkdtempSync(join(tmpdir(), 'phx-eval-live-b-'));
      writeFileSync(join(dirB, 'app.mjs'), broken, 'utf8');
      const state = referencePlans().find(p => p.label === 'state-nonneg')!;
      const brokenRes = await runGatedLiveEval({
        bootSpec: { projectRoot: dirB, command: ['node', 'app.mjs'], readyTimeoutMs: 12_000 },
        plan: state.plan, targetFile: 'app.mjs',
      });
      // Non-booting app: honest indeterminate, not a green.
      const dirN = mkdtempSync(join(tmpdir(), 'phx-eval-live-n-'));
      writeFileSync(join(dirN, 'app.mjs'), 'throw new Error("boom");\n', 'utf8');
      const noBoot = await runGatedLiveEval({
        bootSpec: { projectRoot: dirN, command: ['node', 'app.mjs'], readyTimeoutMs: 4000 },
        plan: referencePlans()[0].plan, targetFile: 'app.mjs',
      });
      const ok = brokenRes.status === 'fail' && !brokenRes.gated
        && noBoot.status === 'indeterminate' && !noBoot.gated;
      return { passed: ok, detail: `guardStripped=${brokenRes.status}(gated=${brokenRes.gated}), nonBoot=${noBoot.status}` };
    },
  },
  {
    id: 'oracle.multi-entity-live-seeding-earns-gated-verdicts', capability: 'oracle', tier: 'unit', expect: 'green',
    description: 'On a real MULTI-ENTITY app with a foreign key (transactions→accounts), the live oracle SEEDS the parent from the schema plan, threads its id into the child\'s create body, and earns behavioral-gated conforms — the exact multi-field/FK shape it abstained on before spec-aware seeding. Without the seeder the same eval honestly abstains, proving seeding is what closes the gap.',
    run: async () => {
      const dir = mkdtempSync(join(tmpdir(), 'phx-eval-seed-'));
      writeFileSync(join(dir, 'app.mjs'), referenceFkApp(), 'utf8');
      const input: SeedPlanInput = {
        tables: parseTableSchemas(referenceFkSchema()), constraints: [],
        routeFor: (t) => t === 'accounts' ? '/account' : t === 'transactions' ? '/transaction' : null,
      };
      const { plan, targetTable, governedField } = referenceFkPlans().find(p => p.label === 'aggregate')!;
      const prepare = async (app: AppHandle): Promise<PrepareResult> => {
        const r = await seedForTarget(app, input, targetTable, governedField);
        return r.ok ? { ok: true, seed: r.seed } : { ok: false, reason: r.reason };
      };
      const spec = { projectRoot: dir, command: ['node', 'app.mjs'] as const, readyTimeoutMs: 12_000 };
      const seeded = await runGatedLiveEval({ bootSpec: spec, plan, targetFile: 'app.mjs', prepare });
      const unseeded = await runGatedLiveEval({ bootSpec: spec, plan, targetFile: 'app.mjs' }); // no prepare → abstain
      const ok = seeded.status === 'pass' && seeded.gated && seeded.method === 'behavioral-gated' && seeded.mutantsApplicable > 0
        && unseeded.status === 'indeterminate' && !unseeded.gated;
      return { passed: ok, detail: `seeded=${seeded.status}/${seeded.method} gated=${seeded.gated} (killed ${seeded.mutantsKilled}/${seeded.mutantsApplicable}); unseeded=${unseeded.status}` };
    },
  },
  {
    id: 'oracle.temporal-relative-invariants-not-yet-proven', capability: 'oracle', tier: 'unit', expect: 'green',
    description: 'A relative-temporal state invariant ("archived 90 days after the last transaction") is CAPTURED as a temporal-relative assertion (offset + anchor + target state) and PROVEN by advancing an injectable clock in the live harness: seed an aged record and a recent one, boot with NOW past the boundary, assert the transition fired only for the aged record — mutation-gated (a boundary-stripped variant is killed). No longer abstained on.',
    run: async () => {
      // (a) The sentence is captured as its own assertion kind, bound to the state owner.
      const attrs = mineEntityAttributes([iu('account'), iu('transaction')], [canon(CanonicalType.DEFINITION, 'an account has a name', 'd')]);
      const { constraints } = extractConstraints([canon(CanonicalType.INVARIANT, 'an account must be archived 90 days after its last transaction', 'c', 'cl', ['account', 'transaction'])], attrs);
      const rel = constraints.find(c => c.assertion.kind === 'temporal-relative');
      const capturedOk = !!rel && rel.assertion.kind === 'temporal-relative' && rel.assertion.offsetDays === 90 && rel.binding.entity === 'account';
      // And statically it abstains (never a false green) — it needs the live clock eval.
      const staticAbstains = checkConstraint(rel!, 'function archive(a){ return a; }').result === 'indeterminate';

      // (b) PROVEN by advancing a clock: aged record archives past the 90d boundary, recent
      // one does not; a boundary-stripped mutant is killed. Real boot, real HTTP.
      const dir = mkdtempSync(join(tmpdir(), 'phx-eval-clock-'));
      writeFileSync(join(dir, 'app.mjs'), referenceClockApp(), 'utf8');
      const seed = async (app: AppHandle): Promise<RelativeTemporalSeed | null> => {
        const mkAcct = async (): Promise<number | null> => {
          const r = await app.fetch('/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"a"}' });
          return r.status === 201 ? (await r.json() as { id: number }).id : null;
        };
        const mkTxn = async (id: number, date: string): Promise<boolean> => {
          const r = await app.fetch('/transaction', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: id, date }) });
          return r.status === 201;
        };
        const agedId = await mkAcct(); const recentId = await mkAcct();
        if (agedId == null || recentId == null) return null;
        if (!(await mkTxn(agedId, '2020-01-01')) || !(await mkTxn(recentId, '2020-04-25'))) return null;
        return { agedId, recentId };
      };
      const live = await runGatedRelativeTemporal({
        bootSpec: { projectRoot: dir, command: ['node', 'app.mjs'], readyTimeoutMs: 12_000 },
        plan: { seedRoute: '/transaction', dateField: 'date', readRoutePrefix: '/account/', stateField: 'archived', offsetDays: 90 },
        targetFile: 'app.mjs', now: '2020-05-01', seed,
      });
      const ok = capturedOk && staticAbstains && live.status === 'pass' && live.gated && live.method === 'behavioral-gated' && live.mutantsApplicable > 0;
      return { passed: ok, detail: `captured=${capturedOk}, staticAbstains=${staticAbstains}, live=${live.status}/${live.method} gated=${live.gated} (killed ${live.mutantsKilled}/${live.mutantsApplicable})` };
    },
  },

  // ── provenance ──
  {
    id: 'provenance.journal-intact-verifies', capability: 'provenance', tier: 'unit', expect: 'green',
    description: 'An untampered journal verifies as an intact hash chain.',
    run: () => {
      const dir = mkdtempSync(join(tmpdir(), 'phx-eval-j1-'));
      let t = 0; const now = () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}.000Z`;
      const j = new Journal(dir);
      j.append({ type: 'ingest' }, now); j.append({ type: 'plan' }, now);
      const v = j.verify();
      return { passed: v.ok === true, detail: v.ok ? 'chain intact' : `broken@${v.brokenSeq}` };
    },
  },
  {
    id: 'provenance.journal-detects-tampering', capability: 'provenance', tier: 'unit', expect: 'green',
    description: 'A journal with a mutated event fails verification (tamper-evident).',
    run: async () => {
      const { writeFileSync, readFileSync } = await import('node:fs');
      const dir = mkdtempSync(join(tmpdir(), 'phx-eval-j2-'));
      let t = 0; const now = () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}.000Z`;
      const j = new Journal(dir);
      j.append({ type: 'regen', meta: { iu: 'a' } }, now); j.append({ type: 'regen', meta: { iu: 'b' } }, now);
      const path = join(dir, 'journal.jsonl');
      const lines = readFileSync(path, 'utf8').trim().split('\n');
      const first = JSON.parse(lines[0]); first.meta.iu = 'tampered'; lines[0] = JSON.stringify(first);
      writeFileSync(path, lines.join('\n') + '\n', 'utf8');
      const v = j.verify();
      return { passed: v.ok === false, detail: v.ok ? 'FAILED to detect tamper' : `detected@${v.brokenSeq}` };
    },
  },

  // ── the oracle ──
  {
    id: 'oracle.catches-dropped-field', capability: 'oracle', tier: 'unit', expect: 'green',
    description: 'The oracle flags code that dropped the constrained field entirely.',
    run: () => {
      const nodes = [canon(CanonicalType.INVARIANT, 'an order total must never be negative', 'cn', 'cl', ['order', 'total'])];
      const unit = iu('order', ['cn']);
      const evals = deriveEvaluations(unit, nodes);
      const inv = evals.find(e => e.binding === 'invariant')!;
      const r = checkEvaluation(inv, 'export function noop(){ return 1; }', new Map(nodes.map(n => [n.canon_id, n])));
      return { passed: r.status === 'fail', detail: `oracle=${r.status} (want fail on dropped field)` };
    },
  },
  {
    id: 'oracle.catches-logic-mutation', capability: 'oracle', tier: 'unit', expect: 'green',
    description: 'The oracle flags code that references the fields but violates the invariant (drops the enforcement).',
    run: () => {
      const nodes = [canon(CanonicalType.INVARIANT, 'an order total must never be negative', 'cn', 'cl', ['order', 'total'])];
      const unit = iu('order', ['cn']);
      const evals = deriveEvaluations(unit, nodes);
      const inv = evals.find(e => e.binding === 'invariant')!;
      // Buggy: mentions order+total but permits negative totals.
      const buggy = 'export function createOrder(o){ /* order total */ if (o.total < -1e9) throw new Error("x"); return o; }';
      const r = checkEvaluation(inv, buggy, new Map(nodes.map(n => [n.canon_id, n])));
      return { passed: r.status === 'fail', detail: `oracle=${r.status} on logic-buggy code (want fail; structural check says ${r.status})` };
    },
  },

  // ── regeneration ──
  {
    id: 'regeneration.dependents-are-regenerated', capability: 'regeneration', tier: 'unit', expect: 'green',
    description: 'When an IU\'s contract changes, its transitive dependents are scheduled for regeneration (not just flagged).',
    run: () => {
      const habit = iu('habit', ['cn']);
      const dashboard = iu('dashboard', [], ['iu-habit']);   // dashboard consumes habit
      const report = iu('report', [], ['iu-dashboard']);      // report consumes dashboard (transitive)
      const unrelated = iu('settings', []);
      const deps = dependentsToRegenerate(new Set(['iu-habit']), [habit, dashboard, report, unrelated]);
      const ok = deps.has('iu-dashboard') && deps.has('iu-report') && !deps.has('iu-settings') && !deps.has('iu-habit');
      return { passed: ok, detail: `dependents=[${[...deps].sort()}]` };
    },
  },

  {
    id: 'regeneration.http-dependencies-detected', capability: 'regeneration', tier: 'unit', expect: 'green',
    description: 'A module that calls another module over HTTP (fetch to a sibling route) is detected as depending on it.',
    run: () => {
      // The dashboard fetches the habit module's route; both quote styles + templates.
      const routes = extractFetchRoutes("await fetch('/habit', {method:'POST'}); await fetch(`/streak/${id}`); await fetch('/check-in');");
      const ok = routes.includes('habit') && routes.includes('streak') && routes.includes('check-in');
      return { passed: ok, detail: `routes=[${routes.sort()}]` };
    },
  },

  // ── retarget ──
  {
    id: 'retarget.distinct-runtimes-resolve', capability: 'retarget', tier: 'unit', expect: 'green',
    description: 'The same architecture resolves to distinct runtime targets (TS and Python) with distinct output paths.',
    run: () => {
      const ts = resolveTarget('web-api/node-typescript');
      const py = resolveTarget('web-api/python-fastapi');
      const ok = !!ts && !!py && ts.runtime.language !== py.runtime.language &&
        ts.runtime.outputPathFor('order') !== py.runtime.outputPathFor('order');
      return { passed: ok, detail: ok ? `${ts!.runtime.language} vs ${py!.runtime.language}` : 'targets did not resolve distinctly' };
    },
  },
  {
    id: 'retarget.cross-runtime-verdict-parity-not-yet-reached', capability: 'retarget', tier: 'unit', expect: 'green',
    description: 'The same constraint earns the same verdict on a python-fastapi (Pydantic) module as on a node-typescript (Zod) module — enforcement parity across runtimes, for the POSITIVE and the NEGATIVE verdicts alike: bound, membership, and presence each read conforms / violates / absent identically on either dialect (a per-runtime reader hook; the verdict rules never changed).',
    run: () => {
      const attrs = mineEntityAttributes([iu('account')], [canon(CanonicalType.DEFINITION, 'an account has a name and a status', 'd')]);
      const { constraints } = extractConstraints([
        canon(CanonicalType.CONSTRAINT, 'an account name must not exceed 60 characters', 'c1', 'cl', ['account', 'name']),
        canon(CanonicalType.CONSTRAINT, 'an account status must be one of active, archived', 'c2', 'cl', ['account', 'status']),
      ], attrs);
      const b = constraints.find(c => c.assertion.kind === 'bound')!;
      const m = constraints.find(c => c.assertion.kind === 'membership')!;
      // [zod source, pydantic source, the verdict BOTH must earn]
      const boundPairs: Array<[string, string, CheckResult]> = [
        ['const S = z.object({ name: z.string().max(60) });', 'class CreateAccount(BaseModel):\n    name: str = Field(max_length=60)', 'conforms'],
        ['const S = z.object({ name: z.string().max(100) });', 'class CreateAccount(BaseModel):\n    name: str = Field(max_length=100)', 'violates'],
        ['const S = z.object({ name: z.string() });', 'class CreateAccount(BaseModel):\n    name: str', 'absent'],
      ];
      for (const [zod, py, want] of boundPairs) {
        const zn = checkConstraint(b, zod).result, pv = checkConstraint(b, py).result;
        if (zn !== want || pv !== want) return { passed: false, detail: `bound parity broke — want ${want}, got zod=${zn} pydantic=${pv}` };
      }
      const memberPairs: Array<[string, string, CheckResult]> = [
        [`const S = z.object({ status: z.enum(['active','archived']) });`, "class CreateAccount(BaseModel):\n    status: Literal['active', 'archived']", 'conforms'],
        [`const S = z.object({ status: z.enum(['active','paused']) });`, "class CreateAccount(BaseModel):\n    status: Literal['active', 'paused']", 'violates'],
        ['const S = z.object({ status: z.string() });', 'class CreateAccount(BaseModel):\n    status: str', 'absent'],
      ];
      for (const [zod, py, want] of memberPairs) {
        const zn = checkConstraint(m, zod).result, pv = checkConstraint(m, py).result;
        if (zn !== want || pv !== want) return { passed: false, detail: `membership parity broke — want ${want}, got zod=${zn} pydantic=${pv}` };
      }
      // Presence parity through the AST dispatcher (the pipeline's actual path).
      const attrs2 = mineEntityAttributes([iu('account')], [canon(CanonicalType.DEFINITION, 'an account has a name and an email', 'd2')]);
      const { constraints: pres } = extractConstraints([canon(CanonicalType.REQUIREMENT, 'the system requires a user to provide at least a name and an email to create an account', 'c3', 'cl', ['account', 'name', 'email'])], attrs2);
      const p = pres.find(c => c.assertion.kind === 'presence')!;
      const presencePairs: Array<[string, string, CheckResult]> = [
        ['const S = z.object({ name: z.string().min(1) });', 'class CreateAccount(BaseModel):\n    name: str = Field(min_length=1)', 'conforms'],
        ['const S = z.object({ name: z.string().optional() });', 'class CreateAccount(BaseModel):\n    name: Optional[str] = None', 'absent'],
      ];
      for (const [zod, py, want] of presencePairs) {
        const zn = checkConstraintAst(p, zod).result, pv = checkConstraintAst(p, py).result;
        if (zn !== want || pv !== want) return { passed: false, detail: `presence parity broke — want ${want}, got zod=${zn} pydantic=${pv}` };
      }
      return { passed: true, detail: 'bound/membership/presence verdicts identical on Zod and Pydantic (conforms, violates, and absent alike)' };
    },
  },
  {
    id: 'oracle.live-verdicts-on-python-apps-not-yet-earned', capability: 'oracle', tier: 'unit', expect: 'red',
    redReason: 'Static checker parity is reached (the pydantic reader), but the LIVE oracle still speaks node only: `phoenix verify --live` hardcodes the boot (`npx tsx src/server.ts`) and the migrations path (`src/generated/_migrations.ts`), so a python-fastapi project cannot boot under the harness at all — no mutation-gated verdict is reachable on the python runtime. The mutation patterns themselves are mostly language-agnostic line shapes (a `< 0`/`SUM(` regex reads python too), but the boot seam is not. Fix: resolve the boot command + migrations path from the project\'s configured runtime target (uvicorn + `src/generated/_migrations.py` for python-fastapi, with DB_PATH isolation), and audit each mutation pattern for dialect coverage (e.g. a python guard short-circuits with `raise`, not `return`/`throw`).',
    description: 'The live oracle earns a mutation-gated verdict on a python-fastapi app the same way it does on node — the boot command, the migrations path, and every applicable mutation are resolved for the project\'s runtime, not hardcoded to node-typescript.',
    run: () => {
      // The probe is offline and honest: it asks the harness for the boot spec a
      // python-fastapi project would get. Today the answer is the node constants —
      // a python app could never boot from `npx tsx src/server.ts`.
      const py = bootSpecForTarget('python-fastapi');
      const node = bootSpecForTarget('web-api/node-typescript');
      const bootParity = py.command.some(p => /uvicorn|python/.test(p)) && /_migrations\.py$/.test(py.migrationsFile)
        && node.command.some(p => /tsx|node/.test(p)) && /_migrations\.ts$/.test(node.migrationsFile);
      return { passed: bootParity, detail: `python boot=[${py.command.join(' ')}] migrations=${py.migrationsFile} (want uvicorn + _migrations.py)` };
    },
  },

  // ── schema-first generation (prevention) ──
  {
    id: 'generation.schema-is-shared-before-modules', capability: 'generation', tier: 'unit', expect: 'green',
    description: 'The shared schema is derived from entities/constraints (independent of any module) and injected VERBATIM into a module prompt — the drift → runtime-500 class is prevented at the source, not merely caught.',
    run: () => {
      const nodes = [
        canon(CanonicalType.DEFINITION, 'an account has a name and an email', 'd1'),
        canon(CanonicalType.CONSTRAINT, 'a transaction must reference an existing account', 'c1', 'cl', ['transaction', 'account']),
      ];
      const plan = deriveSchema([iu('account', ['d1']), iu('transaction', ['c1'])], nodes, []);
      if (!plan) return { passed: false, detail: 'no schema plan derived' };
      const prompt = buildPrompt(iu('transaction', ['c1']), nodes, undefined, undefined, undefined, undefined, { sharedSchema: plan.ddl });
      const ok = plan.model.tables.has('accounts')
        && plan.model.tables.get('transactions')?.has('account_id') === true
        && plan.regions.every(r => r.iu_id === 'schema-plan')   // owned by the pre-plan, not a module
        && /Shared database schema \(FROZEN/.test(prompt)
        && prompt.includes('CREATE TABLE') && prompt.includes('accounts');
      return { passed: ok, detail: `tables=[${[...plan.model.tables.keys()]}], promptHasFrozenDDL=${/FROZEN/.test(prompt)}` };
    },
  },

  // ── the repair loop (findings feed regeneration) ──
  {
    id: 'repair.findings-route-to-targeted-regeneration', capability: 'repair', tier: 'unit', expect: 'green',
    description: 'A verifier finding routes to its owning IU and drives a targeted regeneration that reaches green; the loop is bounded, journaled, and never edits the frozen verifier (proven with a scripted repairer).',
    run: async () => {
      const schema = parseSchema('CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, name TEXT)');
      let source = "export function q(id){ return db.prepare('SELECT * FROM account WHERE id = ?').get(id); }";
      const target: RepairTarget = { id: 'iu-txn', file: 'txn.ts', iu: iu('txn') };
      const verify = (): RepairFinding[] =>
        checkModuleSchema('txn.ts', source, schema).map(f => ({
          category: 'schema', iu_id: 'iu-txn', file: 'txn.ts', subject: f.ref,
          message: f.detail, action: f.suggestion ? `use "${f.suggestion}"` : 'align',
        }));
      const routed = routeFindings(verify(), [target]);
      const hash = (s: string) => createHash('sha256').update(s).digest('hex');
      const result = await runRepairLoop({
        targets: [target], verify,
        readSource: () => source,
        writeSource: (_t, s) => { source = s; },
        artifactHash: () => hash(source),
        // Scripted repairer: applies the finding's suggested name to MODULE source only.
        repairer: (_t, findings, src) => {
          let out = src;
          for (const f of findings) { const m = f.action.match(/use "([a-z_]+)"/); if (m) out = out.replace(/\baccount\b/g, m[1]); }
          return out;
        },
      });
      const ok = routed.byTarget.has('iu-txn') && routed.unroutable.length === 0
        && result.green && result.stop === 'green' && result.rounds.length === 1
        && result.rounds[0].regenerated.includes('iu-txn')
        && verify().length === 0;
      return { passed: ok, detail: `routed=${routed.byTarget.has('iu-txn')}, green=${result.green}, rounds=${result.rounds.length}, residual=${result.residual.length}` };
    },
  },

  // ── deterministic guard synthesis (repair's last mile) ──
  {
    id: 'repair.template-synthesis-closes-mechanical-findings', capability: 'repair', tier: 'unit', expect: 'green',
    description: 'A mechanical constraint the LLM left unenforced is closed DETERMINISTICALLY: the synthesized guard is the frozen checker\'s exact inverse, so absent/violates flips to conforms — no model, and the verifier is untouched (only the generated code changes).',
    run: () => {
      // Cardinality — the exact NIGHT-REPORT-3 residual (afterimage's "deck ≥ 30 cards").
      const attrs = mineEntityAttributes([iu('deck')], [canon(CanonicalType.DEFINITION, 'a deck has cards', 'd')]);
      const { constraints } = extractConstraints([canon(CanonicalType.CONSTRAINT, 'a deck must have at least 30 cards', 'c', 'cl', ['deck', 'card'])], attrs);
      const card = constraints.find(c => c.assertion.kind === 'cardinality');
      if (!card) return { passed: false, detail: 'cardinality constraint not captured' };
      const before = 'const S = z.object({ cards: z.array(Card) });';
      const beforeVerdict = checkConstraint(card, before).result;   // absent (frozen checker)
      const after = synthesizeGuard(card, before);                  // deterministic guard synthesis
      const afterVerdict = after ? checkConstraint(card, after).result : 'indeterminate';
      // Bound too: absent .max flips to conforms; and a NON-mechanical kind is refused.
      const boundC = boundConstraint();
      const boundAfter = synthesizeGuard(boundC, 'const S = z.object({ name: z.string().min(1) });');
      const boundOk = !!boundAfter && checkConstraint(boundC, boundAfter).result === 'conforms';
      return { passed: beforeVerdict === 'absent' && afterVerdict === 'conforms' && boundOk && isMechanical(card),
        detail: `cardinality ${beforeVerdict}→${afterVerdict}; bound→${boundOk ? 'conforms' : 'unfixed'}` };
    },
  },

  {
    id: 'repair.loop-convergence-invariants-hold', capability: 'repair', tier: 'unit', expect: 'green',
    description: 'The repair loop is convergence-safe under an OSCILLATING repairer (fixes one finding, breaks another — the afterimage stall): it always TERMINATES within the budget and the finding count NEVER increases round over round (a worsening round is rolled back), so it can never thrash toward a false green.',
    run: async () => {
      const schema = parseSchema('CREATE TABLE accounts (id INTEGER PRIMARY KEY); CREATE TABLE entries (id INTEGER PRIMARY KEY)');
      let src = "q(){ db.prepare('SELECT * FROM account').all(); db.prepare('SELECT * FROM entries').all(); }";
      const target: RepairTarget = { id: 'iu-mod', file: 'mod.ts', iu: iu('mod') };
      const verify = () => checkModuleSchema('mod.ts', src, schema).map(f => ({
        category: 'schema' as const, iu_id: 'iu-mod', file: 'mod.ts', subject: f.ref, message: f.detail,
        action: f.suggestion ? `use "${f.suggestion}"` : 'align',
      }));
      // Oscillate: apply the suggestion, then sabotage a currently-correct reference.
      const oscillate: Repairer = (_t, findings, s) => {
        let out = s;
        for (const f of findings) { const m = f.action.match(/use "([a-z_]+)"/); if (m) out = out.replace(new RegExp(`\\b${m[1].replace(/s$/, '')}\\b`, 'g'), m[1]); }
        return out.replace(/\bentries\b/, 'entrie');
      };
      const result = await runRepairLoop({
        targets: [target], verify, readSource: () => src, writeSource: (_t, s) => { src = s; },
        artifactHash: () => createHash('sha256').update(src).digest('hex'), repairer: oscillate, maxRounds: 5,
      });
      const nonIncreasing = result.rounds.every(r => r.findingsAfter <= r.findingsBefore);
      const terminated = result.rounds.length <= 5 && ['stalled', 'green', 'budget'].includes(result.stop);
      return { passed: nonIncreasing && terminated, detail: `stop=${result.stop}, rounds=${result.rounds.length}, nonIncreasing=${nonIncreasing}` };
    },
  },
  {
    id: 'intake.hostile-specs-never-crash-or-drop', capability: 'ingestion', tier: 'unit', expect: 'green',
    description: 'Hostile spec input (unicode / RTL / emoji / non-ASCII digits, a homonym entity, contradictory bounds) never crashes the intake and never silently drops a normative sentence — every normative node is surfaced as a constraint, defect, or flagged obligation.',
    run: () => {
      let threw = false, silent = 0, constraints = 0;
      try {
        const clauses = parseSpec('# X ☕\n\n## Rules\n\n- A widget name must not exceed ٥ characters 🙃\n- A ‮weird‬ widget status must be one of 日本, français\n- A widget name must be at least 20 characters\n', 'h.md');
        const nodes = extractCanonicalNodes(clauses);
        const attrs = mineEntityAttributes([iu('widget')], nodes, clauses);
        const ex = extractConstraints(nodes, attrs);
        constraints = ex.constraints.length;
        const obl = computeObligations(nodes, clauses.map(c => ({ clause_id: (c as { clause_id: string }).clause_id, normalized_text: (c as { normalized_text: string }).normalized_text })), ex.constraints, ex.defects, new Set());
        const surfaced = new Set(obl.map(o => o.statement.trim().toLowerCase()));
        for (const n of nodes) if (isObligation(n.statement) && !surfaced.has(n.statement.trim().toLowerCase())) silent++;
      } catch { threw = true; }
      return { passed: !threw && silent === 0, detail: `threw=${threw}, silentDrops=${silent}, constraints=${constraints}` };
    },
  },

  // ── schema contract (cross-module coherence) ──
  {
    id: 'schema.cross-module-contract-mismatches-are-caught', capability: 'schema-contract', tier: 'unit', expect: 'green',
    description: 'A module whose SQL disagrees with the migration schema (singular/plural table, phantom column, broken FK) is caught statically — the compile-green runtime-500 class.',
    run: () => {
      const ddl = `CREATE TABLE IF NOT EXISTS adventurers (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY, adventurer_id INTEGER REFERENCES adventurer(id), cleared INTEGER);`;
      const schema = parseSchema(ddl);
      const badTable = checkModuleSchema('m.ts', `db.prepare('SELECT * FROM adventurer WHERE id = ?').get(id);`, schema);
      const badColumn = checkModuleSchema('m.ts', `const sql = "SELECT 1 FROM entries WHERE entries.status = 'cleared'";`, schema);
      const brokenFk = checkModuleSchema('_migrations.ts', ddl, schema);
      const healthy = checkModuleSchema('m.ts', `db.prepare('SELECT entries.cleared FROM entries JOIN adventurers ON entries.adventurer_id = adventurers.id').all();`, schema);
      const jsSafe = checkModuleSchema('m.ts', `const entries = await res.json(); const n = entries.map(e => e.id).length;`, schema);
      const ok = badTable.length === 1 && badTable[0].suggestion === 'adventurers'
        && badColumn.length === 1 && badColumn[0].ref === 'entries.status'
        && brokenFk.some(f => f.kind === 'broken-fk')
        && healthy.length === 0 && jsSafe.length === 0;
      return { passed: ok, detail: `table=${badTable.length}, column=${badColumn.length}, fk=${brokenFk.length}, falsePositives=${healthy.length + jsSafe.length}` };
    },
  },

  // ── the trust surface's own honesty ──
  {
    id: 'trust.verdict-never-false-green', capability: 'trust-surface', tier: 'unit', expect: 'green',
    description: 'The verdict function never returns OK for a static violation or a static absence.',
    run: () => {
      const bad: Array<[CheckMethod, CheckResult]> = [['static', 'violates'], ['static', 'absent'], ['behavioral', 'violates']];
      const leaked = bad.filter(([m, r]) => verdictOf(m, r) === 'ok');
      return { passed: leaked.length === 0, detail: leaked.length ? `leaked OK on ${JSON.stringify(leaked)}` : 'no false greens across the matrix' };
    },
  },
  {
    id: 'trust.behavioral-ok-is-withheld', capability: 'trust-surface', tier: 'unit', expect: 'green',
    description: 'A behavioral/property "conforms" is withheld from OK (degrades to incomplete) until a per-eval mutation gate exists.',
    run: () => {
      const ok = verdictOf('property', 'conforms') === 'incomplete' && verdictOf('behavioral', 'conforms') === 'incomplete';
      return { passed: ok, detail: `property/conforms → ${verdictOf('property', 'conforms')} (want incomplete)` };
    },
  },
];

/** Stable content id of the suite (which cases exist) — for artifact diffing. */
export function suiteHash(): string {
  return createHash('sha256').update(CAPABILITY_SUITE.map(c => `${c.id}:${c.expect}`).sort().join('\n')).digest('hex').slice(0, 12);
}
