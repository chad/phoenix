import { describe, it, expect } from 'vitest';
import { mineEntityAttributes, parseBound, extractBoundConstraints } from '../../src/constraints/extract.js';
import { checkBound } from '../../src/constraints/check.js';
import { verdictOf } from '../../src/models/validation.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CanonicalType } from '../../src/models/canonical.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';
import type { StructuredConstraint } from '../../src/constraints/model.js';

function node(type: CanonicalType, statement: string, tags: string[] = []): CanonicalNode {
  return { canon_id: 'c-' + statement.slice(0, 8), type, statement, source_clause_ids: ['cl1'], linked_canon_ids: [], tags } as unknown as CanonicalNode;
}
function iu(name: string): ImplementationUnit {
  return {
    iu_id: 'iu-' + name, kind: 'module', name, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: [], dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: [`src/generated/${name}/${name}.ts`],
  };
}

describe('parseBound', () => {
  it('parses max-length bounds', () => {
    expect(parseBound('a habit name must not exceed 80 characters')).toEqual({ kind: 'bound', op: '<=', value: 80, unit: 'chars' });
    expect(parseBound('at most 500 characters')).toEqual({ kind: 'bound', op: '<=', value: 500, unit: 'chars' });
  });
  it('parses min bounds', () => {
    expect(parseBound('an order must have at least 1 line item')).toEqual({ kind: 'bound', op: '>=', value: 1, unit: 'items' });
  });
  it('returns null for non-bounds', () => {
    expect(parseBound('a habit name must not be empty')).toBeNull();
  });
});

describe('mineEntityAttributes', () => {
  it('mines attributes from definition statements', () => {
    const nodes = [node(CanonicalType.DEFINITION, 'a habit has a name, a color, and a cadence')];
    const attrs = mineEntityAttributes([iu('habit')], nodes, []);
    expect([...(attrs.get('habit') ?? [])].sort()).toEqual(['cadence', 'color', 'name']);
  });
});

describe('extractBoundConstraints — binding resolution (the §1 guard)', () => {
  const attrs = mineEntityAttributes(
    [iu('habit')],
    [node(CanonicalType.DEFINITION, 'a habit has a name, a color, and a cadence')],
    [],
  );

  it('binds a well-formed constraint to entity.attribute', () => {
    const { constraints, defects } = extractBoundConstraints(
      [node(CanonicalType.CONSTRAINT, 'a habit name must not exceed 80 characters', ['habit', 'name'])],
      attrs,
    );
    expect(defects).toHaveLength(0);
    expect(constraints).toHaveLength(1);
    expect(constraints[0].binding).toEqual({ entity: 'habit', attribute: 'name' });
    expect(constraints[0].assertion).toMatchObject({ op: '<=', value: 80 });
  });

  it('flags an unbound constraint as a DEFECT (the §1 "line" case)', () => {
    const { constraints, defects } = extractBoundConstraints(
      [node(CanonicalType.CONSTRAINT, 'the line must not exceed 80 characters', ['line'])],
      attrs,
    );
    expect(constraints).toHaveLength(0);
    expect(defects).toHaveLength(1);
    expect(defects[0].subject).toBe('line');
    expect(defects[0].reason).toMatch(/does not resolve/);
  });
});

describe('checkBound — the static oracle', () => {
  const c: StructuredConstraint = {
    constraint_id: 'x', binding: { entity: 'habit', attribute: 'name' },
    assertion: { kind: 'bound', op: '<=', value: 80, unit: 'chars' },
    source: { statement: 's' },
  };

  it('conforms when the schema carries the right bound', () => {
    expect(checkBound(c, 'const S = z.object({ name: z.string().min(1).max(80) });').result).toBe('conforms');
  });
  it('violates when the schema carries the WRONG bound', () => {
    const r = checkBound(c, 'const S = z.object({ name: z.string().min(1).max(100) });');
    expect(r.result).toBe('violates');
    expect(r.found).toBe(100);
  });
  it('is ABSENT when the field has no bound (the §1 failure — a hard error, not green)', () => {
    expect(checkBound(c, 'const S = z.object({ name: z.string().min(1) });').result).toBe('absent');
  });
  it('is indeterminate when the module is not generated yet', () => {
    expect(checkBound(c, null).result).toBe('indeterminate');
  });
});

describe('verdictOf — the total function never defaults to OK', () => {
  it('static: conforms→ok, violates→error, absent→error (§1), indeterminate→incomplete', () => {
    expect(verdictOf('static', 'conforms')).toBe('ok');
    expect(verdictOf('static', 'violates')).toBe('error');
    expect(verdictOf('static', 'absent')).toBe('error');
    expect(verdictOf('static', 'indeterminate')).toBe('incomplete');
  });
  it('property/behavioral conforms is NOT ok yet (no mutation gate) — degrades to incomplete', () => {
    expect(verdictOf('property', 'conforms')).toBe('incomplete');
    expect(verdictOf('behavioral', 'conforms')).toBe('incomplete');
    expect(verdictOf('property', 'absent')).toBe('incomplete'); // not a hard error off the static row
  });
  it('manual conforms is ok (signer/expiry enforced by the caller)', () => {
    expect(verdictOf('manual', 'conforms')).toBe('ok');
  });
});
