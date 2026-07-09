/**
 * Static checker for Bound constraints (the load-bearing capability).
 *
 * Given a resolved Bound constraint and the generated source for its entity's module,
 * determine — deterministically, offline, no app run — whether the enforcement is:
 *   conforms   : the field carries the right bound (.max(N) / .min(N))
 *   violates   : the field carries the WRONG bound (.max(100) when spec says 80)
 *   absent     : the field exists (or the module does) but carries no bound → the §1 cell
 *   indeterminate : the module isn't generated yet / field not found to reason about
 *
 * This is coupled to the node-typescript (Zod) codegen format by design; it is the
 * single architecture target for the slice. Regex-based: robust enough to catch a
 * dropped or wrong `.max`, which is the whole point.
 */

import type { StructuredConstraint } from './model.js';
import type { CheckResult } from '../models/validation.js';

const zodMethod = (op: string) => (op === '<=' ? 'max' : 'min');

export interface BoundCheck {
  result: CheckResult;
  found?: number;      // the bound value found in code, if any
  detail: string;
}

export interface ConstraintCheck {
  result: CheckResult;
  detail: string;
}

/**
 * Check a Bound constraint against a module's source. `source` is null when the
 * module has not been generated yet (⇒ indeterminate, not a failure).
 */
export function checkBound(c: StructuredConstraint, source: string | null): BoundCheck {
  if (c.assertion.kind !== 'bound') {
    return { result: 'indeterminate', detail: 'not a bound assertion' };
  }
  const assertion = c.assertion;
  if (source == null) {
    return { result: 'indeterminate', detail: 'module not generated yet' };
  }
  const attr = c.binding.attribute;
  const method = zodMethod(assertion.op);

  // Locate the field's Zod declaration: `name: z.string()....` possibly across the
  // rest of the chain on the same logical line. Match the attribute as a schema key.
  const fieldRe = new RegExp(`\\b${escapeRe(attr)}\\s*:\\s*z\\.[^\\n,;]*`, 'i');
  const decl = source.match(fieldRe);
  if (!decl) {
    // The field itself isn't in the schema. If the module references the attribute at
    // all, treat the missing bound as absent; otherwise we can't reason ⇒ indeterminate.
    return new RegExp(`\\b${escapeRe(attr)}\\b`, 'i').test(source)
      ? { result: 'absent', detail: `no ${method}() bound on "${attr}" (field present, bound missing)` }
      : { result: 'indeterminate', detail: `attribute "${attr}" not found in generated schema` };
  }

  const boundRe = new RegExp(`\\.${method}\\(\\s*(\\d+)`, 'g');
  let found: number | undefined;
  for (const m of decl[0].matchAll(boundRe)) {
    const n = parseInt(m[1], 10);
    // For a max bound, the relevant one is the max(); take the first match on the field.
    found = n;
    break;
  }
  if (found === undefined) {
    return { result: 'absent', found: undefined, detail: `no .${method}() on "${attr}"` };
  }
  if (found === assertion.value) {
    return { result: 'conforms', found, detail: `.${method}(${found}) matches` };
  }
  return { result: 'violates', found, detail: `.${method}(${found}) but spec requires .${method}(${assertion.value})` };
}

/**
 * Check a Membership (enum) constraint against a module's source. Conforms when the
 * field's Zod declaration is a `z.enum([...])` (or literal union) covering exactly
 * the spec's value set; violates when the enforced set differs; absent when the
 * field is present but unconstrained; indeterminate when the field isn't found.
 */
export function checkMembership(c: StructuredConstraint, source: string | null): ConstraintCheck {
  if (source == null) return { result: 'indeterminate', detail: 'module not generated yet' };
  if (c.assertion.kind !== 'membership') return { result: 'indeterminate', detail: 'not a membership assertion' };
  const attr = c.binding.attribute;
  const want = [...c.assertion.values].map(v => v.toLowerCase()).sort();

  const fieldRe = new RegExp(`\\b${escapeRe(attr)}\\s*:\\s*z\\.[^\\n]*`, 'i');
  const decl = source.match(fieldRe);
  if (!decl) {
    return new RegExp(`\\b${escapeRe(attr)}\\b`, 'i').test(source)
      ? { result: 'absent', detail: `no enum on "${attr}" (field present, value-set unconstrained)` }
      : { result: 'indeterminate', detail: `attribute "${attr}" not found in generated schema` };
  }
  // Collect the enum's string literals: z.enum(['a','b']) or z.union([z.literal('a'),…]).
  const enumMatch = decl[0].match(/z\.enum\(\s*\[([^\]]*)\]/i);
  const literals = [...decl[0].matchAll(/z\.literal\(\s*['"]([^'"]+)['"]/gi)].map(m => m[1].toLowerCase());
  let got: string[] | null = null;
  if (enumMatch) {
    got = [...enumMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1].toLowerCase()).sort();
  } else if (literals.length > 0) {
    got = literals.sort();
  }
  if (!got) return { result: 'absent', detail: `no z.enum()/literal union on "${attr}"` };
  const same = got.length === want.length && got.every((v, i) => v === want[i]);
  return same
    ? { result: 'conforms', detail: `enum [${got.join(', ')}] matches` }
    : { result: 'violates', detail: `enum [${got.join(', ')}] but spec requires [${want.join(', ')}]` };
}

/**
 * Check a Pattern (format) constraint against a module's source. Conforms when the
 * field's Zod declaration carries the matching format validator (.email()/.url()/
 * .uuid()/.datetime() or a .regex()); absent when the field is present but
 * unvalidated; indeterminate when the field isn't found.
 */
export function checkPattern(c: StructuredConstraint, source: string | null): ConstraintCheck {
  if (source == null) return { result: 'indeterminate', detail: 'module not generated yet' };
  if (c.assertion.kind !== 'pattern') return { result: 'indeterminate', detail: 'not a pattern assertion' };
  const attr = c.binding.attribute;
  const fmt = c.assertion.format;
  const fieldRe = new RegExp(`\\b${escapeRe(attr)}\\s*:\\s*z\\.[^\\n]*`, 'i');
  const decl = source.match(fieldRe);
  if (!decl) {
    return new RegExp(`\\b${escapeRe(attr)}\\b`, 'i').test(source)
      ? { result: 'absent', detail: `no format validator on "${attr}" (field present, format unchecked)` }
      : { result: 'indeterminate', detail: `attribute "${attr}" not found in generated schema` };
  }
  const validators: Record<string, RegExp> = {
    email: /\.email\(|\.regex\(/i,
    url: /\.url\(|\.regex\(/i,
    uuid: /\.uuid\(|\.regex\(/i,
    date: /\.datetime\(|\.date\(|\.regex\(/i,
    regex: /\.regex\(/i,
  };
  return validators[fmt].test(decl[0])
    ? { result: 'conforms', detail: `${fmt} format enforced` }
    : { result: 'absent', detail: `no ${fmt} validator on "${attr}"` };
}

/** Dispatch a constraint to its kind's static checker. */
export function checkConstraint(c: StructuredConstraint, source: string | null): ConstraintCheck {
  if (c.assertion.kind === 'bound') {
    const r = checkBound(c, source);
    return { result: r.result, detail: r.detail };
  }
  if (c.assertion.kind === 'membership') return checkMembership(c, source);
  return checkPattern(c, source);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
