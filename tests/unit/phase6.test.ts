import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluatePolicy } from '../../src/policy-engine.js';
import { evidencePolicyForTier } from '../../src/iu-planner.js';
import { EvidenceKind, EvidenceStatus } from '../../src/models/evidence.js';
import type { EvidenceRecord } from '../../src/models/evidence.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';
import { CanonicalStore } from '../../src/store/canonical-store.js';
import { ContentStore } from '../../src/store/content-store.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CanonicalType } from '../../src/models/canonical.js';
import { ConfirmStore } from '../../src/store/confirm-store.js';
import { computeShadowDiff } from '../../src/shadow-pipeline.js';

function iu(required: string[], one_of?: string[][]): ImplementationUnit {
  return {
    iu_id: 'iu-x', kind: 'module', name: 'X', risk_tier: 'critical',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: [], dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required, one_of }, output_files: [],
  };
}
function ev(kind: EvidenceKind): EvidenceRecord {
  return { evidence_id: `e-${kind}`, kind, status: EvidenceStatus.PASS, iu_id: 'iu-x', canon_ids: [], timestamp: '2026-01-01T00:00:00Z' };
}

describe('evidence tiers (PRD §10)', () => {
  it('high tier requires a threat note', () => {
    expect(evidencePolicyForTier('high').required).toContain('threat_note');
  });
  it('critical tier has a human_signoff OR formal/simulation one_of group', () => {
    const p = evidencePolicyForTier('critical');
    expect(p.one_of?.[0]).toEqual(['human_signoff', 'formal_verification', 'simulation']);
  });
});

describe('policy engine one_of groups', () => {
  it('is satisfied by any one alternative', () => {
    const unit = iu(['typecheck'], [['human_signoff', 'formal_verification', 'simulation']]);
    const withSignoff = evaluatePolicy(unit, [ev(EvidenceKind.TYPECHECK), ev(EvidenceKind.HUMAN_SIGNOFF)]);
    expect(withSignoff.verdict).toBe('PASS');
    const withFormal = evaluatePolicy(unit, [ev(EvidenceKind.TYPECHECK), ev(EvidenceKind.FORMAL_VERIFICATION)]);
    expect(withFormal.verdict).toBe('PASS');
  });
  it('is incomplete when no alternative is present', () => {
    const unit = iu(['typecheck'], [['human_signoff', 'formal_verification', 'simulation']]);
    const result = evaluatePolicy(unit, [ev(EvidenceKind.TYPECHECK)]);
    expect(result.verdict).toBe('INCOMPLETE');
    expect(result.missing.some(m => m.startsWith('one_of'))).toBe(true);
  });
});

describe('CanonicalStore.replaceNodes drops orphans and GCs blobs', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'phoenix-canon-')); });
  const node = (id: string, clause: string): CanonicalNode =>
    ({ canon_id: id, type: CanonicalType.REQUIREMENT, statement: `s ${id}`, source_clause_ids: [clause], linked_canon_ids: [], tags: [] } as unknown as CanonicalNode);

  it('removes nodes absent from the new set and reclaims their content blobs', () => {
    const store = new CanonicalStore(dir);
    const content = new ContentStore(dir);
    store.replaceNodes([node('aa11', 'c1'), node('bb22', 'c2')]);
    expect(content.has('aa11')).toBe(true);
    // Re-canonicalize with 'aa11' dropped (its clause was removed).
    const removed = store.replaceNodes([node('bb22', 'c2')]);
    expect(removed).toEqual(['aa11']);
    expect(store.getAllNodes().map(n => n.canon_id)).toEqual(['bb22']);
    expect(content.has('aa11')).toBe(false); // GC'd
    expect(content.has('bb22')).toBe(true);
  });
});

describe('ConfirmStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'phoenix-confirm-')); });
  const cmd = () => ({ bot: 'ImplBot' as const, action: 'regen', args: {}, raw: 'ImplBot: regen' });

  it('takes a pending command exactly once', () => {
    const store = new ConfirmStore(dir);
    store.add({ confirm_id: 'abc', command: cmd(), intent: 'regen', created_at: '2026-01-01T00:00:00Z' });
    expect(store.take('abc')?.confirm_id).toBe('abc');
    expect(store.take('abc')).toBeNull(); // consumed
  });
  it('latest returns the most recent pending', () => {
    const store = new ConfirmStore(dir);
    store.add({ confirm_id: 'a', command: cmd(), intent: 'i', created_at: '2026-01-01T00:00:00Z' });
    store.add({ confirm_id: 'b', command: cmd(), intent: 'i', created_at: '2026-01-02T00:00:00Z' });
    expect(store.latest()?.confirm_id).toBe('b');
  });
});

describe('shadow diff matches on stable anchor', () => {
  const withAnchor = (id: string, anchor: string, type = CanonicalType.REQUIREMENT): CanonicalNode =>
    ({ canon_id: id, canon_anchor: anchor, type, statement: `s ${id}`, source_clause_ids: ['c'], linked_canon_ids: [], tags: [] } as unknown as CanonicalNode);

  it('a reword (new canon_id, same anchor) is NOT counted as churn', () => {
    const oldNodes = [withAnchor('id-old', 'anchor-1')];
    const newNodes = [withAnchor('id-new', 'anchor-1')]; // reworded → new content id, same anchor
    const m = computeShadowDiff(oldNodes, newNodes);
    expect(m.node_change_pct).toBe(0); // matched by anchor
  });
  it('a genuinely new concept (new anchor) IS churn', () => {
    const oldNodes = [withAnchor('id-1', 'anchor-1')];
    const newNodes = [withAnchor('id-1', 'anchor-1'), withAnchor('id-2', 'anchor-2')];
    const m = computeShadowDiff(oldNodes, newNodes);
    expect(m.node_change_pct).toBeGreaterThan(0);
  });
});
