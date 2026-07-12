/**
 * Deterministic guard synthesis (P1) — repair's last mile.
 *
 * NIGHT-REPORT-3's honest residual: sonnet wouldn't add afterimage's "deck ≥ 30 cards"
 * guard in three LLM rounds. For the MECHANICAL constraint kinds the fix is not creative
 * — each checker's inverse is a template:
 *   - bound       → `.max(N)` / `.min(N)` on the field's Zod chain
 *   - membership  → replace the field's base type with `z.enum([...])`
 *   - presence    → drop `.optional()` / `.nullish()` from the field
 *   - cardinality → `.min(N)` / `.max(N)` on the collection (a `z.array(...)` chain)
 *   - temporal    → a `.refine(isNotFuture, …)` on the date field (+ the helper)
 *
 * This module synthesizes exactly that edit. HARD RULE (gate 5): a synthesized edit may
 * only make the ORIGINAL verifier finding SATISFIED — it never alters what is checked.
 * The verifier stays frozen; template repair is a repair STAGE, not a new checker.
 *
 * Technique: AST-LOCATE, minimally SPLICE. We parse the module with the TypeScript
 * compiler API (check-ast.ts already reads these Zod chains) to find the precise node —
 * the field's initializer, a `.max()` argument, an `.optional()` call — then splice the
 * smallest possible text change at that node's range. Full-module re-printing would
 * reformat code the edit never touched; an AST-located splice keeps the diff surgical and
 * the rest of the file byte-identical. The caller re-runs the FROZEN verifier to confirm
 * the finding is now satisfied and that the module still compiles; a synthesis that does
 * not clear the finding is discarded (honest residual), never force-applied.
 */

import ts from 'typescript';
import type { StructuredConstraint } from './constraints/model.js';

/** The mechanical kinds whose guard is a deterministic template (no model needed). */
export type MechanicalKind = 'bound' | 'membership' | 'presence' | 'cardinality' | 'temporal';
export function isMechanical(c: StructuredConstraint): boolean {
  return ['bound', 'membership', 'presence', 'cardinality', 'temporal'].includes(c.assertion.kind);
}

function parse(source: string): ts.SourceFile | null {
  try { return ts.createSourceFile('m.ts', source, ts.ScriptTarget.Latest, true); }
  catch { return null; }
}

/** Match a generated field/column name to a spec attribute (qualifier on either side +
 *  optional plural), mirroring the checkers so synthesis targets the same field. */
function nameMatches(fieldName: string, attr: string, plural = false): boolean {
  const a = attr.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(?:[a-z0-9]+_)?${a}${plural ? 's?' : ''}(?:_[a-z0-9]+)*$`);
  return re.test(fieldName.toLowerCase());
}

/**
 * The Zod-chain expression node for `attr` — the thing whose end/args we splice. Handles
 * the NAMED-CONST indirection the generators commonly emit (`const dateSchema = z.string()
 * .date(); … date: dateSchema`): when the property initializer is an identifier bound to a
 * top-level `z.…` const, we return the CONST's initializer so the guard is appended there.
 * Mirrors checkMembership's one-level follow so synthesis targets the same declaration the
 * checker reads. `field` is the wrapper for reporting/absent-detection. Returns null when
 * no editable Zod chain is found (→ honest residual, no forced edit).
 */
interface FieldTarget { field: ts.PropertyAssignment; expr: ts.Expression; }
function findField(sf: ts.SourceFile, attr: string, plural = false): FieldTarget | null {
  const props: ts.PropertyAssignment[] = [];
  const constInit = new Map<string, ts.Expression>();
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n)) {
      const key = ts.isIdentifier(n.name) ? n.name.text : ts.isStringLiteral(n.name) ? n.name.text : undefined;
      if (key && nameMatches(key, attr, plural)) props.push(n);
    }
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && isZodChain(d.initializer)) constInit.set(d.name.text, d.initializer);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  props.sort((a, b) => a.pos - b.pos);
  for (const p of props) {
    if (isZodChain(p.initializer)) return { field: p, expr: p.initializer };
    if (ts.isIdentifier(p.initializer) && constInit.has(p.initializer.text)) {
      return { field: p, expr: constInit.get(p.initializer.text)! };
    }
  }
  return null;
}

/** Whether an expression is a `z.…()` call chain (base identifier `z`). */
function isZodChain(node: ts.Expression): boolean {
  let cur: ts.Expression = node;
  while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) cur = cur.expression.expression;
  return ts.isIdentifier(cur) && cur.text === 'z';
}

/** The innermost `z.<base>()` head call of a chain (e.g. the `z.string()` in
 *  `z.string().min(1).optional()`), for membership base-type replacement. */
function headCall(node: ts.Expression): ts.CallExpression | null {
  let cur: ts.Expression = node;
  let last: ts.CallExpression | null = null;
  while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
    last = cur;
    cur = cur.expression.expression;
  }
  return last; // the deepest call whose object is `z`
}

/** Every `.method(...)` call node in the chain, leaf→root, matching one of `names`. */
function chainCalls(node: ts.Expression, names: Set<string>): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  let cur: ts.Expression = node;
  while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
    if (names.has(cur.expression.name.text)) out.push(cur);
    cur = cur.expression.expression;
  }
  return out;
}

/** Splice `insert` into `source` at [start,end). */
function splice(source: string, start: number, end: number, insert: string): string {
  return source.slice(0, start) + insert + source.slice(end);
}

/**
 * Synthesize the guard that satisfies a mechanical constraint's finding, returning the
 * edited source — or null when the field isn't a Zod chain we can safely edit (leave it
 * an honest residual). The edit is the checker's exact inverse, so re-verifying with the
 * frozen checker flips absent/violates → conforms.
 */
export function synthesizeGuard(c: StructuredConstraint, source: string): string | null {
  const sf = parse(source);
  if (!sf) return null;
  const a = c.assertion;

  // Locate the field's Zod chain (following one level of named-const indirection). We then
  // transform the chain's TEXT and write it back onto the PROPERTY initializer — inlining
  // the const when needed so the guard lands exactly where the FROZEN checker reads it (the
  // checkers read an inline `attr: z.…` chain, not a `attr: someConst` reference). AST pins
  // the node; the edit is a small transform of that isolated substring.
  const tgt = a.kind === 'cardinality'
    ? (findField(sf, c.binding.attribute, true) ?? findField(sf, a.relation, true))
    : findField(sf, c.binding.attribute);
  if (!tgt) return null;
  const base = tgt.expr.getText(sf);
  let chain: string | null = null;
  let prelude = ''; // a module-level helper to add once (temporal)

  if (a.kind === 'bound') {
    const method = a.op === '<=' ? 'max' : 'min';
    const re = new RegExp(`\\.${method}\\(\\s*\\d+\\s*\\)`);
    chain = re.test(base) ? base.replace(re, `.${method}(${a.value})`) : `${base}.${method}(${a.value})`;
  } else if (a.kind === 'membership') {
    const enumExpr = `z.enum([${a.values.map(v => `'${v}'`).join(', ')}])`;
    if (/z\.enum\(\s*\[[^\]]*\]/.test(base)) chain = base.replace(/z\.enum\(\s*\[[^\]]*\]\s*\)/, enumExpr);
    else if (/z\.(string|number|any|unknown)\(\)/.test(base)) chain = base.replace(/z\.(string|number|any|unknown)\(\)/, enumExpr);
    else return null;
  } else if (a.kind === 'presence') {
    if (!/\.(optional|nullish|nullable)\(\)/.test(base)) return null;
    chain = base.replace(/\.(optional|nullish|nullable)\(\)/g, '');
  } else if (a.kind === 'cardinality') {
    if (!/\.array\(/.test(base)) return null; // only the z.array collection shape is templated
    let add = '';
    if (a.min !== undefined && !new RegExp(`\\.(min\\(\\s*${a.min}\\b|nonempty\\()`).test(base)) add += `.min(${a.min})`;
    if (a.max !== undefined && !new RegExp(`\\.max\\(\\s*${a.max}\\b`).test(base)) add += `.max(${a.max})`;
    if (!add) return null;
    chain = base + add;
  } else if (a.kind === 'temporal') {
    const cue = a.mode === 'not-future' ? 'future' : 'past';
    const cmp = a.mode === 'not-future' ? '<=' : '>=';
    const helper = a.mode === 'not-future' ? 'isNotFuture' : 'isNotPast';
    chain = `${base}.refine(${helper}, 'Date must not be in the ${cue}')`;
    if (!new RegExp(`\\b(?:function|const)\\s+${helper}\\b`).test(source)) {
      // Accept the nullable/optional shape the generators use (`z.string().nullable()
      // .optional()`), so the refine typechecks whether the field is string or
      // string|null|undefined; a missing date is trivially not in the ${cue}.
      prelude = `\nconst ${helper} = (s: string | null | undefined): boolean => s == null || new Date(s).getTime() ${cmp} Date.now();\n`;
    }
  }
  if (!chain || chain === base) return null;

  // Write the transformed chain onto the property initializer (inlining a const-ref).
  let out = splice(source, tgt.field.initializer.getStart(sf), tgt.field.initializer.getEnd(), chain);
  if (prelude) {
    const lastImport = [...out.matchAll(/^import .*$/gm)].pop();
    const at = lastImport ? lastImport.index! + lastImport[0].length : 0;
    out = splice(out, at, at, prelude);
  }
  return out;
}
