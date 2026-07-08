import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeInvalidation, iuKey } from '../../src/invalidation.js';
import { InvalidationStore } from '../../src/store/invalidation-store.js';
import { DiffType } from '../../src/models/clause.js';
import type { Clause, ClauseDiff } from '../../src/models/clause.js';
import { ChangeClass } from '../../src/models/classification.js';
import type { ChangeClassification } from '../../src/models/classification.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CanonicalType } from '../../src/models/canonical.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

function clause(id: string): Clause {
  return {
    clause_id: id, source_doc_id: 'spec/app.md', source_line_range: [1, 1],
    raw_text: id, normalized_text: id, section_path: [], clause_semhash: id, context_semhash_cold: id,
  };
}
function canon(id: string, clauseIds: string[]): CanonicalNode {
  return {
    canon_id: id, type: CanonicalType.REQUIREMENT, statement: `stmt ${id}`,
    source_clause_ids: clauseIds, linked_canon_ids: [], link_types: {},
  } as CanonicalNode;
}
function iu(id: string, name: string, canonIds: string[], deps: string[] = []): ImplementationUnit {
  return {
    iu_id: id, kind: 'module', name, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: canonIds, dependencies: deps,
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: [`src/generated/${name}.ts`],
  };
}
function modified(before: Clause, cls: ChangeClass): { diff: ClauseDiff; classification: ChangeClassification } {
  return {
    diff: { diff_type: DiffType.MODIFIED, clause_id_before: before.clause_id, clause_id_after: before.clause_id + '-new', clause_before: before, clause_after: clause(before.clause_id + '-new') },
    classification: { change_class: cls, confidence: 0.8, signals: { norm_diff: 0.3, semhash_delta: true, context_cold_delta: false, term_ref_delta: 0.3, section_structure_delta: false, canon_impact: 1 } },
  };
}

describe('computeInvalidation', () => {
  // Three IUs: Task ← (Project depends on Task) ; Report independent.
  const cTask = clause('clause-task');
  const cProject = clause('clause-project');
  const cReport = clause('clause-report');
  const nTask = canon('canon-task', ['clause-task']);
  const nProject = canon('canon-project', ['clause-project']);
  const nReport = canon('canon-report', ['clause-report']);
  const iuTask = iu('iu-task', 'task', ['canon-task']);
  const iuProject = iu('iu-project', 'project', ['canon-project'], ['iu-task']); // project imports task
  const iuReport = iu('iu-report', 'report', ['canon-report']);
  const canonNodes = [nTask, nProject, nReport];
  const ius = [iuTask, iuProject, iuReport];

  it('a single B-class clause change invalidates ONLY its IU (the defining capability)', () => {
    const result = computeInvalidation({
      changes: [modified(cTask, ChangeClass.B)],
      canonNodes, ius,
    });
    expect(result.stale.map(s => s.key)).toEqual(['task']);
    // Report is untouched; Project is a dependent, so re-validate (not regenerate).
    expect(result.stale.map(s => s.key)).not.toContain('report');
    expect(result.revalidate.map(s => s.key)).toEqual(['project']);
  });

  it('Class A (trivial) invalidates nothing', () => {
    const result = computeInvalidation({
      changes: [modified(cTask, ChangeClass.A)],
      canonNodes, ius,
    });
    expect(result.stale).toHaveLength ? expect(result.stale).toHaveLength(0) : expect(result.stale.length).toBe(0);
    expect(result.revalidate).toHaveLength(0);
  });

  it('a change to an independent IU does not touch the coupled pair', () => {
    const result = computeInvalidation({
      changes: [modified(cReport, ChangeClass.C)],
      canonNodes, ius,
    });
    expect(result.stale.map(s => s.key)).toEqual(['report']);
    expect(result.revalidate).toHaveLength(0);
  });

  it('cause chain names the clause, canon, and IU', () => {
    const result = computeInvalidation({
      changes: [modified(cTask, ChangeClass.B)],
      canonNodes, ius,
      clauseDocs: new Map([['clause-task', 'spec/app.md']]),
      clauseLines: new Map([['clause-task', 10]]),
    });
    expect(result.stale[0].cause_chain).toContain('spec/app.md L10');
    expect(result.stale[0].cause_chain).toContain('[B]');
    expect(result.stale[0].cause_chain).toContain('task');
  });

  it('ADDED/REMOVED clauses flag canon_stale', () => {
    const added = {
      diff: { diff_type: DiffType.ADDED, clause_id_after: 'new-clause', clause_after: clause('new-clause') } as ClauseDiff,
      classification: { change_class: ChangeClass.B, confidence: 0.9, signals: { norm_diff: 1, semhash_delta: true, context_cold_delta: true, term_ref_delta: 1, section_structure_delta: true, canon_impact: 0 } } as ChangeClassification,
    };
    const result = computeInvalidation({ changes: [added], canonNodes, ius });
    expect(result.canon_stale).toBe(true);
  });
});

describe('InvalidationStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'phoenix-inv-')); });

  it('accumulates stale IUs across ingests and clears per key', () => {
    const store = new InvalidationStore(dir);
    store.record({ stale: [{ key: 'task', iu_id: 'iu-task', iu_name: 'task', reason: 'directly_affected', cause_chain: 'x' }], revalidate: [], canon_stale: false, causes: [] });
    store.record({ stale: [{ key: 'project', iu_id: 'iu-project', iu_name: 'project', reason: 'directly_affected', cause_chain: 'y' }], revalidate: [], canon_stale: false, causes: [] });
    expect([...store.staleKeys()].sort()).toEqual(['project', 'task']);
    store.clearKeys(['task']);
    expect([...store.staleKeys()]).toEqual(['project']);
  });

  it('a key becoming directly stale removes it from revalidate', () => {
    const store = new InvalidationStore(dir);
    store.record({ stale: [], revalidate: [{ key: 'project', iu_id: 'iu-project', iu_name: 'project', reason: 'dependent', cause_chain: 'z' }], canon_stale: false, causes: [] });
    store.record({ stale: [{ key: 'project', iu_id: 'iu-project', iu_name: 'project', reason: 'directly_affected', cause_chain: 'w' }], revalidate: [], canon_stale: false, causes: [] });
    expect([...store.staleKeys()]).toEqual(['project']);
    expect(store.load()!.revalidate).toHaveLength(0);
  });

  it('clearing the last key resets canon_stale and causes', () => {
    const store = new InvalidationStore(dir);
    store.record({ stale: [{ key: 'task', iu_id: 'i', iu_name: 'task', reason: 'directly_affected', cause_chain: 'x' }], revalidate: [], canon_stale: true, causes: [{ clause_id: 'c', change_class: ChangeClass.B, canon_ids: [] }] });
    store.clearKeys(['task']);
    const loaded = store.load()!;
    expect(loaded.canon_stale).toBe(false);
    expect(loaded.causes).toHaveLength(0);
  });
});

describe('iuKey', () => {
  it('prefers name, falls back to output path then id', () => {
    expect(iuKey(iu('id1', 'task', []))).toBe('task');
    const noName = { ...iu('id1', '', []), name: '' };
    expect(iuKey(noName)).toBe('src/generated/.ts');
  });
});
