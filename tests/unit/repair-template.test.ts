/**
 * Unit: deterministic guard synthesis (P1).
 *
 * The contract (gate 5): a synthesized edit makes the ORIGINAL verifier finding
 * SATISFIED — never alters what is checked. So the test is a closed loop: take code the
 * FROZEN checker flags (absent/violates), synthesize the guard, and assert the SAME
 * checker now says conforms. No LLM. Every mechanical kind is covered, plus the honest
 * refusals (a non-Zod / relational shape → null, left as a residual).
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { synthesizeGuard, isMechanical } from '../../src/repair-template.js';
import { checkConstraintAst } from '../../src/constraints/check-ast.js';
import type { StructuredConstraint } from '../../src/constraints/model.js';

const con = (attribute: string, assertion: StructuredConstraint['assertion'], entity = 'e'): StructuredConstraint =>
  ({ constraint_id: 'c', binding: { entity, attribute }, assertion, source: { statement: 's' } });

/** Assert the synthesized source (a) flips the checker to conforms and (b) still parses. */
function expectSynthesisConforms(c: StructuredConstraint, before: string) {
  expect(checkConstraintAst(c, before).result, 'precondition: checker must flag the original').not.toBe('conforms');
  const after = synthesizeGuard(c, before);
  expect(after, 'synthesis should produce an edit').toBeTruthy();
  expect(checkConstraintAst(c, after!).result, `after synthesis: ${after}`).toBe('conforms');
  // Sanity: the edit is still syntactically valid TypeScript.
  const sf = ts.createSourceFile('m.ts', after!, ts.ScriptTarget.Latest, true);
  expect(sf.statements.length).toBeGreaterThan(0);
  return after!;
}

describe('repair-template: deterministic guard synthesis', () => {
  it('bound (absent): appends .max(N) to the field chain', () => {
    expectSynthesisConforms(
      con('name', { kind: 'bound', op: '<=', value: 60, unit: 'chars' }),
      'const S = z.object({ name: z.string().min(1) });',
    );
  });

  it('bound (violates): corrects the wrong .max value in place', () => {
    const after = expectSynthesisConforms(
      con('name', { kind: 'bound', op: '<=', value: 60 }),
      'const S = z.object({ name: z.string().max(100) });',
    );
    expect(after).toContain('.max(60)');
    expect(after).not.toContain('.max(100)');
  });

  it('membership (absent): replaces the base type with z.enum([...])', () => {
    const after = expectSynthesisConforms(
      con('kind', { kind: 'membership', values: ['checking', 'savings'] }),
      'const S = z.object({ kind: z.string() });',
    );
    expect(after).toContain("z.enum(['checking', 'savings'])");
  });

  it('membership (absent) preserves a trailing .optional()', () => {
    const after = synthesizeGuard(
      con('kind', { kind: 'membership', values: ['a', 'b'] }),
      'const S = z.object({ kind: z.string().optional() });',
    )!;
    expect(after).toContain("z.enum(['a', 'b']).optional()");
  });

  it('presence (absent): drops .optional() so the field is required', () => {
    const after = expectSynthesisConforms(
      con('name', { kind: 'presence' }),
      'const S = z.object({ name: z.string().min(1).optional() });',
    );
    expect(after).not.toContain('.optional()');
  });

  it('cardinality (absent): adds .min(N) to the z.array collection', () => {
    expectSynthesisConforms(
      con('cards', { kind: 'cardinality', min: 30, relation: 'card' }, 'deck'),
      'const S = z.object({ cards: z.array(Card) });',
    );
  });

  it('temporal (absent): adds a not-future refine and the helper', () => {
    const after = expectSynthesisConforms(
      con('date', { kind: 'temporal', mode: 'not-future' }),
      "import { z } from 'zod';\nconst S = z.object({ date: z.string() });",
    );
    expect(after).toContain('isNotFuture');
    expect(after).toMatch(/const isNotFuture/);
  });

  it('follows named-const indirection and inlines the guard where the frozen checker reads it', () => {
    // The generators factor validators into a shared const: `const dateSchema = z.string()
    // .date(); … date: dateSchema`. The frozen checker reads only the inline `date: z.…`
    // chain, so synthesis must inline the const chain onto the property + add the guard.
    const c = con('date', { kind: 'temporal', mode: 'not-future' });
    const before = "import { z } from 'zod';\nconst dateSchema = z.string().date('Invalid date');\nconst S = z.object({ date: dateSchema });";
    expect(checkConstraintAst(c, before).result).toBe('absent'); // checker can't see the const
    const after = synthesizeGuard(c, before)!;
    expect(after).toMatch(/date: z\.string\(\)\.date\([^)]*\)\.refine\(isNotFuture/);
    expect(checkConstraintAst(c, after).result).toBe('conforms');
  });

  it('temporal helper accepts the nullable/optional field shape (compiles either way)', () => {
    const after = synthesizeGuard(
      con('date', { kind: 'temporal', mode: 'not-future' }),
      "import { z } from 'zod';\nconst S = z.object({ date: z.string().nullable().optional() });",
    )!;
    // The helper must tolerate string | null | undefined so the refine typechecks on the
    // generators' `.nullable().optional()` date fields (a missing date is not in the future).
    expect(after).toContain('s: string | null | undefined');
    expect(after).toContain('s == null ||');
  });

  it('honest refusal: a non-Zod (relational) shape yields null (left as residual)', () => {
    const r = synthesizeGuard(
      con('cards', { kind: 'cardinality', min: 30, relation: 'card' }, 'deck'),
      "const n = db.prepare('SELECT COUNT(*) FROM deck_cards').get();",
    );
    expect(r).toBeNull();
  });

  it('isMechanical flags exactly the templated kinds', () => {
    expect(isMechanical(con('x', { kind: 'bound', op: '<=', value: 1 }))).toBe(true);
    expect(isMechanical(con('x', { kind: 'expr', statement: 's' }))).toBe(false);
    expect(isMechanical(con('x', { kind: 'reference', target: 't' }))).toBe(false);
  });
});
