/**
 * AST-based static checkers — the decay fix for the constraint trust surface.
 *
 * The regex checkers in check.ts read Zod enforcement by pattern-matching source text.
 * That is fragile: a reformat, a wrapped chain, a comment, or a plausible-but-unrelated
 * token can flip a verdict, and a verdict that can silently drift is exactly the decay
 * the trust surface must not have. These checkers parse the module ONCE with the
 * TypeScript compiler API and read the Zod call chain as a real syntax tree —
 * `z.string().max(80)` is a CallExpression on a PropertyAccess on `z`, not a string that
 * happens to contain ".max(80)".
 *
 * Scope + migration discipline: the AST path owns the Zod-declared field kinds
 * (bound / membership / pattern / cardinality). Reference and uniqueness act on SQL DDL,
 * which is regular enough for the regex path, and Expr routes to the executable oracle —
 * both are delegated unchanged. Crucially, when a field is NOT expressed as a Zod chain
 * (an imperative guard, a non-TS source, a shape the AST does not model), the AST checker
 * DELEGATES to the regex checker rather than guessing. So the two implementations can
 * only diverge on a Zod chain the AST reads more precisely — which is proven by the
 * differential harness (tests/unit/check-ast-differential.test.ts) before this path
 * becomes the default. Same ConstraintCheck contract, same abstain discipline: a shape
 * it cannot read is indeterminate/absent, never a false `conforms`.
 */

import ts from 'typescript';
import type { StructuredConstraint } from './model.js';
import type { CheckResult, CheckMethod } from '../models/validation.js';
import {
  checkConstraint as checkConstraintRegex,
  checkBound as checkBoundRegex,
  checkMembership as checkMembershipRegex,
  checkPattern as checkPatternRegex,
  checkCardinality as checkCardinalityRegex,
  checkReference,
  checkUniqueness,
  checkExpr,
} from './check.js';
import { checkConstraintPydantic } from './pydantic.js';

export interface ConstraintCheck {
  result: CheckResult;
  detail: string;
  /** Mirrors check.ts's contract: 'behavioral-gated' marks an executed, mutation-gated verdict. */
  method?: CheckMethod;
}

/** One `.method(args)` link in a Zod call chain, in root→leaf order (string, min, max). */
interface ZodMethod {
  name: string;
  args: readonly ts.Expression[];
}

/** A parsed source (cached per string so we parse a module ONCE per check pass). */
const cache = new WeakMap<object, ts.SourceFile | null>();
const boxes = new Map<string, { box: object }>();
function parse(source: string): ts.SourceFile | null {
  // Box the string so we can WeakMap-cache the parse (strings aren't valid keys).
  let entry = boxes.get(source);
  if (!entry) { entry = { box: {} }; boxes.set(source, entry); }
  if (cache.has(entry.box)) return cache.get(entry.box)!;
  let sf: ts.SourceFile | null = null;
  try {
    sf = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, /*setParentNodes*/ true);
  } catch { sf = null; }
  cache.set(entry.box, sf);
  return sf;
}

/** Match a generated field/column name to a spec attribute, allowing a qualifier on
 *  EITHER side — a prefix (`owner_email` for `email`) or a suffixed compound
 *  (`musician_player_ids` for `musician`) — plus a plural `s`. Mirrors the regex
 *  checkers' name matching so the two paths agree. */
function nameMatches(fieldName: string, attr: string, plural = false): boolean {
  const a = attr.toLowerCase();
  const f = fieldName.toLowerCase();
  const re = new RegExp(`^(?:[a-z0-9]+_)?${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${plural ? 's?' : ''}(?:_[a-z0-9]+)*$`);
  return re.test(f); // suffix rule mirrors findFieldDecl; plural stays cardinality-only
}

/** Walk a Zod call chain from its outermost CallExpression to methods root→leaf.
 *  Returns null if `node` is not a `z.…()` chain (base identifier must be `z`). */
function zodChain(node: ts.Expression): ZodMethod[] | null {
  const methods: ZodMethod[] = [];
  let cur: ts.Expression = node;
  while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
    methods.push({ name: cur.expression.name.text, args: cur.arguments });
    cur = cur.expression.expression;
  }
  // The base must be the Zod object `z` (e.g. `z.string()...`); anything else is not a
  // Zod field and is left to the regex path.
  if (!ts.isIdentifier(cur) || cur.text !== 'z') return null;
  return methods.reverse();
}

/** Find the first (source-order) `attr: z.…` field's Zod chain, or null. */
function findFieldChain(sf: ts.SourceFile, attr: string, plural = false): ZodMethod[] | null {
  const matches: { pos: number; chain: ZodMethod[] }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n)) {
      const key = ts.isIdentifier(n.name) ? n.name.text
        : ts.isStringLiteral(n.name) ? n.name.text : undefined;
      if (key && nameMatches(key, attr, plural)) {
        const chain = zodChain(n.initializer);
        if (chain) matches.push({ pos: n.pos, chain });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.pos - b.pos); // first in source order (mirrors the regex path)
  return matches[0].chain;
}

/** The numeric value of a method's first argument, or undefined. */
function numArg(m: ZodMethod): number | undefined {
  const a = m.args[0];
  if (a && ts.isNumericLiteral(a)) return parseInt(a.text, 10);
  return undefined;
}

/** String literals in a method's array argument: `.enum(['a','b'])`. */
function stringArrayArg(m: ZodMethod): string[] | null {
  const a = m.args[0];
  if (a && ts.isArrayLiteralExpression(a)) {
    const out: string[] = [];
    for (const el of a.elements) {
      if (ts.isStringLiteral(el)) out.push(el.text.toLowerCase());
      else if (ts.isCallExpression(el)) {
        // z.literal('a') inside a z.union([...]) — take the literal's string arg.
        const lit = el.arguments[0];
        if (lit && ts.isStringLiteral(lit)) out.push(lit.text.toLowerCase());
      }
    }
    return out.length ? out : null;
  }
  return null;
}

// ── Bound ──────────────────────────────────────────────────────────────────────
export function checkBoundAst(c: StructuredConstraint, source: string | null): ConstraintCheck {
  if (source == null) return { result: 'indeterminate', detail: 'module not generated yet' };
  if (c.assertion.kind !== 'bound') return { result: 'indeterminate', detail: 'not a bound assertion' };
  const sf = parse(source);
  if (!sf) return delegateBound(c, source);
  const attr = c.binding.attribute;
  const method = c.assertion.op === '<=' ? 'max' : 'min';
  const chain = findFieldChain(sf, attr);
  if (!chain) return delegateBound(c, source); // not a Zod field → regex owns it
  const found = chain.filter(m => m.name === method).map(numArg).find(v => v !== undefined);
  if (found === undefined) return { result: 'absent', detail: `no .${method}() on "${attr}"` };
  return found === c.assertion.value
    ? { result: 'conforms', detail: `.${method}(${found}) matches` }
    : { result: 'violates', detail: `.${method}(${found}) but spec requires .${method}(${c.assertion.value})` };
}
function delegateBound(c: StructuredConstraint, source: string): ConstraintCheck {
  const r = checkBoundRegex(c, source);
  return { result: r.result, detail: r.detail };
}

// ── Membership ─────────────────────────────────────────────────────────────────
export function checkMembershipAst(c: StructuredConstraint, source: string | null): ConstraintCheck {
  if (source == null) return { result: 'indeterminate', detail: 'module not generated yet' };
  if (c.assertion.kind !== 'membership') return { result: 'indeterminate', detail: 'not a membership assertion' };
  const sf = parse(source);
  if (!sf) return checkMembershipRegex(c, source);
  const attr = c.binding.attribute;
  const chain = findFieldChain(sf, attr);
  if (!chain) return checkMembershipRegex(c, source);
  const want = [...c.assertion.values].map(v => v.toLowerCase()).sort();
  // z.enum([...]) or z.union([z.literal(...), …]).
  const setMethod = chain.find(m => m.name === 'enum' || m.name === 'union');
  const got = setMethod ? stringArrayArg(setMethod)?.sort() ?? null : null;
  if (!got) return { result: 'absent', detail: `no z.enum()/literal union on "${attr}"` };
  const same = got.length === want.length && got.every((v, i) => v === want[i]);
  return same
    ? { result: 'conforms', detail: `enum [${got.join(', ')}] matches` }
    : { result: 'violates', detail: `enum [${got.join(', ')}] but spec requires [${want.join(', ')}]` };
}

// ── Pattern ────────────────────────────────────────────────────────────────────
const PATTERN_VALIDATORS: Record<string, Set<string>> = {
  email: new Set(['email', 'regex', 'refine']),
  url: new Set(['url', 'regex', 'refine']),
  uuid: new Set(['uuid', 'regex', 'refine']),
  date: new Set(['datetime', 'date', 'regex', 'refine']),
  regex: new Set(['regex', 'refine']),
};
export function checkPatternAst(c: StructuredConstraint, source: string | null): ConstraintCheck {
  if (source == null) return { result: 'indeterminate', detail: 'module not generated yet' };
  if (c.assertion.kind !== 'pattern') return { result: 'indeterminate', detail: 'not a pattern assertion' };
  const sf = parse(source);
  if (!sf) return checkPatternRegex(c, source);
  const attr = c.binding.attribute;
  const fmt = c.assertion.format;
  const chain = findFieldChain(sf, attr);
  if (!chain) return checkPatternRegex(c, source);
  const validators = PATTERN_VALIDATORS[fmt];
  return chain.some(m => validators.has(m.name))
    ? { result: 'conforms', detail: `${fmt} format enforced` }
    : { result: 'absent', detail: `no ${fmt} validator on "${attr}"` };
}

// ── Cardinality ────────────────────────────────────────────────────────────────
export function checkCardinalityAst(c: StructuredConstraint, source: string | null): ConstraintCheck {
  if (source == null) return { result: 'indeterminate', detail: 'module not generated yet' };
  if (c.assertion.kind !== 'cardinality') return { result: 'indeterminate', detail: 'not a cardinality assertion' };
  const sf = parse(source);
  if (!sf) return checkCardinalityRegex(c, source);
  const rel = c.assertion.relation;
  // Cardinality is a guard on a COLLECTION field (z.array(...)…). Find the relation's
  // field as a Zod array chain; anything else (an imperative .length guard, a count
  // check) is left to the regex path, which models those.
  const chain = findFieldChain(sf, rel, /*plural*/ true);
  const isArrayChain = chain?.some(m => m.name === 'array');
  if (!chain || !isArrayChain) return checkCardinalityRegex(c, source);
  const { min, max } = c.assertion;
  const hasMin = min !== undefined && chain.some(m =>
    (m.name === 'min' && numArg(m) === min) || (m.name === 'nonempty' && min === 1));
  const hasMax = max !== undefined && chain.some(m => m.name === 'max' && numArg(m) === max);
  const ok = (min === undefined || hasMin) && (max === undefined || hasMax);
  const shape = `${min !== undefined ? `≥${min}` : ''}${max !== undefined ? ` ≤${max}` : ''}`.trim();
  const want = (min !== undefined ? 'min' : '') + (max !== undefined ? 'max' : '');
  return ok
    ? { result: 'conforms', detail: `cardinality ${shape} on "${rel}" enforced` }
    : { result: 'absent', detail: `no ${want}-count guard on "${rel}" (spec requires ${shape})` };
}

/**
 * AST-first dispatch. Zod-declared kinds are read from the syntax tree; SQL kinds
 * (reference, uniqueness) and the Expr oracle are delegated unchanged. Same contract
 * and abstain discipline as the regex `checkConstraint`.
 */
export function checkConstraintAst(c: StructuredConstraint, source: string | null): ConstraintCheck {
  // Per-runtime reader hook (cross-runtime parity): Pydantic sources bypass the Zod
  // syntax tree entirely and go to the pydantic dialect reader for the kinds it owns.
  if (source != null) {
    const py = checkConstraintPydantic(c, source);
    if (py) return py;
  }
  switch (c.assertion.kind) {
    case 'bound': return checkBoundAst(c, source);
    case 'membership': return checkMembershipAst(c, source);
    case 'pattern': return checkPatternAst(c, source);
    case 'cardinality': return checkCardinalityAst(c, source);
    case 'reference': return checkReference(c, source);
    case 'uniqueness': return checkUniqueness(c, source);
    case 'expr': return checkExpr(c, source);
    default: return checkConstraintRegex(c, source);
  }
}
