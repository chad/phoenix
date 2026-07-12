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
import type { CheckResult, CheckMethod } from '../models/validation.js';
import { checkProperty } from '../evals.js';
import { deriveAggregateProperty, runAggregateProperty } from './exec-runner.js';

const zodMethod = (op: string) => (op === '<=' ? 'max' : 'min');

/**
 * Locate a field's Zod/schema declaration, allowing a QUALIFIED name: the spec
 * attribute `email` matches a generated field `owner_email` (a common LLM choice).
 * Returns the declaration text (up to the next field boundary), or null.
 */
function findFieldDecl(source: string, attr: string): string | null {
  // Capture the field's WHOLE chain — possibly multi-line (`.refine(...)` on the next
  // line) and containing bracketed enums — by consuming until the field-terminating
  // comma at paren/bracket depth 0, or the start of the next field. Depth tracking
  // keeps an enum array's internal commas and continuation lines inside the field.
  // Name matching allows a qualifier on EITHER side: `owner_email` for `email`
  // (prefix) and `musician_player_ids` for `musician` (suffixed compound).
  const re = new RegExp(`\\b(?:[a-z0-9]+_)?${escapeRe(attr)}(?:_[a-z0-9]+)*\\s*:\\s*z\\.`, 'i');
  const m = re.exec(source);
  if (!m) return null;
  let depth = 0;
  let out = '';
  for (let i = m.index; i < source.length; i++) {
    const ch = source[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
    else if (ch === ',' && depth <= 0) break; // field terminator
    else if (ch === '\n' && depth <= 0) {
      const after = source.slice(i + 1);
      if (!/^\s*\./.test(after) && /^\s*(?:[\w$]+\s*:|\}|\))/.test(after)) break; // next field / end
    }
    out += ch;
  }
  return out;
}

/** Whether the attribute (or a qualified form of it) is referenced anywhere. */
function fieldMentioned(source: string, attr: string): boolean {
  return new RegExp(`\\b(?:[a-z0-9]+_)?${escapeRe(attr)}\\b`, 'i').test(source);
}

export interface BoundCheck {
  result: CheckResult;
  found?: number;      // the bound value found in code, if any
  detail: string;
}

export interface ConstraintCheck {
  result: CheckResult;
  detail: string;
  /** How the verdict was reached. Defaults to 'static'; the executable runner
   *  reports 'behavioral-gated' — the only non-static method that may reach OK,
   *  and only because its conforms is earned through the mutation gate. */
  method?: CheckMethod;
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

  const declText = findFieldDecl(source, attr);
  if (!declText) {
    // The field itself isn't in the schema. If the module references the attribute at
    // all, treat the missing bound as absent; otherwise we can't reason ⇒ indeterminate.
    return fieldMentioned(source, attr)
      ? { result: 'absent', detail: `no ${method}() bound on "${attr}" (field present, bound missing)` }
      : { result: 'indeterminate', detail: `attribute "${attr}" not found in generated schema` };
  }

  const boundRe = new RegExp(`\\.${method}\\(\\s*(\\d+)`, 'g');
  let found: number | undefined;
  for (const m of declText.matchAll(boundRe)) {
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

  let declText = findFieldDecl(source, attr);
  if (!declText) {
    // The enum may live behind a NAMED CONSTANT: `class: ClassEnum.optional()` with
    // `const ClassEnum = z.enum([...])` above. Follow one level of indirection.
    const named = source.match(new RegExp(`\\b(?:[a-z0-9]+_)?${escapeRe(attr)}\\s*:\\s*([A-Za-z_$][\\w$]*)`, 'i'));
    const constDecl = named ? source.match(new RegExp(`(?:const|let|var)\\s+${escapeRe(named[1])}\\s*=\\s*(z\\.[^;]+)`, 'i')) : null;
    if (constDecl) declText = constDecl[1];
  }
  if (!declText) {
    return fieldMentioned(source, attr)
      ? { result: 'absent', detail: `no enum on "${attr}" (field present, value-set unconstrained)` }
      : { result: 'indeterminate', detail: `attribute "${attr}" not found in generated schema` };
  }
  // Collect the enum's string literals: z.enum(['a','b']) or z.union([z.literal('a'),…]).
  const enumMatch = declText.match(/z\.enum\(\s*\[([^\]]*)\]/i);
  const literals = [...declText.matchAll(/z\.literal\(\s*['"]([^'"]+)['"]/gi)].map(m => m[1].toLowerCase());
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
  const declText = findFieldDecl(source, attr);
  if (!declText) {
    return fieldMentioned(source, attr)
      ? { result: 'absent', detail: `no format validator on "${attr}" (field present, format unchecked)` }
      : { result: 'indeterminate', detail: `attribute "${attr}" not found in generated schema` };
  }
  // A `.refine(...)` on the field is a custom validator (LLMs use `.refine(isValidDate,…)`
  // for dates) — count it as format enforcement rather than a false "unchecked".
  const validators: Record<string, RegExp> = {
    email: /\.email\(|\.regex\(|\.refine\(/i,
    url: /\.url\(|\.regex\(|\.refine\(/i,
    uuid: /\.uuid\(|\.regex\(|\.refine\(/i,
    date: /\.datetime\(|\.date\(|\.regex\(|\.refine\(/i,
    regex: /\.regex\(|\.refine\(/i,
  };
  return validators[fmt].test(declText)
    ? { result: 'conforms', detail: `${fmt} format enforced` }
    : { result: 'absent', detail: `no ${fmt} validator on "${attr}"` };
}

/**
 * Check a Uniqueness constraint against a module's source. Uniqueness is enforced at
 * the storage layer, so this looks in the generated schema/migration for a UNIQUE
 * declaration on the attribute's column (`email TEXT UNIQUE`, `UNIQUE(email)`,
 * `CREATE UNIQUE INDEX … (email)`, or an ORM `.unique()`). Conforms when found;
 * absent when the column exists without it; indeterminate when the column isn't found.
 */
export function checkUniqueness(c: StructuredConstraint, source: string | null): ConstraintCheck {
  if (source == null) return { result: 'indeterminate', detail: 'module not generated yet' };
  const attr = c.binding.attribute;
  // Allow a qualified column name (owner_email for email).
  const a = `(?:[a-z0-9]+_)?${escapeRe(attr)}`;
  if (!fieldMentioned(source, attr) && !new RegExp(`\\b${a}\\b`, 'i').test(source)) {
    return { result: 'indeterminate', detail: `attribute "${attr}" not found in generated schema` };
  }
  const uniqueRe = new RegExp(
    `\\b${a}\\b[^,\\n)]*\\bunique\\b` +          // column ... UNIQUE
    `|\\bunique\\b[^,\\n(]*\\(\\s*[^)]*\\b${a}\\b` + // UNIQUE( ... email ... )
    `|create\\s+unique\\s+index[^;]*\\b${a}\\b` +    // CREATE UNIQUE INDEX ... email
    `|\\b${a}\\b\\s*:[^,\\n]*\\.unique\\(` +         // email: ....unique()  (ORM)
    `|where\\s+${a}\\s*=`,                            // SELECT ... WHERE owner_email = ?  (app-level guard)
    'i');
  return uniqueRe.test(source)
    ? { result: 'conforms', detail: `uniqueness enforced on "${attr}"` }
    : { result: 'absent', detail: `no UNIQUE constraint on "${attr}"` };
}

/**
 * Check a Reference (foreign-key) constraint against a module's source. "A
 * transaction must reference an existing account" is enforced either by a schema
 * FK declaration (`REFERENCES accounts(id)`) or by an application-level existence
 * guard (`SELECT id FROM accounts WHERE id = ?` before the write). Conforms when
 * one is found; absent when the reference field is present but unguarded;
 * indeterminate when the target isn't referenced at all.
 */
export function checkReference(c: StructuredConstraint, source: string | null): ConstraintCheck {
  if (source == null) return { result: 'indeterminate', detail: 'module not generated yet' };
  if (c.assertion.kind !== 'reference') return { result: 'indeterminate', detail: 'not a reference assertion' };
  const target = c.assertion.target;
  const t = `(?:[a-z0-9]+_)?${escapeRe(target)}`;
  const enforced = new RegExp(
    `references\\s+${t}s?\\b` +                     // SQL: ... REFERENCES accounts(id)
    `|foreign\\s+key\\b[^;\\n]*\\b${t}s?\\b` +       // SQL: FOREIGN KEY (account_id) REFERENCES accounts
    `|from\\s+${t}s?\\s+where\\b`,                   // app guard: SELECT id FROM accounts WHERE id = ?
    'i').test(source);
  if (enforced) return { result: 'conforms', detail: `referential integrity to "${target}" enforced (FK or existence guard)` };
  const mentions = new RegExp(`\\b${t}(?:_id)?\\b`, 'i').test(source);
  return mentions
    ? { result: 'absent', detail: `references "${target}" but enforces no FK / existence guard` }
    : { result: 'indeterminate', detail: `no reference to "${target}" found in module` };
}

/**
 * Check a Cardinality constraint against a module's source. "An order must have at
 * least one line item" is enforced by a non-empty / count guard on the related
 * collection (`.min(1)`, `.nonempty()`, a `.length` comparison, or a rejecting
 * count check). Conforms when a matching guard is found; absent when the relation
 * is present but unconstrained; indeterminate when the relation isn't found.
 */
export function checkCardinality(c: StructuredConstraint, source: string | null): ConstraintCheck {
  if (source == null) return { result: 'indeterminate', detail: 'module not generated yet' };
  if (c.assertion.kind !== 'cardinality') return { result: 'indeterminate', detail: 'not a cardinality assertion' };
  const rel = c.assertion.relation;
  // Allow a qualifier on either side: `line_items` (prefix) and
  // `musician_player_ids` (suffixed compound) both carry the relation.
  const r = `(?:[a-z0-9]+_)?${escapeRe(rel)}s?(?:_[a-z0-9]+)*`;
  if (!new RegExp(`\\b${r}\\b`, 'i').test(source)) {
    return { result: 'indeterminate', detail: `relation "${rel}" not found in module` };
  }
  const { min, max } = c.assertion;
  // A lower bound of ≥1 is the common "at least one" case → a non-empty guard.
  // Every guard must be CO-LOCATED with the relation (within 80 chars of its
  // mention): a `.min(1)` on an unrelated scalar field ("name must not be empty")
  // must not read as a count guard on the collection — that is a false green.
  const minGuard = min !== undefined && (
    new RegExp(`\\b${r}\\b[\\s\\S]{0,80}?(?:\\.min\\(\\s*${min}\\b|\\.nonempty\\()`, 'i').test(source) ||
    new RegExp(`\\b${r}\\b[\\s\\S]{0,80}?\\.length\\s*(?:>=?\\s*${min}\\b|>\\s*${Math.max(0, min - 1)}\\b|===?\\s*0\\b|!==?\\s*0\\b)`, 'i').test(source)
  );
  const maxGuard = max !== undefined && (
    new RegExp(`\\b${r}\\b[\\s\\S]{0,80}?\\.max\\(\\s*${max}\\b`, 'i').test(source) ||
    new RegExp(`\\b${r}\\b[\\s\\S]{0,80}?\\.length\\s*(?:<=?\\s*${max}\\b|>\\s*${max}\\b)`, 'i').test(source)
  );
  const want = (min !== undefined ? 'min' : '') + (max !== undefined ? 'max' : '');
  const ok = (min === undefined || minGuard) && (max === undefined || maxGuard);
  const shape = `${min !== undefined ? `≥${min}` : ''}${max !== undefined ? ` ≤${max}` : ''}`.trim();
  return ok
    ? { result: 'conforms', detail: `cardinality ${shape} on "${rel}" enforced` }
    : { result: 'absent', detail: `no ${want}-count guard on "${rel}" (spec requires ${shape})` };
}

/**
 * Check an Expr (relational / conditional) invariant by routing to the executable
 * oracle (checkProperty). The oracle returns a real verdict when it can reduce the
 * statement to a checkable shape (non-negativity, threshold, enum, bound, non-empty)
 * and ABSTAINS otherwise. This is the cross-module capability a single-field static
 * check cannot provide — e.g. "reject a debit that would take a balance below zero"
 * is caught when the module never guards the balance, and honestly deferred when the
 * relation is beyond static reach. It NEVER returns conforms for a property it did
 * not verify.
 */
export function checkExpr(c: StructuredConstraint, source: string | null): ConstraintCheck {
  if (source == null) return { result: 'indeterminate', detail: 'module not generated yet' };
  if (c.assertion.kind !== 'expr') return { result: 'indeterminate', detail: 'not an expr assertion' };
  const r = checkProperty(c.assertion.statement, source);
  if (r.status !== 'indeterminate') {
    const result: CheckResult = r.status === 'pass' ? 'conforms' : 'violates';
    return { result, detail: r.reason };
  }
  // Static reduction abstained — try the EXECUTABLE path for recognized aggregate
  // shapes. `conforms` here is mutation-gated: the runner only passes an eval that
  // provably catches planted bugs, so this is an earned green, not a hopeful one.
  const prop = deriveAggregateProperty(c.assertion.statement);
  if (prop) {
    const ex = runAggregateProperty(prop, source);
    if (ex.status === 'pass' && ex.gated) return { result: 'conforms', detail: ex.reason, method: 'behavioral-gated' };
    if (ex.status === 'fail') return { result: 'violates', detail: ex.reason, method: 'behavioral-gated' };
    return { result: 'indeterminate', detail: ex.reason };
  }
  return { result: 'indeterminate', detail: r.reason };
}

/**
 * Check a Temporal constraint ("a transaction date must not occur in the future")
 * against a module's source. Enforcement is a validator on the field comparing the
 * value against now/today — in the generated dialect, a `.refine(isNotFuture, …)`
 * whose name or message carries the temporal cue, or an explicit comparison with
 * `new Date()`/`Date.now()`. A `.refine(isValidDate, …)` is a FORMAT validator, not
 * a temporal one — it must not read as enforcement (that would be a false green).
 */
export function checkTemporal(c: StructuredConstraint, source: string | null): ConstraintCheck {
  if (source == null) return { result: 'indeterminate', detail: 'module not generated yet' };
  if (c.assertion.kind !== 'temporal') return { result: 'indeterminate', detail: 'not a temporal assertion' };
  const attr = c.binding.attribute;
  const declText = findFieldDecl(source, attr);
  if (!declText) {
    return fieldMentioned(source, attr)
      ? { result: 'absent', detail: `no temporal validator on "${attr}" (field present, ${c.assertion.mode} unchecked)` }
      : { result: 'indeterminate', detail: `attribute "${attr}" not found in generated schema` };
  }
  const cue = c.assertion.mode === 'not-future' ? /future/i : /past/i;
  let enforced = cue.test(declText) || /[<>]=?\s*(?:new\s+Date\(|Date\.now\(|today)/i.test(declText);
  if (!enforced) {
    // The validator may sit at the OBJECT level, not on the field chain:
    // `}).refine(data => new Date(data.date) <= new Date(), { message: '… future', path: ['date'] })`.
    // An object refine counts when it names both the attribute and the temporal cue.
    const attrRe = new RegExp(`\\b(?:[a-z0-9]+_)?${escapeRe(attr)}\\b`, 'i');
    for (const m of source.matchAll(/\.refine\(/g)) {
      const win = source.slice(m.index!, m.index! + 250);
      if (attrRe.test(win) && (cue.test(win) || /[<>]=?\s*new\s+Date\(/.test(win))) { enforced = true; break; }
    }
  }
  return enforced
    ? { result: 'conforms', detail: `${c.assertion.mode} enforced on "${attr}"` }
    : { result: 'absent', detail: `no ${c.assertion.mode} validator on "${attr}"` };
}

/**
 * Check a Presence (required-field) constraint against a module's source. The field
 * must exist in the input schema and must NOT be `.optional()`/`.nullish()`. The
 * FIRST declaration in source order is the create/input schema in the generated
 * dialect (update schemas, where everything is optional, come after) — mirroring
 * findFieldDecl's first-match rule keeps this checker consistent with the others.
 */
export function checkPresence(c: StructuredConstraint, source: string | null): ConstraintCheck {
  if (source == null) return { result: 'indeterminate', detail: 'module not generated yet' };
  if (c.assertion.kind !== 'presence') return { result: 'indeterminate', detail: 'not a presence assertion' };
  const attr = c.binding.attribute;
  const declText = findFieldDecl(source, attr);
  if (!declText) {
    return fieldMentioned(source, attr)
      ? { result: 'absent', detail: `required field "${attr}" is not declared in the input schema` }
      : { result: 'indeterminate', detail: `attribute "${attr}" not found in generated schema` };
  }
  return /\.optional\(|\.nullish\(/.test(declText)
    ? { result: 'absent', detail: `"${attr}" is optional in the input schema; spec requires it` }
    : { result: 'conforms', detail: `required field "${attr}" present and non-optional` };
}

/** Dispatch a constraint to its kind's static checker. */
export function checkConstraint(c: StructuredConstraint, source: string | null): ConstraintCheck {
  if (c.assertion.kind === 'bound') {
    const r = checkBound(c, source);
    return { result: r.result, detail: r.detail };
  }
  if (c.assertion.kind === 'membership') return checkMembership(c, source);
  if (c.assertion.kind === 'pattern') return checkPattern(c, source);
  if (c.assertion.kind === 'reference') return checkReference(c, source);
  if (c.assertion.kind === 'cardinality') return checkCardinality(c, source);
  if (c.assertion.kind === 'expr') return checkExpr(c, source);
  if (c.assertion.kind === 'temporal') return checkTemporal(c, source);
  if (c.assertion.kind === 'presence') return checkPresence(c, source);
  return checkUniqueness(c, source);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
