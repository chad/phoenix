/**
 * Schema-contract checker — cross-module coherence for the shared database.
 *
 * Independently-generated IUs each carry their own picture of the shared schema,
 * and those pictures drift: one module creates `adventurers`, another queries
 * `adventurer`; the migration defines a `cleared` column, a sibling module filters
 * on `entries.status`. The compiler is happy, every per-IU constraint conforms —
 * and the app 500s on its first request. (Observed VERBATIM on two generated
 * projects: ledger's `account` vs `accounts`, hoard's `adventurer(s)` + `status`.)
 *
 * This checker makes the shared schema a verified CONTRACT: parse the migration
 * DDL into tables×columns, then statically hold every SQL reference in every
 * module against it — table names (FROM/JOIN/INTO/UPDATE/DELETE), qualified
 * column references (`entries.status`), INSERT column lists, and the DDL's own
 * foreign keys (`REFERENCES adventurer(id)` must point at a real table).
 *
 * Deterministic and dialect-modest by design: it only flags identifiers that are
 * PROVABLY inconsistent with the parsed schema — an unknown name with a
 * near-miss suggestion — and stays silent where it cannot parse. A finding here
 * is a guaranteed runtime failure, so findings are errors, not warnings.
 */

export interface SchemaModel {
  /** table name → its column names (lowercased). */
  tables: Map<string, Set<string>>;
}

export interface SchemaFinding {
  /** The module file (repo-relative) the offending reference lives in. */
  file: string;
  kind: 'unknown-table' | 'unknown-column' | 'broken-fk';
  /** The offending identifier (table or table.column). */
  ref: string;
  /** A near-miss suggestion when one exists ("adventurers" for "adventurer"). */
  suggestion?: string;
  detail: string;
}

/** Parse CREATE TABLE statements into a schema model. Depth-aware: the column
 *  body is captured to the MATCHING close paren, so CHECK(...) constraints and
 *  DEFAULT (datetime('now')) don't truncate the parse. */
export function parseSchema(ddl: string): SchemaModel {
  const tables = new Map<string, Set<string>>();
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?["'`]?([a-z_][\w]*)["'`]?\s*\(/gi;
  for (const m of ddl.matchAll(re)) {
    const name = m[1].toLowerCase();
    // Capture the balanced column body.
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    while (i < ddl.length && depth > 0) {
      if (ddl[i] === '(') depth++;
      else if (ddl[i] === ')') depth--;
      i++;
    }
    const body = ddl.slice(start, i - 1);
    const cols = new Set<string>();
    // A column def is a top-level comma-separated item whose first token is not a
    // table-constraint keyword.
    const CONSTRAINT_KW = new Set(['primary', 'foreign', 'unique', 'check', 'constraint']);
    for (const item of splitTopLevel(body)) {
      const first = item.trim().match(/^["'`]?([a-z_][\w]*)["'`]?/i)?.[1]?.toLowerCase();
      if (first && !CONSTRAINT_KW.has(first)) cols.add(first);
    }
    tables.set(name, cols);
  }
  return { tables };
}

/** Split a column body on top-level commas (parens in CHECK/DEFAULT stay intact). */
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

/** The nearest known name within edit-distance 2 (catches singular/plural and
 *  small typos), or undefined. */
function nearest(name: string, known: Iterable<string>): string | undefined {
  let best: string | undefined, bestD = 3;
  for (const k of known) {
    const d = editDistance(name, k, 2);
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const t = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return dp[a.length];
}

/** SQL keywords that can follow FROM/JOIN etc. but are not table names. */
const NOT_A_TABLE = new Set(['select', 'where', 'values', 'set', 'on', 'as', 'left', 'right', 'inner', 'outer', 'cross']);

/**
 * Check one module's source against the schema. Only SQL-shaped references are
 * examined (inside the string literals modules pass to the driver, matched
 * lexically); anything the checker cannot attribute to the schema is left alone.
 */
export function checkModuleSchema(file: string, source: string, schema: SchemaModel): SchemaFinding[] {
  const findings: SchemaFinding[] = [];
  if (schema.tables.size === 0) return findings;
  const tableNames = [...schema.tables.keys()];
  const seen = new Set<string>();
  const flag = (f: SchemaFinding) => {
    const key = `${f.kind}:${f.ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };

  // 1. Table references: FROM t / JOIN t / INTO t / UPDATE t / DELETE FROM t.
  for (const m of source.matchAll(/\b(?:from|join|into|update)\s+["'`]?([a-z_][\w]*)["'`]?/gi)) {
    const t = m[1].toLowerCase();
    if (NOT_A_TABLE.has(t) || schema.tables.has(t)) continue;
    const near = nearest(t, tableNames);
    // Only provable inconsistency is flagged: an unknown name NEAR a known table
    // is a mismatch; a completely foreign identifier may be another DB/attach.
    if (near) flag({ file, kind: 'unknown-table', ref: t, suggestion: near, detail: `SQL references table "${t}" but the schema defines "${near}"` });
  }

  // 2. Qualified column references on KNOWN tables: entries.status.
  for (const m of source.matchAll(/\b([a-z_][\w]*)\.([a-z_][\w]*)\b/gi)) {
    const t = m[1].toLowerCase(), col = m[2].toLowerCase();
    const cols = schema.tables.get(t);
    if (!cols || cols.has(col) || col === 'rowid') continue;
    // Lexical guard: only inside SQL-ish context (the line mentions the table in
    // a query keyword neighborhood) — `entries.map(...)` on a JS array must not fire.
    const line = sliceLine(source, m.index!);
    if (!/\b(?:select|from|join|where|and|or|when|then|set|order by|group by|on)\b/i.test(line)) continue;
    if (/\.(?:map|filter|forEach|reduce|push|length|json|prepare|get|all|run)\b/.test(m[0])) continue;
    const near = nearest(col, cols);
    flag({ file, kind: 'unknown-column', ref: `${t}.${col}`, suggestion: near ? `${t}.${near}` : undefined, detail: `SQL references column "${t}.${col}" but "${t}" has no such column${near ? ` (nearest: "${near}")` : ''}` });
  }

  // 3. INSERT column lists: INSERT INTO t (a, b, c).
  for (const m of source.matchAll(/insert\s+into\s+["'`]?([a-z_][\w]*)["'`]?\s*\(([^)]*)\)/gi)) {
    const t = m[1].toLowerCase();
    const cols = schema.tables.get(t);
    if (!cols) continue; // unknown table already reported above
    for (const raw of m[2].split(',')) {
      const col = raw.trim().replace(/["'`]/g, '').toLowerCase();
      if (!col || cols.has(col)) continue;
      const near = nearest(col, cols);
      flag({ file, kind: 'unknown-column', ref: `${t}.${col}`, suggestion: near ? `${t}.${near}` : undefined, detail: `INSERT into "${t}" names column "${col}" which the schema does not define${near ? ` (nearest: "${near}")` : ''}` });
    }
  }

  // 4. The DDL's own foreign keys: REFERENCES t(col) must point at a real table.
  for (const m of source.matchAll(/\breferences\s+["'`]?([a-z_][\w]*)["'`]?\s*\(\s*([a-z_][\w]*)\s*\)/gi)) {
    const t = m[1].toLowerCase(), col = m[2].toLowerCase();
    const cols = schema.tables.get(t);
    if (!cols) {
      const near = nearest(t, tableNames);
      if (near) flag({ file, kind: 'broken-fk', ref: t, suggestion: near, detail: `FOREIGN KEY references table "${t}" which does not exist (schema defines "${near}")` });
      continue;
    }
    if (!cols.has(col)) {
      flag({ file, kind: 'broken-fk', ref: `${t}.${col}`, detail: `FOREIGN KEY references "${t}.${col}" which the schema does not define` });
    }
  }

  return findings;
}

function sliceLine(s: string, at: number): string {
  const start = s.lastIndexOf('\n', at) + 1;
  const end = s.indexOf('\n', at);
  return s.slice(start, end === -1 ? s.length : end);
}
