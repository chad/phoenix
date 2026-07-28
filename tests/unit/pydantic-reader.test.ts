/**
 * Pydantic enforcement reader — the cross-runtime parity suite.
 *
 * The constraint checkers historically read only the Zod dialect, so a python-fastapi
 * module enforcing the SAME spec rule the Pydantic way read as `absent` — the verdict
 * diverged from node for identical enforcement (the parity red). The reader in
 * src/constraints/pydantic.ts owns the READING for the python dialect; this suite
 * proves, per kind and per verdict value:
 *
 *   1. PARITY   — the same constraint earns the SAME verdict on equivalent Zod and
 *                 Pydantic sources: conforms, violates, and absent alike. (The
 *                 negative verdicts matter as much as the green: a reader that
 *                 over-reads python enforcement would be a false-green machine.)
 *   2. OWNERSHIP — the reader claims ONLY pydantic sources: Zod modules are never
 *                 routed to it (no regression of the TS path), and non-model text is
 *                 never misread as enforcement.
 *   3. HONESTY  — what the reader cannot see stays absent/indeterminate, never a
 *                 guessed conforms.
 *
 * Ground truth here is constructed, not sampled: each source is written to carry (or
 * drop) the enforcement, so a wrong verdict is unambiguous.
 */

import { describe, it, expect } from 'vitest';
import { checkConstraint } from '../../src/constraints/check.js';
import { checkConstraintAst } from '../../src/constraints/check-ast.js';
import { looksPydantic, findPyFieldDecl, checkConstraintPydantic } from '../../src/constraints/pydantic.js';
import type { StructuredConstraint, Assertion } from '../../src/constraints/model.js';

const C = (assertion: Assertion, attribute = 'name', entity = 'account'): StructuredConstraint => ({
  constraint_id: 't', binding: { entity, attribute }, assertion, source: { statement: 's' },
});

const PY_MODEL = (fieldLines: string, extra = ''): string =>
  `from pydantic import BaseModel, Field\nfrom typing import Optional, Literal\n\n${extra}class CreateAccount(BaseModel):\n${fieldLines}\n`;

// ─── Ownership ────────────────────────────────────────────────────────────────
describe('pydantic dialect ownership', () => {
  it('claims BaseModel modules with pydantic idioms', () => {
    expect(looksPydantic(PY_MODEL('    name: str = Field(max_length=60)'))).toBe(true);
    expect(looksPydantic(PY_MODEL("    status: Literal['a', 'b']"))).toBe(true);
    expect(looksPydantic(PY_MODEL('    email: EmailStr'))).toBe(true);
  });

  it('NEVER claims a Zod module — the TS readers keep their territory', () => {
    const zod = 'import { z } from "zod";\n// mentions BaseModel and Field( in a comment\nconst S = z.object({ name: z.string().max(60) });';
    expect(looksPydantic(zod)).toBe(false);
    expect(checkConstraintPydantic(C({ kind: 'bound', op: '<=', value: 60, unit: 'chars' }), zod)).toBeNull();
  });

  it('does not claim python without pydantic idioms (plain dataclass-ish text)', () => {
    expect(looksPydantic('class Account:\n    name: str\n')).toBe(false);
  });
});

// ─── Field-declaration discovery ───────────────────────────────────────────────
describe('findPyFieldDecl', () => {
  it('finds a simple field and its Field() args', () => {
    const d = findPyFieldDecl(PY_MODEL('    name: str = Field(min_length=1, max_length=60)'), 'name');
    expect(d).not.toBeNull();
    expect(d!.fieldArgs).toContain('max_length=60');
    expect(d!.annotation).toBe('str');
  });

  it('matches a QUALIFIED name (owner_email for email), mirroring the Zod path', () => {
    const d = findPyFieldDecl(PY_MODEL('    owner_email: str = Field(max_length=200)'), 'email');
    expect(d).not.toBeNull();
    expect(d!.name).toBe('owner_email');
  });

  it('captures a MULTI-LINE Field(...) call intact', () => {
    const src = PY_MODEL('    name: str = Field(\n        min_length=1,\n        max_length=60,\n    )');
    const d = findPyFieldDecl(src, 'name');
    expect(d!.fieldArgs).toContain('max_length=60');
  });

  it('collects the field_validator blocks for the field', () => {
    const src = PY_MODEL(
      '    date: str\n\n    @field_validator(\'date\')\n    @classmethod\n    def date_not_future(cls, v):\n        if v > date.today():\n            raise ValueError(\'date cannot be in the future\')\n        return v\n',
    );
    const d = findPyFieldDecl(src, 'date');
    expect(d!.validators.length).toBe(1);
    expect(d!.validators[0]).toContain('future');
  });
});

// ── Bound parity ──────────────────────────────────────────────────────────────
describe('bound parity (Zod ↔ Pydantic)', () => {
  const bound = C({ kind: 'bound', op: '<=', value: 60, unit: 'chars' });
  const numericBound = C({ kind: 'bound', op: '>=', value: 0 }, 'balance');

  it.each([
    ['conforms', 'const S = z.object({ name: z.string().max(60) });', PY_MODEL('    name: str = Field(max_length=60)')],
    ['violates', 'const S = z.object({ name: z.string().max(100) });', PY_MODEL('    name: str = Field(max_length=100)')],
    ['absent', 'const S = z.object({ name: z.string() });', PY_MODEL('    name: str')],
  ] as const)('%s: identical verdict on both dialects', (want, zod, py) => {
    expect(checkConstraint(bound, zod).result, `zod ${want}`).toBe(want);
    expect(checkConstraint(bound, py).result, `pydantic ${want}`).toBe(want);
    // And through the AST dispatcher — the pipeline's actual path.
    expect(checkConstraintAst(bound, py).result, `ast-dispatch ${want}`).toBe(want);
  });

  it('reads numeric bounds via le=/ge= (not just length kwargs)', () => {
    expect(checkConstraint(numericBound, PY_MODEL('    balance: int = Field(ge=0)')).result).toBe('conforms');
    expect(checkConstraint(numericBound, PY_MODEL('    balance: int = Field(ge=5)')).result).toBe('violates');
    expect(checkConstraint(numericBound, PY_MODEL('    balance: int')).result).toBe('absent');
  });

  it('indeterminate when the attribute is nowhere in the module', () => {
    expect(checkConstraint(bound, PY_MODEL('    color: str = Field(max_length=60)')).result).toBe('indeterminate');
  });
});

// ── Membership parity ─────────────────────────────────────────────────────────
describe('membership parity', () => {
  const mem = C({ kind: 'membership', values: ['active', 'archived'] }, 'status');

  it.each([
    ['conforms', `const S = z.object({ status: z.enum(['active','archived']) });`, PY_MODEL("    status: Literal['active', 'archived']")],
    ['violates', `const S = z.object({ status: z.enum(['active','paused']) });`, PY_MODEL("    status: Literal['active', 'paused']")],
    ['absent', 'const S = z.object({ status: z.string() });', PY_MODEL('    status: str')],
  ] as const)('%s: identical verdict on both dialects', (want, zod, py) => {
    expect(checkConstraint(mem, zod).result, `zod ${want}`).toBe(want);
    expect(checkConstraint(mem, py).result, `pydantic ${want}`).toBe(want);
  });

  it('reads a str-Enum class value-set (the pydantic idiom Literal does not cover)', () => {
    const src = PY_MODEL(
      '    status: Status\n',
      "class Status(str, Enum):\n    ACTIVE = 'active'\n    ARCHIVED = 'archived'\n\n",
    );
    expect(checkConstraint(mem, src).result).toBe('conforms');
    const wrong = PY_MODEL(
      '    status: Status\n',
      "class Status(str, Enum):\n    ACTIVE = 'active'\n    PAUSED = 'paused'\n\n",
    );
    expect(checkConstraint(mem, wrong).result).toBe('violates');
  });
});

// ── Presence parity ───────────────────────────────────────────────────────────
describe('presence parity', () => {
  const pres = C({ kind: 'presence' }, 'name');

  it.each([
    ['conforms', 'const S = z.object({ name: z.string().min(1) });', PY_MODEL('    name: str = Field(min_length=1)')],
    ['absent', 'const S = z.object({ name: z.string().optional() });', PY_MODEL('    name: Optional[str] = None')],
  ] as const)('%s: identical verdict on both dialects', (want, zod, py) => {
    expect(checkConstraint(pres, zod).result, `zod ${want}`).toBe(want);
    expect(checkConstraint(pres, py).result, `pydantic ${want}`).toBe(want);
  });

  it('Field(default=None) is optional; a bare annotation is required', () => {
    expect(checkConstraint(pres, PY_MODEL('    name: Optional[str] = Field(default=None)')).result).toBe('absent');
    expect(checkConstraint(pres, PY_MODEL('    name: str')).result).toBe('conforms');
  });
});

// ── Pattern parity ────────────────────────────────────────────────────────────
describe('pattern parity', () => {
  const email = C({ kind: 'pattern', format: 'email' }, 'email');

  it.each([
    ['conforms', 'const S = z.object({ email: z.string().email() });', PY_MODEL('    email: EmailStr')],
    ['absent', 'const S = z.object({ email: z.string() });', PY_MODEL('    email: str')],
  ] as const)('%s: identical verdict on both dialects', (want, zod, py) => {
    expect(checkConstraint(email, zod).result, `zod ${want}`).toBe(want);
    expect(checkConstraint(email, py).result, `pydantic ${want}`).toBe(want);
  });

  it('counts a field_validator as custom format enforcement (the .refine analogue)', () => {
    const src = PY_MODEL(
      '    email: str\n\n    @field_validator(\'email\')\n    @classmethod\n    def email_shape(cls, v):\n        assert \'@\' in v\n        return v\n',
    );
    expect(checkConstraint(email, src).result).toBe('conforms');
  });
});

// ── Cardinality parity ────────────────────────────────────────────────────────
describe('cardinality parity', () => {
  const card: StructuredConstraint = {
    constraint_id: 't', binding: { entity: 'order', attribute: 'item' },
    assertion: { kind: 'cardinality', min: 1, relation: 'item' }, source: { statement: 's' },
  };

  it('reads min_length on a list field (and conlist), mirroring .min(1)/.nonempty()', () => {
    expect(checkConstraint(card, PY_MODEL('    items: list[LineItem] = Field(min_length=1)')).result).toBe('conforms');
    expect(checkConstraint(card, PY_MODEL('    items: conlist(LineItem, min_length=1)')).result).toBe('conforms');
    expect(checkConstraint(card, PY_MODEL('    items: list[LineItem]')).result).toBe('absent');
    expect(checkConstraint(card, PY_MODEL('    items: list[LineItem] = Field(min_length=2)')).result).toBe('absent');
    expect(checkConstraint(card, 'const S = z.object({ items: z.array(LineItem).min(1) });').result).toBe('conforms');
  });
});

// ── Temporal parity ───────────────────────────────────────────────────────────
describe('temporal parity', () => {
  const temp = C({ kind: 'temporal', mode: 'not-future' }, 'date');

  it('a field_validator carrying the future cue enforces; a bare date does NOT (the isValidDate trap, mirrored)', () => {
    const enforced = PY_MODEL(
      '    date: str\n\n    @field_validator(\'date\')\n    @classmethod\n    def not_future(cls, v):\n        if v > date.today():\n            raise ValueError(\'cannot be in the future\')\n        return v\n',
    );
    expect(checkConstraint(temp, enforced).result).toBe('conforms');
    expect(checkConstraint(temp, PY_MODEL('    date: date')).result).toBe('absent'); // format ≠ temporal
    expect(checkConstraint(temp, PY_MODEL('    date: PastDate')).result).toBe('conforms'); // the dedicated type enforces
  });
});

// ── Fall-through discipline ───────────────────────────────────────────────────
describe('kinds the reader does NOT own fall through unchanged', () => {
  it('uniqueness/reference (SQL is language-agnostic) and expr are not claimed', () => {
    const uniq = C({ kind: 'uniqueness' }, 'email');
    const src = PY_MODEL('    email: str\n') + '\ndb.execute("CREATE UNIQUE INDEX ux ON accounts (email)")\n';
    // checkConstraintPydantic defers; the SQL reader still sees the UNIQUE index.
    expect(checkConstraintPydantic(uniq, src)).toBeNull();
    expect(checkConstraint(uniq, src).result).toBe('conforms');
  });
});
