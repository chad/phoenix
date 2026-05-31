/**
 * Shared Artifact Assembly.
 *
 * An IU is a unit of intent; a file is an artifact of the compile target. Most of an
 * IU's output is *owned* (its own module file), but some content is intrinsically
 * *shared* — every entity IU contributes a database migration, and those must live in
 * ONE aggregate file, not be duplicated per module. (This is exactly the concern that
 * produced the duplicate-`CREATE TABLE` bug: two IUs both owning one shared thing.)
 *
 * `splitSharedArtifacts` lifts the `migration`-role content out of each generated
 * module into a single shared `_migrations.ts`, wrapping each contribution in region
 * markers so drift is localized and attributed to the owning IU. It also remaps the
 * module's exact line→canon provenance, since removing the block shifts line indices.
 *
 * This is the first concrete case of the architecture target — not the planner —
 * owning the file layout: one IU → (its module file) + (a region of the shared file).
 */

import type { RegenResult } from './regen.js';
import type { ResolvedTarget } from './models/architecture.js';
import type { SharedFileManifest, FileRegion } from './models/manifest.js';
import { sha256 } from './semhash.js';

/** Path of the aggregate migrations file (relative to project root). */
export const MIGRATIONS_FILE = 'src/generated/_migrations.ts';
/** Side-effect import specifier the server uses to register all migrations. */
export const MIGRATIONS_IMPORT = './generated/_migrations.js';

const REGION_OPEN = (iu: string, role: string, key: string): string =>
  `// <<phx:region iu=${iu} role=${role}${key ? ` key=${key}` : ''}>>`;
const REGION_CLOSE = '// <</phx:region>>';
const REGION_OPEN_RE = /^\s*\/\/ <<phx:region iu=(\S+) role=(\S+?)(?: key=(\S+))?>>\s*$/;
const REGION_CLOSE_RE = /^\s*\/\/ <<\/phx:region>>\s*$/;

/** Matches a full `registerMigration('table', `…sql…`);` statement (single backtick SQL). */
const MIGRATION_RE = /registerMigration\(\s*(['"])(.*?)\1\s*,\s*`([\s\S]*?)`\s*\)\s*;?/g;

export interface SplitResult {
  /** Shared-file manifests to record (currently just the migrations aggregate). */
  sharedFiles: SharedFileManifest[];
  /** Extra files to write (path → content), e.g. `_migrations.ts`. */
  files: Map<string, string>;
  /** Side-effect import specifiers the scaffold must add to server.ts. */
  serverImports: string[];
  /** Per-table ownership conflicts that were de-duplicated (table → dropped IU ids). */
  conflicts: Array<{ table: string; keptIU: string; droppedIUs: string[] }>;
}

interface Contribution {
  iu_id: string;
  table: string;
  /** The normalized `registerMigration(...)` statement text. */
  statement: string;
}

export interface SplitOptions {
  /**
   * Regions carried forward from a previous shared file for IUs that are NOT part of
   * this batch (partial regen). Fresh contributions win on table-name conflict.
   */
  preserve?: ParsedRegion[];
}

/**
 * Lift `migration`-role content out of each module into a shared aggregate file.
 * Mutates the passed `RegenResult`s in place (module content, file hash/size, and
 * remapped line provenance) and returns the shared file to write + record.
 */
export function splitSharedArtifacts(
  results: RegenResult[],
  target?: ResolvedTarget | null,
  opts?: SplitOptions,
): SplitResult {
  const empty: SplitResult = { sharedFiles: [], files: new Map(), serverImports: [], conflicts: [] };
  // Only the sqlite-style target uses registerMigration. If no module has one, no-op.
  void target;

  const contributions: Contribution[] = [];

  for (const result of results) {
    for (const [path, content] of result.files) {
      if (!content.includes('registerMigration(')) continue;
      const { newContent, removed, extracted } = extractMigrations(content, result.iu_id);
      if (extracted.length === 0) continue;

      contributions.push(...extracted);

      // Rewrite the module: migration-free, and drop the now-unused import symbol.
      const cleaned = pruneRegisterMigrationImport(newContent);
      result.files.set(path, cleaned);

      // Update this file's manifest entry: new hash/size + remapped provenance.
      const entry = result.manifest.files[path];
      if (entry) {
        entry.content_hash = sha256(cleaned);
        entry.size = cleaned.length;
        if (entry.line_provenance) {
          entry.line_provenance = remapProvenance(entry.line_provenance, removed);
        }
      }
    }
  }

  // Carry forward regions for IUs not regenerated this batch (partial regen). These
  // come AFTER fresh contributions, so a freshly-regenerated table wins the dedupe.
  for (const r of opts?.preserve ?? []) {
    if (r.role !== 'migration') continue;
    contributions.push({ iu_id: r.iu_id, table: r.key ?? r.body, statement: r.body });
  }

  if (contributions.length === 0) return empty;

  // Dedupe by table name — one entity, one owner. First contributor wins.
  const byTable = new Map<string, Contribution>();
  const conflicts = new Map<string, { keptIU: string; droppedIUs: string[] }>();
  for (const c of contributions) {
    const existing = byTable.get(c.table);
    if (!existing) {
      byTable.set(c.table, c);
    } else {
      const conf = conflicts.get(c.table) ?? { keptIU: existing.iu_id, droppedIUs: [] };
      if (c.iu_id !== existing.iu_id) conf.droppedIUs.push(c.iu_id);
      conflicts.set(c.table, conf);
    }
  }

  const { content, regions } = assembleMigrationsFile([...byTable.values()]);
  const files = new Map<string, string>([[MIGRATIONS_FILE, content]]);
  const sharedFiles: SharedFileManifest[] = [{
    path: MIGRATIONS_FILE,
    content_hash: sha256(content),
    regions,
  }];

  return {
    sharedFiles,
    files,
    serverImports: [MIGRATIONS_IMPORT],
    conflicts: [...conflicts.entries()].map(([table, v]) => ({ table, ...v })),
  };
}

/**
 * Extract every `registerMigration(...)` statement from a module. Returns the
 * migration-free content, the set of removed 0-based line indices (for provenance
 * remap), and the extracted contributions.
 */
function extractMigrations(
  content: string,
  iu_id: string,
): { newContent: string; removed: Set<number>; extracted: Contribution[] } {
  const lines = content.split('\n');
  const removed = new Set<number>();
  const extracted: Contribution[] = [];

  // Map char offset → line index once.
  const lineStart: number[] = [];
  let off = 0;
  for (const l of lines) { lineStart.push(off); off += l.length + 1; }
  const lineAt = (charIdx: number): number => {
    // binary search would be fine; content is small, linear is clear.
    let i = lineStart.length - 1;
    while (i > 0 && lineStart[i] > charIdx) i--;
    return i;
  };

  let m: RegExpExecArray | null;
  MIGRATION_RE.lastIndex = 0;
  while ((m = MIGRATION_RE.exec(content))) {
    const table = m[2];
    const statement = `registerMigration('${table}', \`${m[3]}\`);`;
    extracted.push({ iu_id, table, statement });

    const startLine = lineAt(m.index);
    const endLine = lineAt(m.index + m[0].length - 1);
    for (let i = startLine; i <= endLine; i++) removed.add(i);
  }

  // Also drop the "─── Database migrations ───" section header(s) the template emits,
  // and any blank line immediately following a removed block, to avoid leaving gaps.
  for (let i = 0; i < lines.length; i++) {
    if (/Database migrations/.test(lines[i])) removed.add(i);
  }
  collapseAdjacentBlanks(lines, removed);

  const newLines = lines.filter((_, i) => !removed.has(i));
  return { newContent: newLines.join('\n'), removed, extracted };
}

/** Mark blank lines that become doubled-up after removal so we don't leave gaps. */
function collapseAdjacentBlanks(lines: string[], removed: Set<number>): void {
  for (let i = 1; i < lines.length; i++) {
    if (removed.has(i)) continue;
    const prevKeptIsBlankBoundary = removed.has(i - 1) && lines[i].trim() === '';
    if (prevKeptIsBlankBoundary) removed.add(i);
  }
}

/**
 * Remap a line_provenance map after a block of lines was removed.
 * Keys are 0-based line indices into the (clean) module source.
 */
function remapProvenance(
  prov: Record<string, string>,
  removed: Set<number>,
): Record<string, string> {
  // shift[i] = number of removed lines strictly before line i.
  const maxLine = Math.max(...Object.keys(prov).map(Number), ...removed, 0);
  const shift: number[] = new Array(maxLine + 2).fill(0);
  let acc = 0;
  for (let i = 0; i <= maxLine + 1; i++) {
    shift[i] = acc;
    if (removed.has(i)) acc++;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(prov)) {
    const i = Number(k);
    if (removed.has(i)) continue;             // the annotated line was removed
    out[String(i - shift[i])] = v;
  }
  return out;
}

/** When a module no longer calls registerMigration, drop it from the db import. */
function pruneRegisterMigrationImport(content: string): string {
  if (content.includes('registerMigration(')) return content; // still used
  return content.replace(
    /import\s*\{([^}]*)\}\s*from\s*(['"][^'"]*db\.js['"]);?/g,
    (full, inner: string, from: string) => {
      const names = inner.split(',').map(s => s.trim()).filter(Boolean)
        .filter(n => n !== 'registerMigration');
      if (names.length === 0) return ''; // nothing else imported — drop the line
      return `import { ${names.join(', ')} } from ${from};`;
    },
  );
}

/** Assemble the shared migrations file with one region per contribution. */
function assembleMigrationsFile(
  contribs: Contribution[],
): { content: string; regions: FileRegion[] } {
  const header = [
    '// AUTO-GENERATED shared artifact: database migrations aggregated across IUs.',
    '// Each region below is OWNED by exactly one Implementation Unit. Editing inside a',
    '// region is drift attributed to that IU; Phoenix regenerates the whole file.',
    "import { registerMigration } from '../db.js';",
    '',
  ];

  const lines: string[] = [...header];
  const regions: FileRegion[] = [];

  for (const c of contribs) {
    lines.push(REGION_OPEN(c.iu_id, 'migration', c.table));
    const bodyStart = lines.length;            // 0-based index of first body line
    for (const bl of c.statement.split('\n')) lines.push(bl);
    const bodyEnd = lines.length;              // exclusive
    lines.push(REGION_CLOSE);
    lines.push('');
    regions.push({
      iu_id: c.iu_id,
      role: 'migration',
      key: c.table,
      content_hash: sha256(c.statement),
      start_line: bodyStart,
      end_line: bodyEnd,
    });
  }

  return { content: lines.join('\n') + '\n', regions };
}

export interface ParsedRegion {
  iu_id: string;
  role: string;
  key?: string;
  body: string;
  content_hash: string;
  start_line: number;
  end_line: number;
}

/**
 * Parse region markers out of a shared file on disk. Returns each region's body and
 * its byte-for-byte hash, for drift comparison against the manifest.
 */
export function parseRegions(content: string): ParsedRegion[] {
  const lines = content.split('\n');
  const out: ParsedRegion[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(REGION_OPEN_RE);
    if (!open) { i++; continue; }
    const bodyStart = i + 1;
    let j = bodyStart;
    while (j < lines.length && !REGION_CLOSE_RE.test(lines[j])) j++;
    const body = lines.slice(bodyStart, j).join('\n');
    out.push({
      iu_id: open[1],
      role: open[2],
      key: open[3],
      body,
      content_hash: sha256(body),
      start_line: bodyStart,
      end_line: j,
    });
    i = j + 1;
  }
  return out;
}
