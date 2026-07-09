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
import { mkdtempSync } from 'node:fs';
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
import { extractBoundConstraints, extractConstraints, mineEntityAttributes } from '../constraints/extract.js';
import type { StructuredConstraint } from '../constraints/model.js';
import { deriveEvaluations, checkEvaluation } from '../evals.js';
import { Journal } from '../journal.js';
import { verdictOf } from '../models/validation.js';
import type { CheckMethod, CheckResult } from '../models/validation.js';
import { resolveTarget } from '../architectures/index.js';
import { extractDependencies } from '../dep-extractor.js';

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
    id: 'constraint.relational-kinds-not-yet-implemented', capability: 'constraint-enforcement', tier: 'unit', expect: 'red',
    redReason: 'Bound, Membership, and Pattern are implemented; Uniqueness, Reference (FK), and Cardinality are not yet extracted or checked, so "email must be unique" / "must reference an existing X" / "at least one line item" remain invisible to the structured layer. Fix: continue implementing kinds from the algebra (docs/PROPOSAL-constraint-algebra.md §5) with their lowering + static checker.',
    description: 'A uniqueness constraint ("email must be unique") is captured as a structured constraint.',
    run: () => {
      const attrs = mineEntityAttributes([iu('customer')], [canon(CanonicalType.DEFINITION, 'a customer has an email', 'd')]);
      const { constraints } = extractConstraints([canon(CanonicalType.CONSTRAINT, 'a customer email must be unique', 'c', 'cl', ['email'])], attrs);
      const captured = constraints.some(c => (c.assertion as { kind: string }).kind === 'uniqueness');
      return { passed: captured, detail: captured ? 'uniqueness captured' : 'uniqueness dropped — kind not implemented' };
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
    id: 'regeneration.http-dependencies-detected', capability: 'regeneration', tier: 'unit', expect: 'red',
    redReason: 'IU→IU dependencies are derived from relative code imports only. A module that consumes another over HTTP (a fetch to a sibling route, as the generated web UIs do) creates no import edge, so the dependency is invisible — the consumer is neither flagged nor regenerated when the producer\'s contract changes. This is the remaining half of the momentum dashboard-broke bug (contract-aware dependent regen is now wired, but the dependency itself is undetected). Fix: also derive dependencies from sibling-route/fetch targets, not just imports.',
    description: 'A module that calls another module over HTTP is detected as depending on it.',
    run: () => {
      const g = extractDependencies("const res = await fetch('/habit', { method: 'POST', body });", 'dashboard.ts');
      const detected = g.imports.some(i => i.is_relative && /habit/.test(i.source));
      return { passed: detected, detail: detected ? 'http dependency detected' : 'fetch to a sibling module is not detected as a dependency (only imports are)' };
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
