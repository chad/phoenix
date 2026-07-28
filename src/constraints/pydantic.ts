/**
 * Pydantic enforcement reader — the per-runtime constraint-checker hook.
 *
 * The checkers in check.ts read the node-typescript (Zod) dialect: `.max(60)`,
 * `z.enum([...])`, `.optional()`. A python-fastapi module enforces the SAME spec
 * constraint a different way — `name: str = Field(max_length=60)` — and the Zod
 * reader is blind to it, so a python module that DOES enforce the bound read as
 * `absent`: the verdict diverged from node for identical enforcement (the
 * cross-runtime-parity red).
 *
 * This module is the fix the red describes: a per-runtime reader. It owns the
 * READING half only — dialect detection, field-declaration discovery, and per-kind
 * enforcement facts — and it mirrors check.ts's verdict semantics EXACTLY:
 *   conforms      : the field carries the right enforcement
 *   violates      : the field carries the WRONG value (Field(max_length=100) when the
 *                   spec says 80)
 *   absent        : the field exists (or is mentioned) but carries no enforcement
 *   indeterminate : the attribute isn't found to reason about
 * The RULES never change with the runtime — only the reader's eyes widen. WHAT is
 * checked is frozen; this module changes nothing a generator/repairer could exploit,
 * because a `conforms` here demands the same enforcement a Zod `conforms` demands.
 *
 * Dialect ownership: this reader claims a source ONLY when it looks like a Pydantic
 * model module (`BaseModel` + a pydantic idiom) and never when Zod chains are
 * present (a TS module is the regex/AST readers' territory). SQL-acting kinds
 * (uniqueness, reference) are language-agnostic — the existing readers already read
 * DDL in any host language, so they are NOT re-implemented here; expr and
 * temporal-relative keep their honest abstain/oracle routing.
 */

import type { StructuredConstraint } from './model.js';
import type { CheckResult, CheckMethod } from '../models/validation.js';

export interface ConstraintCheck {
  result: CheckResult;
  detail: string;
  method?: CheckMethod;
  /** The bound value found in code, when a bound was read (mirrors check.ts's BoundCheck). */
  found?: number;
}

/**
 * Whether the source reads as a Pydantic (python-fastapi) module: a BaseModel
 * subclass plus a pydantic enforcement idiom, and no Zod chains. Zod presence wins —
 * a TS module with a stray "Field(" mention in a comment stays with the TS readers.
 */
export function looksPydantic(source: string): boolean {
  if (/\bz\.\s*(?:object|string|number|enum|array|literal)\s*\(/.test(source)) return false;
  // A BaseModel subclass is the claim — even with NO Field(/Literal idiom present,
  // because the NEGATIVE verdicts (field present but unenforced ⇒ absent) are parity
  // too: a bare `name: str` must read as a pydantic field, not fall to the Zod path.
  return /class\s+\w+\s*\([^)]*BaseModel[^)]*\)\s*:/.test(source);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Qualified field-name pattern, mirroring check.ts: a prefix (`owner_email`) or a
 *  suffixed compound (`musician_player_ids`) both carry the attribute. */
const nameRe = (attr: string, plural = false) =>
  `\\b(?:[a-z0-9]+_)?${escapeRe(attr)}${plural ? 's?' : ''}(?:_[a-z0-9]+)*`;

export interface PyFieldDecl {
  /** The field's declared name as written (e.g. `owner_email`). */
  name: string;
  /** The type annotation text between `:` and any `=` (e.g. `Optional[str]`). */
  annotation: string;
  /** The Field(...) argument text, when the declaration calls Field (paren-balanced,
   *  possibly multi-line). */
  fieldArgs?: string;
  /** The full declaration text (annotation + Field args), for cue matching. */
  text: string;
  /** The bodies of any `@field_validator('<name>', …)` blocks for this field. */
  validators: string[];
}

/**
 * Locate a field's Pydantic declaration inside a BaseModel subclass, mirroring
 * check.ts's findFieldDecl: first declaration in source order wins (the create/input
 * model comes first in the generated dialect), qualified names allowed. Returns the
 * annotation, any Field(...) args, and the field's field_validator blocks — the
 * three places pydantic carries enforcement.
 */
export function findPyFieldDecl(source: string, attr: string, plural = false): PyFieldDecl | null {
  const re = new RegExp(`^[ \\t]*(${nameRe(attr, plural)})\\s*:[ \\t]*([^\\n]*)$`, 'm');
  const m = re.exec(source);
  if (!m) return null;
  const name = m[1];
  // A Field(...) / conlist(...) call may span lines — consume until the parens balance.
  let full = m[2];
  let depth = 0;
  for (const ch of full) { if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') depth--; }
  if (depth > 0) {
    let i = m.index + m[0].length;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      full += ch;
      i++;
      if (depth === 0) break;
    }
  }
  const text = `${name}: ${full.trim()}`;
  // Split annotation from default at the first TOP-LEVEL '=' (an '=' inside parens,
  // like conlist's min_length=1, belongs to the annotation call).
  let annotation = full, deflt = '';
  depth = 0;
  for (let k = 0; k < full.length; k++) {
    const ch = full[k];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === '=' && depth === 0) { annotation = full.slice(0, k); deflt = full.slice(k + 1); break; }
  }
  annotation = annotation.trim();
  const fm = deflt.match(/\bField\s*\(([\s\S]*)\)\s*$/);
  return { name, annotation, fieldArgs: fm ? fm[1] : undefined, text, validators: pyValidators(source, name) };
}

/** Collect the decorator+body of every `@field_validator('<name>'…)` for the field —
 *  pydantic's analogue of a Zod `.refine(...)` (custom enforcement lives here). */
function pyValidators(source: string, fieldName: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`@field_validator\\(\\s*['"]${escapeRe(fieldName)}['"]`, 'g');
  for (const m of source.matchAll(re)) {
    // The block = the decorator line, any further decorators, the def line, and the
    // def's indented body — it ends at the first non-blank line dedented to (or past)
    // the def's own indent (the next decorator, def, or class member).
    const lines = source.slice(m.index).split('\n');
    const block: string[] = [lines[0]];
    let defIndent: number | null = null;
    for (let k = 1; k < lines.length && k < 80; k++) {
      const line = lines[k];
      if (line.trim() === '') { block.push(line); continue; }
      const indent = line.length - line.trimStart().length;
      if (defIndent === null) {
        block.push(line);
        if (/^\s*def\s/.test(line)) defIndent = indent;
        continue;
      }
      if (indent <= defIndent) break;
      block.push(line);
    }
    out.push(block.join('\n'));
  }
  return out;
}

/** Whether the attribute (or a qualified form of it) is referenced anywhere —
 *  mirrors check.ts's fieldMentioned for the absent-vs-indeterminate distinction. */
function pyFieldMentioned(source: string, attr: string): boolean {
  return new RegExp(`\\b(?:[a-z0-9]+_)?${escapeRe(attr)}\\b`, 'i').test(source);
}

/** Resolve a `class X(str, Enum):` member set, when the annotation names such a class. */
function pyEnumMembers(source: string, annotation: string): string[] | null {
  const typeName = annotation.trim().replace(/^Optional\[(.+)\]$/, '$1').trim();
  if (!/^[A-Za-z_]\w*$/.test(typeName)) return null;
  const cls = source.match(new RegExp(`class\\s+${escapeRe(typeName)}\\s*\\([^)]*Enum[^)]*\\)\\s*:\\s*\\n((?:[ \\t]+[^\\n]*\\n?)*)`));
  if (!cls) return null;
  const values = [...cls[1].matchAll(/^\s*\w+\s*=\s*['"]([^'"]+)['"]/gm)].map(v => v[1].toLowerCase());
  return values.length > 0 ? values.sort() : null;
}

/** Literal members of a `Literal['a', 'b']` annotation (Optional unwrapped). */
function pyLiteralMembers(annotation: string): string[] | null {
  const unwrapped = annotation.replace(/^Optional\[(.+)\]$/, '$1');
  const m = unwrapped.match(/Literal\s*\[([^\]]*)\]/);
  if (!m) return null;
  const values = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(v => v[1].toLowerCase());
  return values.length > 0 ? values.sort() : null;
}

// ── Bound ──────────────────────────────────────────────────────────────────────
function checkPyBound(c: StructuredConstraint, source: string): ConstraintCheck {
  const a = c.assertion as Extract<StructuredConstraint['assertion'], { kind: 'bound' }>;
  const attr = c.binding.attribute;
  // The kwargs mirror the Zod .max()/.min(): a char-length bound is max_length/
  // min_length, a numeric bound is le/ge. Either family enforces the spec's op.
  const kws = a.op === '<=' ? ['max_length', 'le'] : ['min_length', 'ge'];
  const decl = findPyFieldDecl(source, attr);
  if (!decl) {
    return pyFieldMentioned(source, attr)
      ? { result: 'absent', detail: `no ${kws[0]}() bound on "${attr}" (field present, bound missing)` }
      : { result: 'indeterminate', detail: `attribute "${attr}" not found in generated schema` };
  }
  let found: number | undefined;
  for (const kw of kws) {
    const km = (decl.fieldArgs ?? decl.text).match(new RegExp(`\\b${kw}\\s*=\\s*(\\d+)`));
    if (km) { found = parseInt(km[1], 10); break; }
  }
  if (found === undefined) {
    return { result: 'absent', detail: `no Field(${kws.join('=/')}=) on "${attr}"` };
  }
  return found === a.value
    ? { result: 'conforms', found, detail: `${kws[0]}=${found} matches` }
    : { result: 'violates', found, detail: `${kws[0]}=${found} but spec requires ${a.op} ${a.value}` };
}

// ── Membership ─────────────────────────────────────────────────────────────────
function checkPyMembership(c: StructuredConstraint, source: string): ConstraintCheck {
  const a = c.assertion as Extract<StructuredConstraint['assertion'], { kind: 'membership' }>;
  const attr = c.binding.attribute;
  const want = [...a.values].map(v => v.toLowerCase()).sort();
  const decl = findPyFieldDecl(source, attr);
  if (!decl) {
    return pyFieldMentioned(source, attr)
      ? { result: 'absent', detail: `no Literal/Enum on "${attr}" (field present, value-set unconstrained)` }
      : { result: 'indeterminate', detail: `attribute "${attr}" not found in generated schema` };
  }
  const got = pyLiteralMembers(decl.annotation) ?? pyEnumMembers(source, decl.annotation);
  if (!got) return { result: 'absent', detail: `no Literal[...]/Enum value-set on "${attr}"` };
  const same = got.length === want.length && got.every((v, i) => v === want[i]);
  return same
    ? { result: 'conforms', detail: `value-set [${got.join(', ')}] matches` }
    : { result: 'violates', detail: `value-set [${got.join(', ')}] but spec requires [${want.join(', ')}]` };
}

// ── Pattern ────────────────────────────────────────────────────────────────────
function checkPyPattern(c: StructuredConstraint, source: string): ConstraintCheck {
  const a = c.assertion as Extract<StructuredConstraint['assertion'], { kind: 'pattern' }>;
  const attr = c.binding.attribute;
  const decl = findPyFieldDecl(source, attr);
  if (!decl) {
    return pyFieldMentioned(source, attr)
      ? { result: 'absent', detail: `no format validator on "${attr}" (field present, format unchecked)` }
      : { result: 'indeterminate', detail: `attribute "${attr}" not found in generated schema` };
  }
  // Mirrors the Zod path's table: a dedicated pydantic type, a `pattern=` regex, or a
  // custom field_validator (the `.refine` analogue) all count as format enforcement.
  const hasValidator = decl.validators.length > 0;
  const inText = (re: RegExp) => re.test(decl.annotation) || re.test(decl.fieldArgs ?? '') || re.test(decl.text);
  const validators: Record<string, boolean> = {
    email: /\bEmailStr\b/.test(decl.annotation) || inText(/\bpattern\s*=/) || hasValidator,
    url: /\b(?:AnyUrl|HttpUrl|AnyHttpUrl)\b/.test(decl.annotation) || inText(/\bpattern\s*=/) || hasValidator,
    uuid: /\bUUID\b/.test(decl.annotation) || inText(/\bpattern\s*=/) || hasValidator,
    date: /\b(?:date|datetime|PastDate|FutureDate|AwareDatetime|NaiveDatetime)\b/.test(decl.annotation) || inText(/\bpattern\s*=/) || hasValidator,
    regex: inText(/\bpattern\s*=/) || hasValidator,
  };
  return validators[a.format]
    ? { result: 'conforms', detail: `${a.format} format enforced` }
    : { result: 'absent', detail: `no ${a.format} validator on "${attr}"` };
}

// ── Presence ───────────────────────────────────────────────────────────────────
function checkPyPresence(c: StructuredConstraint, source: string): ConstraintCheck {
  const attr = c.binding.attribute;
  const decl = findPyFieldDecl(source, attr);
  if (!decl) {
    return pyFieldMentioned(source, attr)
      ? { result: 'absent', detail: `required field "${attr}" is not declared in the input schema` }
      : { result: 'indeterminate', detail: `attribute "${attr}" not found in generated schema` };
  }
  // Pydantic's `.optional()` analogue: an Optional[...] annotation or a None default
  // (bare `= None` or Field(default=None)). A Field(...) with no default is REQUIRED,
  // exactly like a bare z-chain without .optional().
  const optional = /\bOptional\s*\[/.test(decl.annotation)
    || /=\s*None\b/.test(decl.text)
    || /\bdefault\s*=\s*None\b/.test(decl.fieldArgs ?? '');
  return optional
    ? { result: 'absent', detail: `"${attr}" is optional in the input schema; spec requires it` }
    : { result: 'conforms', detail: `required field "${attr}" present and non-optional` };
}

// ── Cardinality ────────────────────────────────────────────────────────────────
function checkPyCardinality(c: StructuredConstraint, source: string): ConstraintCheck {
  const a = c.assertion as Extract<StructuredConstraint['assertion'], { kind: 'cardinality' }>;
  const rel = a.relation;
  // The relation is a COLLECTION field: list[...]/set[...]/conlist(...). The guard
  // mirrors the Zod .min(N)/.nonempty(): Field(min_length=N) on the collection, or a
  // conlist(Item, min_length=N) annotation.
  const decl = findPyFieldDecl(source, rel, /*plural*/ true);
  if (!decl) {
    return pyFieldMentioned(source, rel)
      ? { result: 'absent', detail: `no count guard on "${rel}" (relation present, unconstrained)` }
      : { result: 'indeterminate', detail: `relation "${rel}" not found in module` };
  }
  const { min, max } = a;
  // Read kwargs from the WHOLE declaration text: a conlist(Item, min_length=1) carries
  // its guard inside the annotation call, not a Field(...) default.
  const argText = `${decl.text} ${decl.validators.join('\n')}`;
  const kwVal = (kw: string): number | undefined => {
    const m = argText.match(new RegExp(`\\b${kw}\\s*=\\s*(\\d+)`));
    return m ? parseInt(m[1], 10) : undefined;
  };
  const minGuard = min !== undefined && (kwVal('min_length') === min || kwVal('min_items') === min);
  const maxGuard = max !== undefined && (kwVal('max_length') === max || kwVal('max_items') === max);
  const ok = (min === undefined || minGuard) && (max === undefined || maxGuard);
  const shape = `${min !== undefined ? `≥${min}` : ''}${max !== undefined ? ` ≤${max}` : ''}`.trim();
  const want = (min !== undefined ? 'min' : '') + (max !== undefined ? 'max' : '');
  return ok
    ? { result: 'conforms', detail: `cardinality ${shape} on "${rel}" enforced` }
    : { result: 'absent', detail: `no ${want}-count guard on "${rel}" (spec requires ${shape})` };
}

// ── Temporal ───────────────────────────────────────────────────────────────────
function checkPyTemporal(c: StructuredConstraint, source: string): ConstraintCheck {
  const a = c.assertion as Extract<StructuredConstraint['assertion'], { kind: 'temporal' }>;
  const attr = c.binding.attribute;
  const decl = findPyFieldDecl(source, attr);
  if (!decl) {
    return pyFieldMentioned(source, attr)
      ? { result: 'absent', detail: `no temporal validator on "${attr}" (field present, ${a.mode} unchecked)` }
      : { result: 'indeterminate', detail: `attribute "${attr}" not found in generated schema` };
  }
  const cue = a.mode === 'not-future' ? /future/i : /past/i;
  // Dedicated types enforce the mode outright (PastDate rejects future dates; a bare
  // `date` annotation is a FORMAT only — the Zod path's isValidDate trap, mirrored).
  const typed = a.mode === 'not-future' ? /\bPastDate\b/.test(decl.annotation) : /\bFutureDate\b/.test(decl.annotation);
  // A field_validator carrying the temporal cue, or an explicit comparison against
  // today/now in the declaration or its validators.
  const compared = [...decl.validators, decl.text].some(t =>
    cue.test(t) || /[<>]=?\s*(?:date\.today\(\)|datetime\.now\(\)|datetime\.utcnow\(\))/i.test(t));
  return typed || compared
    ? { result: 'conforms', detail: `${a.mode} enforced on "${attr}"` }
    : { result: 'absent', detail: `no ${a.mode} validator on "${attr}"` };
}

/**
 * Dispatch a constraint to its Pydantic reader. Returns null when this reader does
 * not own the case — a non-Pydantic source, or a kind that stays with the existing
 * paths (uniqueness/reference read SQL, which is language-agnostic; expr routes to
 * the executable oracle; temporal-relative abstains for the live clock eval) — so
 * the caller falls through to the unchanged checkers. The frozen-verifier
 * discipline: owning only the READING, never the rules.
 */
export function checkConstraintPydantic(c: StructuredConstraint, source: string): ConstraintCheck | null {
  if (!looksPydantic(source)) return null;
  switch (c.assertion.kind) {
    case 'bound': return checkPyBound(c, source);
    case 'membership': return checkPyMembership(c, source);
    case 'pattern': return checkPyPattern(c, source);
    case 'presence': return checkPyPresence(c, source);
    case 'cardinality': return checkPyCardinality(c, source);
    case 'temporal': return checkPyTemporal(c, source);
    default: return null; // uniqueness / reference / expr / temporal-relative → existing paths
  }
}
