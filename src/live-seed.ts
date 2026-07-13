/**
 * Spec-aware seeding (P0) — deterministically synthesize VALID request payloads for a
 * generated app's create routes, so the live oracle can drive real evals instead of
 * abstaining on multi-field / foreign-key POST bodies.
 *
 * The live harness (src/live-harness.ts) boots the real generated app and drives its
 * HTTP surface, but a create route like `POST /transaction` needs a whole body
 * (`account_id`, `amount`, `type`, `status`) and a REAL parent account to reference.
 * Generic single-field seeding can't satisfy that, so the harness has been abstaining on
 * every real app (NIGHT-REPORT-4's honest ceiling). This module closes that: it reads
 * what Phoenix ALREADY knows before generation — the schema plan (tables × columns × FKs)
 * and the 9-kind constraint algebra — and emits a valid body from it.
 *
 * The synthesis is the INVERSE of the checkers (gate 2 — it never changes WHAT is
 * checked, only produces inputs the running app should accept):
 *   - bound (≤N / ≥N)      → a mid-range value (a string of a valid length, or a number)
 *   - membership {a,b}     → a declared member (the first)
 *   - pattern email/url/…  → a valid instance of that format
 *   - temporal not-future  → a past date; not-past → a future date
 *   - presence             → include the field with a typed default
 *   - reference (FK)        → a REAL id returned by seeding the parent entity first
 *   - unconstrained column → a type-correct default (TEXT→string, INTEGER→int, REAL→float)
 *
 * Foreign keys define a DAG over entities; we topologically sort it, seed parents first,
 * and thread each returned id into its children's FK fields. A cycle or an unresolvable
 * FK is NOT guessed — the affected entities are reported unseedable so the harness abstains
 * honestly (never a false green), exactly the discipline the rest of the codebase holds.
 *
 * Determinism: a fixed-seed RNG, so a verdict is reproducible boot to boot.
 */

import type { StructuredConstraint } from './constraints/model.js';

// ─── Schema parse (richer than SchemaModel: types + FKs + not-null + defaults) ──

export interface ColumnSchema {
  name: string;
  /** Coarse SQL type family, lowercased ('integer' | 'text' | 'real' | 'blob' | ''). */
  type: string;
  notNull: boolean;
  hasDefault: boolean;
  isPrimaryKey: boolean;
  isAutoincrement: boolean;
  /** The referenced table (plural, lowercased) when this column is a foreign key. */
  fkTable?: string;
}

export interface TableSchema {
  name: string;                 // plural table name, lowercased
  columns: ColumnSchema[];
}

/** Split a CREATE TABLE column body on top-level commas (parens stay intact). */
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const TABLE_CONSTRAINT_KW = new Set(['primary', 'foreign', 'unique', 'check', 'constraint']);

/**
 * Parse CREATE TABLE statements into per-column schemas, carrying the type, NOT NULL,
 * DEFAULT, primary-key, and foreign-key facts the seeder needs. Depth-aware so a
 * DEFAULT (datetime('now')) or CHECK(...) does not truncate the parse.
 */
export function parseTableSchemas(ddl: string): TableSchema[] {
  const tables: TableSchema[] = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?["'`]?([a-z_][\w]*)["'`]?\s*\(/gi;
  for (const m of ddl.matchAll(re)) {
    const name = m[1].toLowerCase();
    let depth = 1, i = m.index! + m[0].length;
    const start = i;
    while (i < ddl.length && depth > 0) {
      if (ddl[i] === '(') depth++;
      else if (ddl[i] === ')') depth--;
      i++;
    }
    const body = ddl.slice(start, i - 1);
    const columns: ColumnSchema[] = [];
    // Table-level FK: FOREIGN KEY (col) REFERENCES other(id) — attribute it to the column.
    const tableFks = new Map<string, string>();
    for (const item of splitTopLevel(body)) {
      const t = item.trim();
      const fk = t.match(/^foreign\s+key\s*\(\s*["'`]?([a-z_][\w]*)["'`]?\s*\)\s*references\s+["'`]?([a-z_][\w]*)/i);
      if (fk) tableFks.set(fk[1].toLowerCase(), fk[2].toLowerCase());
    }
    for (const item of splitTopLevel(body)) {
      const t = item.trim();
      const first = t.match(/^["'`]?([a-z_][\w]*)["'`]?/i)?.[1]?.toLowerCase();
      if (!first || TABLE_CONSTRAINT_KW.has(first)) continue;
      const lower = t.toLowerCase();
      const typeMatch = lower.match(/^["'`]?[a-z_][\w]*["'`]?\s+([a-z]+)/);
      const inlineFk = lower.match(/references\s+["'`]?([a-z_][\w]*)/);
      columns.push({
        name: first,
        type: typeMatch ? typeMatch[1] : '',
        notNull: /\bnot\s+null\b/.test(lower),
        hasDefault: /\bdefault\b/.test(lower),
        isPrimaryKey: /\bprimary\s+key\b/.test(lower),
        isAutoincrement: /\bautoincrement\b/.test(lower),
        fkTable: (inlineFk?.[1] ?? tableFks.get(first))?.toLowerCase(),
      });
    }
    tables.push({ name, columns });
  }
  return tables;
}

// ─── FK topology ─────────────────────────────────────────────────────────────

export type TopoResult =
  | { ok: true; order: string[] }
  | { ok: false; cycle: string[] };

/**
 * Topologically sort tables so every table comes after the tables it references
 * (parents first). A self-loop or a cycle among the given tables → not ok, with the
 * offending tables named. FKs to tables NOT in the set are ignored (external / absent).
 */
export function topoSortTables(tables: TableSchema[]): TopoResult {
  const names = new Set(tables.map(t => t.name));
  const deps = new Map<string, Set<string>>();
  for (const t of tables) {
    const s = new Set<string>();
    for (const c of t.columns) if (c.fkTable && names.has(c.fkTable) && c.fkTable !== t.name) s.add(c.fkTable);
    deps.set(t.name, s);
  }
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  let cycle: string[] | null = null;
  const stack: string[] = [];
  const visit = (n: string): boolean => {
    const st = state.get(n);
    if (st === 'done') return true;
    if (st === 'visiting') { cycle = [...stack.slice(stack.indexOf(n)), n]; return false; }
    state.set(n, 'visiting');
    stack.push(n);
    for (const d of deps.get(n) ?? []) if (!visit(d)) return false;
    stack.pop();
    state.set(n, 'done');
    order.push(n);
    return true;
  };
  for (const t of tables) if (!state.get(t.name)) { if (!visit(t.name)) return { ok: false, cycle: cycle! }; }
  return { ok: true, order };
}

// ─── Deterministic value synthesis (the inverse of the algebra) ────────────────

/** Fixed-seed LCG — deterministic, reproducible verdicts. */
export function makeSeededRng(seed = 0x5EED): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; };
}

const FIXED_UUID = '00000000-0000-4000-8000-000000000000';
const pastDate = () => '2020-01-02';
const futureDate = () => new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);

/** A valid value for one column, honoring any constraint on its attribute. `fkId` is the
 *  already-seeded parent id when the column is a foreign key. Returns undefined to mean
 *  "omit this field" (e.g. a nullable FK with no seeded parent). */
export function synthesizeColumnValue(
  col: ColumnSchema,
  constraints: StructuredConstraint[],
  rng: () => number,
  fkId?: number,
): unknown {
  // Foreign key: the real parent id (or omit when the parent could not be seeded and
  // the column is nullable — a null FK is valid, an invented id is not).
  if (col.fkTable) return fkId ?? (col.notNull ? undefined : null);

  // Constraint-directed synthesis takes precedence over the raw column type.
  for (const c of constraints) {
    const a = c.assertion;
    if (a.kind === 'membership' && a.values.length > 0) return a.values[0];
    if (a.kind === 'pattern') {
      return a.format === 'email' ? 'seed@example.com'
        : a.format === 'url' ? 'https://example.com'
        : a.format === 'uuid' ? FIXED_UUID
        : a.format === 'date' ? pastDate()
        : 'seed-value';
    }
    if (a.kind === 'temporal') return a.mode === 'not-future' ? pastDate() : futureDate();
    if (a.kind === 'bound') {
      // A char-length bound governs a string; a plain numeric bound governs a number.
      if (a.unit === 'chars') {
        const len = a.op === '<=' ? Math.max(1, Math.min(a.value, 8)) : Math.max(a.value, 1);
        return 'a'.repeat(len);
      }
      return a.op === '<=' ? Math.max(0, Math.min(a.value, 100)) : a.value + 1;
    }
  }

  // Unconstrained: a type-correct default. A date-like column name gets a past date so a
  // temporal guard elsewhere never rejects the control.
  if (/(^|_)(date|at|on|day|deadline|due)$/.test(col.name) && col.type !== 'integer') return pastDate();
  if (col.type === 'integer') return 1 + (rng() % 5);
  if (col.type === 'real' || col.type === 'numeric' || col.type === 'float') return 1 + (rng() % 5);
  return `seed_${(rng() % 1000).toString(36)}`;
}

/** Columns the seeder must NOT send (the server owns them). */
function isServerColumn(col: ColumnSchema): boolean {
  return col.isPrimaryKey || col.isAutoincrement
    || col.name === 'created_at' || col.name === 'updated_at'
    || (col.hasDefault && !col.notNull);
}

export interface BodyOptions {
  /** Attribute → the field the harness governs (skip it — the driver sets it itself). */
  skipField?: string;
  /** column name → parent id already seeded (for FK columns). */
  fkIds?: Record<string, number>;
}

/**
 * Synthesize a create-body for one table: a value for every writable column, drawn from
 * its constraints (the algebra's inverse) or a type default. Server-owned columns
 * (auto id, created_at, defaulted) are omitted; the governed field is omitted when the
 * caller will set it. `constraintsByAttr` maps a column name to the constraints on it.
 */
export function synthesizeBody(
  table: TableSchema,
  constraintsByAttr: Map<string, StructuredConstraint[]>,
  rng: () => number,
  opts: BodyOptions = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const col of table.columns) {
    if (isServerColumn(col)) continue;
    if (opts.skipField && col.name === opts.skipField) continue;
    const cons = constraintsByAttr.get(col.name) ?? [];
    const fkId = opts.fkIds?.[col.name];
    const v = synthesizeColumnValue(col, cons, rng, fkId);
    if (v !== undefined) body[col.name] = v;
  }
  return body;
}

// ─── Runtime seeding (drive the real app's create routes, parents first) ───────

/** Minimal HTTP surface the seeder needs (an AppHandle satisfies it). */
export interface Seedable {
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

export interface SeedPlanInput {
  /** All tables (parsed from the schema plan DDL). */
  tables: TableSchema[];
  /** All resolved constraints for the project. */
  constraints: StructuredConstraint[];
  /** table (plural) → its mounted POST route ('/transaction'), or null if it has none. */
  routeFor: (table: string) => string | null;
}

export interface SeedContext {
  /** table → the id created for it while seeding (parents), for FK threading. */
  ids: Map<string, number>;
  /** tables that could not be seeded (unresolvable FK / route / rejected) + why. */
  unseedable: Array<{ table: string; reason: string }>;
}

/** Group constraints by their bound attribute, per entity table. */
function constraintsByTable(input: SeedPlanInput): Map<string, Map<string, StructuredConstraint[]>> {
  const byTable = new Map<string, Map<string, StructuredConstraint[]>>();
  const tableOf = (entity: string): string | undefined => {
    const e = entity.toLowerCase();
    return input.tables.find(t => t.name === e || t.name === e + 's' || t.name.replace(/s$/, '') === e)?.name;
  };
  for (const c of input.constraints) {
    const table = tableOf(c.binding.entity);
    if (!table) continue;
    const perAttr = byTable.get(table) ?? byTable.set(table, new Map()).get(table)!;
    (perAttr.get(c.binding.attribute) ?? perAttr.set(c.binding.attribute, []).get(c.binding.attribute)!).push(c);
  }
  return byTable;
}

/** Read the created id from a JSON create-response (the app returns the row). */
function idFromResponse(body: unknown): number | undefined {
  if (body && typeof body === 'object') {
    const v = (body as Record<string, unknown>).id;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * Seed one table (and, recursively, its FK parents) against a live app. Returns the
 * created id, or records the table unseedable and returns undefined. Idempotent within a
 * single boot via the `ctx.ids` memo. Deterministic body via the seeded rng.
 */
export async function seedTable(
  app: Seedable,
  table: string,
  input: SeedPlanInput,
  byTable: Map<string, Map<string, StructuredConstraint[]>>,
  rng: () => number,
  ctx: SeedContext,
  seen = new Set<string>(),
): Promise<number | undefined> {
  if (ctx.ids.has(table)) return ctx.ids.get(table);
  if (seen.has(table)) { ctx.unseedable.push({ table, reason: 'FK cycle' }); return undefined; }
  seen.add(table);

  const schema = input.tables.find(t => t.name === table);
  if (!schema) { ctx.unseedable.push({ table, reason: 'not in schema plan' }); return undefined; }
  const route = input.routeFor(table);
  if (!route) { ctx.unseedable.push({ table, reason: 'no mounted route' }); return undefined; }

  // Seed each required FK parent first, threading its id in.
  const fkIds: Record<string, number> = {};
  for (const col of schema.columns) {
    if (!col.fkTable) continue;
    const parentId = await seedTable(app, col.fkTable, input, byTable, rng, ctx, seen);
    if (parentId !== undefined) fkIds[col.name] = parentId;
    else if (col.notNull) { ctx.unseedable.push({ table, reason: `required FK ${col.name}→${col.fkTable} unseedable` }); return undefined; }
  }

  const body = synthesizeBody(schema, byTable.get(table) ?? new Map(), rng, { fkIds });
  const res = await app.fetch(route, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!(res.status >= 200 && res.status < 300)) {
    ctx.unseedable.push({ table, reason: `create route ${route} rejected the synthesized body (${res.status})` });
    return undefined;
  }
  let id: number | undefined;
  try { id = idFromResponse(await res.json()); } catch { /* no JSON id */ }
  if (id === undefined) { ctx.unseedable.push({ table, reason: `create response carried no numeric id` }); return undefined; }
  ctx.ids.set(table, id);
  return id;
}

/** A prepared seed for one boot, or an honest abstention reason (structurally matches the
 *  live harness's PrepareResult). */
export type SeedResult = { ok: true; seed: Record<string, unknown> } | { ok: false; reason: string };

/**
 * Prepare the seed body for driving the target entity's create route: seed every FK parent
 * the target requires (recursively, parents first) against the fresh app, then synthesize
 * the target's own field values MINUS the harness-governed field (the driver sets that).
 * Returns the merged seed body, or an honest abstention when a required prerequisite could
 * not be seeded — so the harness reports indeterminate instead of a false green.
 */
export async function seedForTarget(
  app: Seedable,
  input: SeedPlanInput,
  targetTable: string,
  governedField: string | undefined,
): Promise<SeedResult> {
  const schema = input.tables.find(t => t.name === targetTable);
  if (!schema) return { ok: false, reason: `${targetTable} not in schema plan` };
  const byTable = constraintsByTable(input);
  const rng = makeSeededRng();
  const ctx: SeedContext = { ids: new Map(), unseedable: [] };

  const fkIds: Record<string, number> = {};
  for (const col of schema.columns) {
    if (!col.fkTable) continue;
    const pid = await seedTable(app, col.fkTable, input, byTable, rng, ctx);
    if (pid !== undefined) fkIds[col.name] = pid;
    else if (col.notNull) {
      return { ok: false, reason: `FK ${col.name}→${col.fkTable}: ${ctx.unseedable.map(u => `${u.table} (${u.reason})`).join('; ') || 'unseedable'}` };
    }
  }
  const seed = synthesizeBody(schema, byTable.get(targetTable) ?? new Map(), rng, { skipField: governedField, fkIds });
  return { ok: true, seed };
}
