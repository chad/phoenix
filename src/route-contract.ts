/**
 * Route-contract reader — the seeder overlay (P2).
 *
 * The spec-aware seeder (live-seed.ts) synthesizes create bodies from what Phoenix knows
 * BEFORE generation: the schema plan (DDL) + the constraint algebra. But some acceptance
 * requirements live ONLY in the generated module's Zod create-schema, never reaching the
 * DDL or the constraint graph:
 *
 *   - a named-const enum      const PRIORITIES = ['low','high'] as const; … z.enum(PRIORITIES)
 *   - a CSV-shape refine      tags: z.string().refine(s => s.split(',').length >= 2)
 *   - route-level requiredness a column the DDL marks DEFAULT-nullable that the route's
 *                             create-schema nonetheless requires (no .optional()/.default())
 *
 * The afterimage cold-start (NIGHT-REPORT-5) hit exactly this: the seeder sent a
 * single-part CSV for a field whose route demanded ≥2 parts, and the create route
 * rejected — an honest abstention, but an avoidable one. This module is the overlay:
 * it READS the generated module's create-schema and hands the seeder the acceptance
 * facts it cannot derive from the spec alone.
 *
 * Discipline (gate 6): the overlay only makes seeding MORE VALID — it never relaxes a
 * verdict, and unknown shapes abstain honestly: a schema shape this reader does not
 * recognize simply yields no contract entry, and the seeder falls back to its
 * constraints/type defaults exactly as before.
 *
 * Precedence when synthesizing a value (lowest-wins order of truth): the DB's own
 * CHECK-IN enum (DDL) → route-contract enum → the constraint algebra → csv-min-parts →
 * the column/scalar type default.
 */

export interface RouteFieldContract {
  /** z.enum([...]) / z.enum(NAMED_CONST) / z.union([z.literal(...)]) — the accepted set. */
  enumValues?: Array<string | number>;
  /** z.string().refine(s => s.split(',').length >= N) — a CSV of at least N parts. */
  csvMinParts?: number;
  /** The field may be omitted in the create body (.optional() or .default(...) present). */
  optional: boolean;
  /** The declared scalar family, when the column's SQL type is too coarse to see it. */
  scalar?: 'string' | 'number' | 'boolean';
  /** A scalar-number field named `<entity>_id` — a route-level foreign key the DDL may
   *  not declare (the afterimage match.ensemble_id). The seeder resolves the hinted
   *  entity against the schema plan's tables and seeds the parent first; unresolved
   *  hints fall back to the scalar default (and an honest rejection if the route
   *  validates existence).
   */
  fkHint?: string;
  /** `z.array(z.number().int()).min(N)` on an `*_ids` field — the route requires N
   *  EXISTING foreign ids (the afterimage ensemble.musician_ids). Read so the seeder
   *  can abstain EARLY with a precise reason; synthesizing N real ids is the seeding
   *  frontier (the referenced table does not resolve from the field name alone).
   */
  idArrayMin?: number;
}

/** field name → its route-level acceptance facts. */
export type RouteContract = Map<string, RouteFieldContract>;

/** Split a z.object body on TOP-LEVEL commas (parens/brackets/braces stay intact). */
function splitFields(body: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Consume a balanced delimiter run starting at `start` (which must be the opener). */
function balanced(text: string, start: number, open: string, close: string): string | null {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return text.slice(start + 1, i);
    }
  }
  return null;
}

/** Parse the values of an array literal `['a', 'b']` / `[1, 2, 3]` (strings and numbers). */
function arrayValues(text: string): Array<string | number> {
  const out: Array<string | number> = [];
  for (const m of text.matchAll(/'([^']*)'|"([^"]*)"|(\d+(?:\.\d+)?)/g)) {
    if (m[3] !== undefined) out.push(Number(m[3]));
    else out.push(m[1] ?? m[2]);
  }
  return out;
}

/**
 * Parse a generated module's Zod CREATE schema into a route contract. Reads the first
 * `Create*Schema = z.object({...})` (falling back to the first z.object when no Create-
 * prefixed schema exists) — the body the POST route parses. Named consts
 * (`const X = [...] as const`) are resolved for `z.enum(X)`. Anything unrecognized is
 * skipped, so an unfamiliar schema yields a partial (or empty) contract, never a guess.
 */
export function parseRouteContract(source: string): RouteContract {
  const contract: RouteContract = new Map();

  // Named value-set consts: const PRIORITIES = ['low', 'high'] as const;
  const namedSets = new Map<string, Array<string | number>>();
  for (const m of source.matchAll(/const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*\[([\s\S]*?)\]\s*as\s+const/g)) {
    namedSets.set(m[1], arrayValues(m[2]));
  }
  // Named ZOD-const enums (the afterimage dialect): const CardTypeEnum = z.enum([...]);
  const zodConstEnums = new Map<string, Array<string | number>>();
  for (const m of source.matchAll(/const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*z\.enum\(\s*\[([\s\S]*?)\]\s*\)/g)) {
    zodConstEnums.set(m[1], arrayValues(m[2]));
  }

  // Locate the create schema's object body.
  const createM = /\bCreate\w*Schema\s*=\s*z\.object\(\s*\{/.exec(source)
    ?? /\bz\.object\(\s*\{/.exec(source);
  if (!createM) return contract;
  const body = balanced(source, createM.index + createM[0].length - 1, '{', '}');
  if (body === null) return contract;

  for (const field of splitFields(body)) {
    const fm = /^\s*([a-z_][\w]*)\s*:\s*([\s\S]+)$/.exec(field);
    if (!fm) continue;
    const [, name, chain] = fm;

    // Value-set: inline enum, named-const enum, or a union of literals.
    let enumValues: Array<string | number> | undefined;
    const inlineEnum = /z\.enum\(\s*\[([\s\S]*?)\]\s*\)/.exec(chain);
    const namedEnum = /z\.enum\(\s*([A-Z][A-Za-z0-9_]*)\s*\)/.exec(chain);
    const bareConst = /^\s*([A-Z][A-Za-z0-9_]*)\s*(?:\.optional\(\)|\.nullable\(\)|\.default\([\s\S]*|\s*)$/.exec(chain);
    const union = /z\.union\(\s*\[([\s\S]*?)\]\s*\)/.exec(chain);
    if (inlineEnum) enumValues = arrayValues(inlineEnum[1]);
    else if (namedEnum && namedSets.has(namedEnum[1])) enumValues = namedSets.get(namedEnum[1]);
    else if (namedEnum && zodConstEnums.has(namedEnum[1])) enumValues = zodConstEnums.get(namedEnum[1]);
    else if (bareConst && zodConstEnums.has(bareConst[1])) enumValues = zodConstEnums.get(bareConst[1]);
    else if (union) {
      const lits = [...union[1].matchAll(/z\.literal\(\s*(?:'([^']*)'|"([^"]*)"|(\d+(?:\.\d+)?))\s*\)/g)];
      if (lits.length > 0) enumValues = lits.map(l => l[3] !== undefined ? Number(l[3]) : (l[1] ?? l[2]));
    }

    // CSV-shape refine: .refine(s => s.split(',').length >= N) (arrow or function form).
    const csv = /\.refine\([\s\S]*?\.split\(\s*['"](,)['"]\s*\)\.length\s*>=\s*(\d+)/.exec(chain);
    const csvMinParts = csv ? parseInt(csv[2], 10) : undefined;

    const optional = /\.optional\(\)|\.default\(/.test(chain);
    const scalar = /\bz\.number\(\)/.test(chain) ? 'number'
      : /\bz\.boolean\(\)/.test(chain) ? 'boolean'
      : /\bz\.string\(\)/.test(chain) ? 'string'
      : undefined;

    // Route-level FK facts (see the interface docs): a `<entity>_id` scalar number, and
    // an `*_ids` array of numbers with a min length.
    const fkM = /^([a-z][a-z0-9_]*)_id$/.exec(name);
    const fkHint = fkM && scalar === 'number' ? fkM[1] : undefined;
    const arrM = /_ids$/.test(name)
      ? /z\.array\(\s*z\.number\(\)[^)]*\)\s*\)\.min\((\d+)\)/.exec(chain)
      : null;
    const idArrayMin = arrM ? parseInt(arrM[1], 10) : undefined;

    contract.set(name, { enumValues, csvMinParts, optional, scalar, fkHint, idArrayMin });
  }
  return contract;
}
