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

/**
 * Check a Bound constraint against a module's source. `source` is null when the
 * module has not been generated yet (⇒ indeterminate, not a failure).
 */
export function checkBound(c: StructuredConstraint, source: string | null): BoundCheck {
  if (source == null) {
    return { result: 'indeterminate', detail: 'module not generated yet' };
  }
  const attr = c.binding.attribute;
  const method = zodMethod(c.assertion.op);

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
  if (found === c.assertion.value) {
    return { result: 'conforms', found, detail: `.${method}(${found}) matches` };
  }
  return { result: 'violates', found, detail: `.${method}(${found}) but spec requires .${method}(${c.assertion.value})` };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
