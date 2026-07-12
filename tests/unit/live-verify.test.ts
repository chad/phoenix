/**
 * Unit: live-verification plan derivation (the pure part — no boot).
 *
 * Proves that the wiring derives the right live evals from a project's constraints and
 * routes them to the owning module file, without depending on an LLM or a running app.
 * The booting/mutation-gate half is proven in tests/e2e/live-harness.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { deriveProjectLivePlans, routeSlug } from '../../src/live-verify.js';
import type { StructuredConstraint } from '../../src/constraints/model.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

function iu(name: string): ImplementationUnit {
  return {
    iu_id: 'iu-' + name, kind: 'module', name, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: [], dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: [`src/generated/${name}/${name}.ts`],
  };
}
const con = (entity: string, attribute: string, assertion: StructuredConstraint['assertion']): StructuredConstraint =>
  ({ constraint_id: `c-${entity}-${attribute}`, binding: { entity, attribute }, assertion, source: { statement: 's' } });

describe('live-verify: plan derivation', () => {
  it('slugs entity names to their mounted route prefix', () => {
    expect(routeSlug('Account')).toBe('/account');
    expect(routeSlug('Deck Card')).toBe('/deck-card');
  });

  it('derives a temporal (not-future) eval routed to the owning module', () => {
    const evals = deriveProjectLivePlans(
      [con('transaction', 'date', { kind: 'temporal', mode: 'not-future' })],
      [iu('transaction'), iu('account')],
    );
    const t = evals.find(e => e.plan.kind === 'temporal');
    expect(t).toBeTruthy();
    expect(t!.targetFile).toBe('src/generated/transaction/transaction.ts');
    expect((t!.plan as { writeRoute: string }).writeRoute).toBe('/transaction');
    expect((t!.plan as { dateField: string }).dateField).toBe('date');
  });

  it('derives a state non-negativity eval from a "below zero" expr invariant', () => {
    const evals = deriveProjectLivePlans(
      [con('account', 'balance', { kind: 'expr', statement: 'the system must reject a debit that would take an account balance below zero' })],
      [iu('account')],
    );
    const s = evals.find(e => e.plan.kind === 'state-nonneg');
    expect(s).toBeTruthy();
    expect((s!.plan as { field: string }).field).toBe('balance');
    expect(s!.targetFile).toBe('src/generated/account/account.ts');
  });

  it('does not derive an eval for a constraint whose entity has no module (honest skip)', () => {
    const evals = deriveProjectLivePlans(
      [con('room', 'tension', { kind: 'expr', statement: 'the room tension must not exceed 12' })],
      [iu('account')], // no room module
    );
    expect(evals).toEqual([]);
  });
});
