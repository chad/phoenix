/**
 * Schema-first planning (P0) — derive the shared database schema BEFORE any module is
 * generated, so every module can be handed the SAME table/column names verbatim.
 *
 * Today each IU imagines its own tables and `_migrations.ts` is stitched from per-IU
 * regions afterward; modules then drift from it (singular/plural, phantom columns,
 * broken FKs — observed on ledger, hoard, afterimage; all three shipped a compile-green
 * app that 500s on request one). Inverting the order removes the drift at the source:
 * one authoritative schema, injected into every module prompt.
 *
 * Two derivations, both reconciled through `parseSchema` so the injected DDL and the
 * verifier see the same model:
 *  - LLM: one dedicated schema-planning call over the mined entities + constraints.
 *  - Deterministic fallback (also stub mode): one table per entity IU from mined
 *    attributes + reference (FK) constraints. Modest by design — the repair loop (P1)
 *    is the safety net for whatever the plan under-specifies.
 */

import { createHash } from 'node:crypto';
import type { ImplementationUnit } from './models/iu.js';
import type { CanonicalNode } from './models/canonical.js';
import type { Clause } from './models/clause.js';
import type { ResolvedTarget } from './models/architecture.js';
import type { LLMProvider } from './llm/provider.js';
import type { ParsedRegion } from './artifacts.js';
import { parseSchema, type SchemaModel } from './schema-contract.js';
import { mineEntityAttributes, extractConstraints } from './constraints/extract.js';
import { singular } from './iu-clusterer.js';
import { isUiIU } from './regen.js';

/** The synthetic IU id that OWNS the pre-planned migration regions. */
export const SCHEMA_PLAN_IU = 'schema-plan';

/** registerMigration('<table>', `<CREATE TABLE …>`) — same shape the aggregate lifts. */
const MIGRATION_RE = /registerMigration\(\s*(['"])(.*?)\1\s*,\s*`([\s\S]*?)`\s*\)\s*;?/g;

export interface SchemaPlan {
  /** The CREATE TABLE DDL, concatenated — injected into prompts and fed to parseSchema. */
  ddl: string;
  /** One migration region per table (role 'migration', owned by SCHEMA_PLAN_IU). */
  regions: ParsedRegion[];
  /** The parsed model (tables × columns) — the same view the schema verifier holds. */
  model: SchemaModel;
  source: 'llm' | 'derived';
  tableCount: number;
}

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Naive English pluralization for table names (account → accounts, entry → entries). */
function pluralize(w: string): string {
  if (/[^aeiou]y$/i.test(w)) return w.replace(/y$/i, 'ies');
  if (/(?:s|x|z|ch|sh)$/i.test(w)) return w + 'es';
  return w + 's';
}

function snake(w: string): string {
  return w.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Build a ParsedRegion from a registerMigration body keyed by table. */
function regionFor(table: string, body: string): ParsedRegion {
  const b = body.trim();
  return { iu_id: SCHEMA_PLAN_IU, role: 'migration', key: table, body: b, content_hash: sha(b), start_line: 0, end_line: 0 };
}

/**
 * Plan the shared schema. Returns null for non-SQL targets (no migration aggregate),
 * in which case bootstrap skips schema-first generation.
 */
export async function planSchema(
  ius: ImplementationUnit[],
  canonNodes: CanonicalNode[],
  allClauses: Clause[],
  llm: LLMProvider | null | undefined,
  target: ResolvedTarget | null | undefined,
): Promise<SchemaPlan | null> {
  const hasMigrationRole = (target?.runtime.aggregates ?? []).some(r => r.role === 'migration');
  if (!hasMigrationRole) return null;

  if (llm) {
    try {
      const plan = await planWithLLM(ius, canonNodes, allClauses, llm);
      if (plan && plan.tableCount > 0) return plan;
    } catch {
      /* fall through to the deterministic derivation */
    }
  }
  return deriveSchema(ius, canonNodes, allClauses);
}

// ─── LLM planning ─────────────────────────────────────────────────────────────

async function planWithLLM(
  ius: ImplementationUnit[],
  canonNodes: CanonicalNode[],
  allClauses: Clause[],
  llm: LLMProvider,
): Promise<SchemaPlan | null> {
  const prompt = buildSchemaPrompt(ius, canonNodes, allClauses);
  const raw = await llm.generate(prompt, {
    system: 'You are a senior database engineer designing a single, coherent SQLite schema. Output ONLY registerMigration(...) statements — no prose, no markdown fences.',
    temperature: 0.1,
    maxTokens: 4096,
  });
  return planFromMigrations(raw);
}

/** Parse registerMigration blocks (from an LLM response) into a plan. */
export function planFromMigrations(text: string, source: SchemaPlan['source'] = 'llm'): SchemaPlan | null {
  const regions: ParsedRegion[] = [];
  const ddlParts: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  MIGRATION_RE.lastIndex = 0;
  while ((m = MIGRATION_RE.exec(text))) {
    const table = m[2].toLowerCase();
    if (seen.has(table)) continue;
    seen.add(table);
    const body = `registerMigration('${m[2]}', \`${m[3]}\`);`;
    regions.push(regionFor(table, body));
    ddlParts.push(m[3]);
  }
  if (regions.length === 0) return null;
  const ddl = ddlParts.join('\n');
  return { ddl, regions, model: parseSchema(ddl), source, tableCount: regions.length };
}

/** The schema-planning prompt: mined entities + their attributes + FK/enum constraints. */
function buildSchemaPrompt(ius: ImplementationUnit[], canonNodes: CanonicalNode[], allClauses: Clause[]): string {
  const attrs = mineEntityAttributes(ius, canonNodes, allClauses);
  const { constraints } = extractConstraints(canonNodes, attrs);

  const lines: string[] = [];
  lines.push('Design the shared SQLite schema for this application. Every module will be given this');
  lines.push('schema VERBATIM and told to use these exact names, so it must be COMPLETE and INTERNALLY');
  lines.push('CONSISTENT — one canonical spelling per table and column.');
  lines.push('');
  lines.push('## Entities and their known attributes');
  const entityIUs = ius.filter(iu => !isUiIU(iu));
  for (const iu of entityIUs) {
    const key = singular(iu.name.toLowerCase().trim());
    const cols = attrs.get(key) ?? new Set<string>();
    lines.push(`- ${iu.name}: ${[...cols].join(', ') || '(no attributes mined — infer from the rules below)'}`);
  }
  lines.push('');

  const refs = constraints.filter(c => c.assertion.kind === 'reference');
  const enums = constraints.filter(c => c.assertion.kind === 'membership');
  if (refs.length > 0) {
    lines.push('## Referential rules (foreign keys)');
    for (const c of refs) {
      if (c.assertion.kind === 'reference') lines.push(`- a ${c.binding.entity} references an existing ${c.assertion.target}`);
    }
    lines.push('');
  }
  if (enums.length > 0) {
    lines.push('## Enumerations (store as TEXT with a CHECK when helpful)');
    for (const c of enums) {
      if (c.assertion.kind === 'membership') lines.push(`- ${c.binding.entity}.${c.binding.attribute} ∈ {${c.assertion.values.join(', ')}}`);
    }
    lines.push('');
  }

  lines.push('## Output rules');
  lines.push("- Output ONLY registerMigration('<table>', `CREATE TABLE IF NOT EXISTS <table> (...)`) blocks, one per table.");
  lines.push('- Use snake_case, PLURAL table names (accounts, transactions, entries) and snake_case columns.');
  lines.push("- Every table has: id INTEGER PRIMARY KEY AUTOINCREMENT, and created_at TEXT NOT NULL DEFAULT (datetime('now')).");
  lines.push('- Foreign keys: <other_singular>_id INTEGER REFERENCES <other_plural_table>(id).');
  lines.push('- Numeric money/quantities: use INTEGER or REAL. Booleans: INTEGER (0/1). Timestamps/dates: TEXT.');
  lines.push('- Do NOT reference a table you do not also create here.');
  lines.push('');
  lines.push('Output the registerMigration statements now.');
  return lines.join('\n');
}

// ─── Deterministic derivation (fallback / stub mode) ────────────────────────────

/**
 * Derive a modest schema from the mined entities: one table per non-UI entity IU, with
 * its mined attributes as TEXT columns and a FK column per reference constraint. This is
 * a safety net, not a substitute for the LLM plan — it exists so schema-first ordering
 * holds even with no model, and so the repair loop always has a schema to check against.
 */
export function deriveSchema(ius: ImplementationUnit[], canonNodes: CanonicalNode[], allClauses: Clause[]): SchemaPlan | null {
  const attrs = mineEntityAttributes(ius, canonNodes, allClauses);
  const { constraints } = extractConstraints(canonNodes, attrs);

  // entity singular → table (plural). Only entities that plausibly have a table: non-UI IUs.
  const entityIUs = ius.filter(iu => !isUiIU(iu));
  const tableFor = new Map<string, string>();
  for (const iu of entityIUs) {
    const key = singular(iu.name.toLowerCase().trim());
    if (!key) continue;
    tableFor.set(key, pluralize(snake(key)));
  }
  if (tableFor.size === 0) return null;

  // FK columns per entity from reference constraints.
  const fks = new Map<string, Set<string>>();
  for (const c of constraints) {
    if (c.assertion.kind !== 'reference') continue;
    const from = singular(c.binding.entity.toLowerCase());
    const to = singular(c.assertion.target.toLowerCase());
    if (!tableFor.has(from) || !tableFor.has(to)) continue;
    (fks.get(from) ?? fks.set(from, new Set()).get(from)!).add(to);
  }

  const regions: ParsedRegion[] = [];
  const ddlParts: string[] = [];
  for (const [entity, table] of tableFor) {
    const cols: string[] = ['id INTEGER PRIMARY KEY AUTOINCREMENT'];
    const cset = attrs.get(entity) ?? new Set<string>();
    const emitted = new Set<string>(['id', 'created_at']);
    for (const to of fks.get(entity) ?? []) {
      const c = `${snake(to)}_id`;
      if (emitted.has(c)) continue;
      emitted.add(c);
      cols.push(`${c} INTEGER REFERENCES ${tableFor.get(to)}(id)`);
    }
    for (const a of cset) {
      const c = snake(a);
      if (!c || emitted.has(c) || c === entity) continue;
      emitted.add(c);
      cols.push(`${c} TEXT`);
    }
    cols.push("created_at TEXT NOT NULL DEFAULT (datetime('now'))");
    const create = `CREATE TABLE IF NOT EXISTS ${table} (\n  ${cols.join(',\n  ')}\n)`;
    const body = `registerMigration('${table}', \`\n  ${create}\n\`);`;
    regions.push(regionFor(table, body));
    ddlParts.push(create);
  }

  const ddl = ddlParts.join('\n');
  return { ddl, regions, model: parseSchema(ddl), source: 'derived', tableCount: regions.length };
}
