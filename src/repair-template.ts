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

/** The first (source-order) `attr: <initializer>` property assignment whose initializer
 *  is a `z.…` chain, or null. Returns the property node so callers can splice precisely. */
function findField(sf: ts.SourceFile, attr: string, plural = false): ts.PropertyAssignment | null {
  const matches: ts.PropertyAssignment[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n)) {
      const key = ts.isIdentifier(n.name) ? n.name.text : ts.isStringLiteral(n.name) ? n.name.text : undefined;
      if (key && nameMatches(key, attr, plural) && isZodChain(n.initializer)) matches.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.pos - b.pos);
  return matches[0];
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

  if (a.kind === 'bound') {
    const field = findField(sf, c.binding.attribute);
    if (!field) return null;
    const method = a.op === '<=' ? 'max' : 'min';
    // Wrong bound present → replace its numeric argument in place.
    const existing = chainCalls(field.initializer, new Set([method]))[0];
    if (existing && existing.arguments.length === 1) {
      const arg = existing.arguments[0];
      return splice(source, arg.getStart(sf), arg.getEnd(), String(a.value));
    }
    // Absent → append `.method(N)` at the end of the field's chain.
    return splice(source, field.initializer.getEnd(), field.initializer.getEnd(), `.${method}(${a.value})`);
  }

  if (a.kind === 'membership') {
    const field = findField(sf, c.binding.attribute);
    if (!field) return null;
    const enumExpr = `z.enum([${a.values.map(v => `'${v}'`).join(', ')}])`;
    // Replace the `z.string()`/`z.number()` head call with `z.enum([...])`, preserving
    // any trailing chain (.optional() etc.). If the enum is already the head, no-op-guard.
    const head = headCall(field.initializer);
    if (!head) return null;
    if (ts.isPropertyAccessExpression(head.expression) && head.expression.name.text === 'enum') {
      // An enum is already present but the value-set differs → replace its array arg.
      const arg = head.arguments[0];
      if (arg) return splice(source, arg.getStart(sf), arg.getEnd(), `[${a.values.map(v => `'${v}'`).join(', ')}]`);
      return null;
    }
    return splice(source, head.getStart(sf), head.getEnd(), enumExpr);
  }

  if (a.kind === 'presence') {
    const field = findField(sf, c.binding.attribute);
    if (!field) return null;
    // Drop `.optional()` / `.nullish()` (and a paired `.nullable()`) from the chain.
    const drops = chainCalls(field.initializer, new Set(['optional', 'nullish', 'nullable']));
    if (drops.length === 0) return null;
    // Remove from the property-access dot through the call's `)`; do the rightmost first
    // so earlier ranges stay valid.
    let out = source;
    const ranges = drops
      .map(call => {
        const pae = call.expression as ts.PropertyAccessExpression;
        return { start: pae.name.getStart(sf) - 1 /* the dot */, end: call.getEnd() };
      })
      .sort((x, y) => y.start - x.start);
    for (const r of ranges) out = splice(out, r.start, r.end, '');
    return out === source ? null : out;
  }

  if (a.kind === 'cardinality') {
    const field = findField(sf, c.binding.attribute, /*plural*/ true) ?? findField(sf, a.relation, true);
    if (!field) return null;
    // Only the `z.array(...)` collection shape is templated here; a relational count
    // guard (a COUNT(*) query in a route) is left to the LLM / honest residual.
    if (!chainCalls(field.initializer, new Set(['array'])).length) return null;
    let insert = '';
    if (a.min !== undefined && !chainCalls(field.initializer, new Set(['min', 'nonempty'])).some(cc => cc.arguments.length && ts.isNumericLiteral(cc.arguments[0]) && +cc.arguments[0].text === a.min)) {
      insert += `.min(${a.min})`;
    }
    if (a.max !== undefined && !chainCalls(field.initializer, new Set(['max'])).some(cc => cc.arguments.length && ts.isNumericLiteral(cc.arguments[0]) && +cc.arguments[0].text === a.max)) {
      insert += `.max(${a.max})`;
    }
    if (!insert) return null;
    return splice(source, field.initializer.getEnd(), field.initializer.getEnd(), insert);
  }

  if (a.kind === 'temporal') {
    const field = findField(sf, c.binding.attribute);
    if (!field) return null;
    const cue = a.mode === 'not-future' ? 'future' : 'past';
    const cmp = a.mode === 'not-future' ? '<=' : '>=';
    const helper = a.mode === 'not-future' ? 'isNotFuture' : 'isNotPast';
    // Append the refine to the date field's chain.
    let out = splice(source, field.initializer.getEnd(), field.initializer.getEnd(),
      `.refine(${helper}, 'Date must not be in the ${cue}')`);
    // Ensure the helper exists (idempotent): define it once, after the imports.
    if (!new RegExp(`\\b(?:function|const)\\s+${helper}\\b`).test(out)) {
      const helperSrc = `\nconst ${helper} = (s: string): boolean => new Date(s).getTime() ${cmp} Date.now();\n`;
      const lastImport = [...out.matchAll(/^import .*$/gm)].pop();
      const at = lastImport ? lastImport.index! + lastImport[0].length : 0;
      out = splice(out, at, at, helperSrc);
    }
    return out;
  }

  return null;
}
