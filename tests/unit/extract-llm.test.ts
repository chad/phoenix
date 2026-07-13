/**
 * The verified-LLM acceptance gate (P1) — the shipped trust boundary.
 *
 * The proposer is untrusted; the DETERMINISTIC gate is the authority. These tests prove the
 * gate's teeth: it accepts a well-formed, sentence-grounded proposal, and REJECTS every
 * hallucination shape — a value the sentence never states, a binding to a non-existent
 * attribute, an enum member not present, a wrong-kind relabel, an unknown kind. A rejected
 * proposal falls to the obligation ledger (returned as `rejected`), never silently trusted.
 *
 * A real-LLM smoke path is included but GUARDED by the API key (never in CI): it proves a
 * real model's proposals pass the very same gate, or are honestly rejected.
 */

import { describe, it, expect } from 'vitest';
import { acceptProposal, extractWithLlm, type LlmProposal, type Proposer } from '../../src/constraints/extract-llm.js';
import { mineEntityAttributes } from '../../src/constraints/extract.js';
import { CanonicalType } from '../../src/models/canonical.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
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
function def(statement: string): CanonicalNode {
  return { canon_id: 'd', type: CanonicalType.DEFINITION, statement, source_clause_ids: ['cl'], linked_canon_ids: [], tags: [] } as unknown as CanonicalNode;
}
const habitAttrs = () => mineEntityAttributes([iu('habit')], [def('a habit has a name and a cadence')], []);
const txnAttrs = () => mineEntityAttributes([iu('transaction'), iu('account')], [def('a transaction has an account and an amount')], []);

describe('verified-LLM acceptance gate: accepts grounded proposals', () => {
  it('accepts a bound whose value is present in the sentence', () => {
    const r = acceptProposal(
      { kind: 'bound', entity: 'habit', attribute: 'name', params: { op: '<=', value: 80, unit: 'chars' } },
      'a habit name must be capped at 80 characters', habitAttrs());
    expect(r.accepted).toBe(true);
    if (r.accepted) { expect(r.constraint.assertion.kind).toBe('bound'); expect(r.constraint.binding).toEqual({ entity: 'habit', attribute: 'name' }); }
  });
  it('accepts a membership whose members are present', () => {
    const r = acceptProposal(
      { kind: 'membership', entity: 'habit', attribute: 'cadence', params: { values: ['daily', 'weekly'] } },
      'a habit cadence can only be daily or weekly', habitAttrs());
    expect(r.accepted).toBe(true);
  });
  it('accepts a reference whose target is a known, named entity', () => {
    const r = acceptProposal(
      { kind: 'reference', entity: 'transaction', attribute: 'account', params: { target: 'account' } },
      'a transaction cannot exist without an account', txnAttrs());
    expect(r.accepted).toBe(true);
    if (r.accepted) expect(r.constraint.assertion).toEqual({ kind: 'reference', target: 'account' });
  });
});

describe('verified-LLM acceptance gate: rejects every hallucination shape', () => {
  it('rejects a bound value the sentence never states (no smuggled literal)', () => {
    const r = acceptProposal(
      { kind: 'bound', entity: 'habit', attribute: 'name', params: { op: '<=', value: 100 } }, // spec says 80
      'a habit name must be capped at 80 characters', habitAttrs());
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.reason).toMatch(/not present/i);
  });
  it('rejects a binding to a non-existent attribute', () => {
    const r = acceptProposal(
      { kind: 'bound', entity: 'habit', attribute: 'colour', params: { op: '<=', value: 80 } },
      'a habit colour must be at most 80 characters', habitAttrs());
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.reason).toMatch(/does not resolve/i);
  });
  it('rejects an enum member not present in the sentence', () => {
    const r = acceptProposal(
      { kind: 'membership', entity: 'habit', attribute: 'cadence', params: { values: ['daily', 'monthly'] } }, // monthly not said
      'a habit cadence must be daily or weekly', habitAttrs());
    expect(r.accepted).toBe(false);
  });
  it('rejects an unknown entity and an unknown kind', () => {
    expect(acceptProposal({ kind: 'bound', entity: 'ghost', attribute: 'x', params: { op: '<=', value: 1 } }, 'x is 1', habitAttrs()).accepted).toBe(false);
    expect(acceptProposal({ kind: 'nonsense', entity: 'habit', attribute: 'name' }, 'a habit name', habitAttrs()).accepted).toBe(false);
  });
  it('rejects a reference to a target that is not a known entity', () => {
    const r = acceptProposal(
      { kind: 'reference', entity: 'transaction', attribute: 'wallet', params: { target: 'wallet' } },
      'a transaction references a wallet', txnAttrs());
    expect(r.accepted).toBe(false);
  });
  it('rejects a temporal proposal with no future/past cue in the sentence', () => {
    const r = acceptProposal(
      { kind: 'temporal', entity: 'transaction', attribute: 'amount', params: { mode: 'not-future' } },
      'a transaction amount must be positive', txnAttrs());
    expect(r.accepted).toBe(false);
  });
});

describe('verified-LLM second pass: pipeline discipline', () => {
  it('skips a sentence the rule floor already captured (the audited rule result wins)', async () => {
    const captured = new Set(['a habit name must not exceed 80 characters']);
    const proposer: Proposer = () => ({ kind: 'bound', entity: 'habit', attribute: 'name', params: { op: '<=', value: 80 } });
    const r = await extractWithLlm(['a habit name must not exceed 80 characters'], habitAttrs(), proposer, captured);
    expect(r.accepted).toHaveLength(0);   // not re-proposed
    expect(r.rejected).toHaveLength(0);
  });
  it('a rejected proposal is returned (falls to the obligation ledger — never silent)', async () => {
    const proposer: Proposer = () => ({ kind: 'bound', entity: 'habit', attribute: 'name', params: { op: '<=', value: 999 } });
    const r = await extractWithLlm(['a habit name must be short'], habitAttrs(), proposer);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].sentence).toBe('a habit name must be short');
  });
  it('an accepted proposal becomes a constraint', async () => {
    const proposer: Proposer = () => ({ kind: 'membership', entity: 'habit', attribute: 'cadence', params: { values: ['daily', 'weekly'] } });
    const r = await extractWithLlm(['cadence is any of daily, weekly'], habitAttrs(), proposer);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].assertion.kind).toBe('membership');
  });
});

// ── Real-LLM smoke (guarded by the API key; NEVER in CI) ──────────────────────
const HAS_KEY = !!process.env.ANTHROPIC_API_KEY && process.env.PHOENIX_LLM_SMOKE === '1';
describe.skipIf(!HAS_KEY)('verified-LLM second pass: real model drives the same gate', () => {
  it('a real proposal for a paraphrase either passes the gate or is honestly rejected', async () => {
    const { resolveProvider } = await import('../../src/llm/resolve.js');
    const llm = resolveProvider();
    const proposer: Proposer = async (ctx) => {
      const raw = await llm!.generate(
        `Sentence: "${ctx.sentence}"\nEntities: ${ctx.entities.join(', ')}\nAttributes: ${JSON.stringify(ctx.attributesByEntity)}\n` +
        `Return ONLY JSON {"kind","entity","attribute","params"} for the constraint this sentence states, using one of: bound, membership, pattern, uniqueness, reference, cardinality, expr, temporal, presence. No prose.`,
        { system: 'You extract one structured constraint. Output only JSON.', temperature: 0, maxTokens: 300 });
      const m = raw.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) as LlmProposal : null;
    };
    const r = await extractWithLlm(['a habit name may be no more than 80 characters'], habitAttrs(), proposer);
    // Either the gate accepted a grounded proposal, or it rejected — never a wrong capture.
    for (const c of r.accepted) expect(['bound']).toContain(c.assertion.kind);
    expect(r.accepted.length + r.rejected.length).toBe(1);
  }, 30_000);
});
