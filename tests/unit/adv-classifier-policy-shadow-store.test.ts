import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { countCanonImpact } from '../../src/classifier.js';
import { evaluatePolicy } from '../../src/policy-engine.js';
import { computeShadowDiff, classifyShadowDiff } from '../../src/shadow-pipeline.js';
import { CanonicalStore } from '../../src/store/canonical-store.js';
import { EvidenceStatus } from '../../src/models/evidence.js';
import { UpgradeClassification } from '../../src/models/pipeline.js';
import { CanonicalType } from '../../src/models/canonical.js';
import type { Clause } from '../../src/models/clause.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

const cl = (id: string): Clause => ({ clause_id: id } as unknown as Clause);
const cn = (canon_id: string, clauseId: string, type = CanonicalType.REQUIREMENT, statement = 'X'): CanonicalNode =>
  ({ canon_id, type, statement, tags: [], source_clause_ids: [clauseId], linked_canon_ids: [] } as unknown as CanonicalNode);

describe('adversarial: classifier #3', () => {
  it('countCanonImpact counts DISTINCT nodes, not before+after sum', () => {
    const before = cl('c1'), after = cl('c1');
    const cb = [cn('n1', 'c1'), cn('n2', 'c1')];
    const ca = [cn('n1', 'c1'), cn('n2', 'c1')];
    expect(countCanonImpact(before, after, cb, ca)).toBe(2); // was 4
  });
});

describe('adversarial: policy-engine #7', () => {
  it('picks the latest evidence by timestamp, not array order', () => {
    const iu = { iu_id: 'A', evidence_policy: { required: ['lint'] } } as unknown as ImplementationUnit;
    const evidence = [
      { iu_id: 'A', kind: 'lint', status: EvidenceStatus.PASS, timestamp: '2026-01-02T00:00:00Z' },
      { iu_id: 'A', kind: 'lint', status: EvidenceStatus.FAIL, timestamp: '2026-01-01T00:00:00Z' },
    ] as never;
    expect(evaluatePolicy(iu, evidence).verdict).toBe('PASS');
  });
});

describe('adversarial: shadow-pipeline #11/#12', () => {
  it('#11 duplicate statements do not produce false risk escalations on identical pipelines', () => {
    const nodes = [cn('a', 'x', CanonicalType.REQUIREMENT, 'X'), cn('b', 'y', CanonicalType.CONSTRAINT, 'X')];
    expect(computeShadowDiff(nodes, nodes).risk_escalations).toBe(0);
  });
  it('#12 risk escalations are not classified as a benign compaction event', () => {
    const cls = classifyShadowDiff({ orphan_nodes: 0, semantic_stmt_drift: 0, node_change_pct: 10, risk_escalations: 5 } as never);
    expect(cls.classification).not.toBe(UpgradeClassification.COMPACTION_EVENT);
  });
});

describe('adversarial: canonical-store #10', () => {
  it('an empty/partial graph file does not brick the store', () => {
    const root = mkdtempSync(join(tmpdir(), 'adv-store-'));
    mkdirSync(join(root, 'graphs'), { recursive: true });
    writeFileSync(join(root, 'graphs', 'canonical.json'), '', 'utf8'); // 0 bytes (crash mid-write)
    expect(() => new CanonicalStore(root).getAllNodes()).not.toThrow();
    rmSync(root, { recursive: true, force: true });
  });
});
