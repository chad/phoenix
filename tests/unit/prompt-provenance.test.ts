import { describe, it, expect } from 'vitest';
import { provenanceLabels, extractLineProvenance, buildPrompt } from '../../src/llm/prompt.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';
import type { CanonicalNode } from '../../src/models/canonical.js';

function canon(id: string, type: string, statement: string): CanonicalNode {
  return {
    canon_id: id,
    type: type as CanonicalNode['type'],
    statement,
    tags: [],
    source_clause_ids: [],
    linked_canon_ids: [],
    confidence: 1,
    extraction_method: 'rule',
  } as CanonicalNode;
}

function makeIU(canonIds: string[]): ImplementationUnit {
  return {
    iu_id: 'iu-1',
    kind: 'module',
    name: 'Auth',
    risk_tier: 'medium',
    contract: { description: 'auth', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: canonIds,
    dependencies: [],
    boundary_policy: defaultBoundaryPolicy(),
    enforcement: defaultEnforcement(),
    evidence_policy: { required: [] },
    output_files: ['auth.ts'],
  };
}

const NODES = [
  canon('c-req-1', 'REQUIREMENT', 'users can log in with email and password'),
  canon('c-req-2', 'REQUIREMENT', 'users can reset their password'),
  canon('c-con-1', 'CONSTRAINT', 'passwords must be at least 8 characters'),
  canon('c-inv-1', 'INVARIANT', 'a session token is never reused'),
  canon('c-def-1', 'DEFINITION', 'a session is a signed token'),
];

describe('provenanceLabels', () => {
  it('assigns stable R/C/I labels per type, skipping definitions/context', () => {
    const labels = provenanceLabels(makeIU(['c-req-1', 'c-req-2', 'c-con-1', 'c-inv-1', 'c-def-1']), NODES);
    expect(labels.map(l => l.label)).toEqual(['R1', 'R2', 'C1', 'I1']);
    expect(labels.find(l => l.label === 'C1')!.canonId).toBe('c-con-1');
  });

  it('only labels canon nodes mapped to the IU', () => {
    const labels = provenanceLabels(makeIU(['c-req-2']), NODES);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ label: 'R1', canonId: 'c-req-2' });
  });
});

describe('buildPrompt provenance section', () => {
  it('renders [labels] and the annotation instruction', () => {
    const p = buildPrompt(makeIU(['c-req-1', 'c-con-1']), NODES);
    expect(p).toContain('[R1] users can log in');
    expect(p).toContain('[C1] passwords must be at least 8');
    expect(p).toContain('//phx:<label>');
  });

  it('omits the annotation section when there are no labelable nodes', () => {
    const p = buildPrompt(makeIU(['c-def-1']), NODES);
    expect(p).not.toContain('Provenance annotations');
  });
});

describe('extractLineProvenance', () => {
  const labels = provenanceLabels(makeIU(['c-req-1', 'c-con-1']), NODES);

  it('maps annotated lines to canon ids and strips the markers', () => {
    const code = [
      "router.post('/login', login); //phx:R1",
      'const x = 1;',
      'if (pw.length < 8) throw new Error(); // phx: C1',
    ].join('\n');
    const r = extractLineProvenance(code, labels);
    expect(r.lineProvenance).toEqual({ '0': 'c-req-1', '2': 'c-con-1' });
    // markers stripped, code otherwise intact, line count preserved
    expect(r.code).toBe([
      "router.post('/login', login);",
      'const x = 1;',
      'if (pw.length < 8) throw new Error();',
      ].join('\n'));
    expect(r.code.split('\n')).toHaveLength(3);
  });

  it('handles multi-label markers — strips the whole list, records the first resolvable label', () => {
    // labels here: R1→c-req-1, C1→c-con-1; C2 is unknown
    const code = 'title: z.string().min(1).max(200), //phx:C1,C2';
    const r = extractLineProvenance(code, labels);
    expect(r.lineProvenance).toEqual({ '0': 'c-con-1' });
    expect(r.code).toBe('title: z.string().min(1).max(200),');
  });

  it('ignores unknown labels but still strips the marker', () => {
    const r = extractLineProvenance('foo(); //phx:R9', labels);
    expect(r.lineProvenance).toEqual({});
    expect(r.code).toBe('foo();');
  });

  it('returns empty provenance for un-annotated code', () => {
    const r = extractLineProvenance('const a = 1;\nconst b = 2;', labels);
    expect(r.lineProvenance).toEqual({});
    expect(r.code).toBe('const a = 1;\nconst b = 2;');
  });
});
