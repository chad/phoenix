/**
 * Shared Artifact Assembly.
 *
 * An IU is a unit of intent; a file is an artifact of the compile target. Most of an
 * IU's output is *owned* (its own module file), but some content is intrinsically
 * *shared* — e.g. every entity IU contributes a database migration, and those must
 * live in ONE aggregate file, not be duplicated per module. (This is exactly the
 * concern that produced the duplicate-`CREATE TABLE` bug.)
 *
 * The TARGET declares its shared aggregates (how to recognize a contribution in a
 * module, the comment syntax, the file header, the import wiring). This engine owns the
 * generic machinery that works for any language: lifting contributions, remapping the
 * module's line→canon provenance (removing a block shifts line numbers), de-duplicating
 * by key, wrapping each contribution in region markers, and hashing regions for drift.
 */

import type { RegenResult } from './regen.js';
import type { ResolvedTarget, AggregateRole } from './models/architecture.js';
import type { SharedFileManifest, FileRegion } from './models/manifest.js';
import { sha256 } from './semhash.js';

// Anchored to a full marker line (optional single-token comment prefix). Anchoring stops
// a marker-like token embedded in body text from being read as a structural marker; the
// `key=(.+?)` lets a key contain spaces and still round-trip.
const REGION_OPEN_RE = /^\s*\S*\s*<<phx:region iu=(\S+) role=(\S+?)(?: key=(.+?))?>>\s*$/;
const REGION_CLOSE_RE = /^\s*\S*\s*<<\/phx:region>>\s*$/;

export interface SplitResult {
  /** Shared-file manifests to record. */
  sharedFiles: SharedFileManifest[];
  /** Extra files to write (path → content), e.g. the aggregate files. */
  files: Map<string, string>;
  /** Side-effect import specifiers the scaffold must add to the server entry. */
  serverImports: string[];
  /** Per-key ownership conflicts that were de-duplicated. */
  conflicts: Array<{ role: string; key: string; keptIU: string; droppedIUs: string[] }>;
}

interface Contribution { iu_id: string; key: string; body: string; }

export interface SplitOptions {
  /** Regions carried forward from a previous shared file for IUs NOT in this batch. */
  preserve?: ParsedRegion[];
}

/**
 * Lift each target-declared aggregate role out of the modules into its shared file.
 * Mutates the passed `RegenResult`s in place (module content, file hash/size, remapped
 * provenance) and returns the shared files to write + record.
 */
export function splitSharedArtifacts(
  results: RegenResult[],
  target?: ResolvedTarget | null,
  opts?: SplitOptions,
): SplitResult {
  const out: SplitResult = { sharedFiles: [], files: new Map(), serverImports: [], conflicts: [] };
  const roles = target?.runtime.aggregates ?? [];
  if (roles.length === 0) return out;

  for (const role of roles) {
    const contributions: Contribution[] = [];

    for (const result of results) {
      for (const [path, content] of result.files) {
        const rec = role.recognize(content);
        if (rec.contributions.length === 0) continue;

        for (const c of rec.contributions) {
          contributions.push({ iu_id: result.iu_id, key: c.key, body: c.body });
        }

        // Rewrite the module: contribution-free, with provenance remapped.
        result.files.set(path, rec.strippedCode);
        const entry = result.manifest.files[path];
        if (entry) {
          entry.content_hash = sha256(rec.strippedCode);
          entry.size = rec.strippedCode.length;
          if (entry.line_provenance) {
            entry.line_provenance = remapProvenance(entry.line_provenance, new Set(rec.removed));
          }
        }
      }
    }

    // Carry forward regions for IUs not regenerated this batch (partial regen). These
    // come AFTER fresh contributions, so a freshly-regenerated key wins the dedupe.
    for (const r of opts?.preserve ?? []) {
      if (r.role === role.role) contributions.push({ iu_id: r.iu_id, key: r.key ?? r.body, body: r.body });
    }

    if (contributions.length === 0) continue;

    // Dedupe by key — one owner per key. First contributor wins.
    const byKey = new Map<string, Contribution>();
    const conflicts = new Map<string, { keptIU: string; droppedIUs: string[] }>();
    for (const c of contributions) {
      const existing = byKey.get(c.key);
      if (!existing) {
        byKey.set(c.key, c);
      } else if (c.iu_id !== existing.iu_id) {
        const conf = conflicts.get(c.key) ?? { keptIU: existing.iu_id, droppedIUs: [] };
        conf.droppedIUs.push(c.iu_id);
        conflicts.set(c.key, conf);
      }
    }

    const { content, regions } = assembleAggregate(role, [...byKey.values()]);
    out.files.set(role.filePath, content);
    out.sharedFiles.push({ path: role.filePath, content_hash: sha256(content), regions });
    if (role.importSpecifier) out.serverImports.push(role.importSpecifier);
    for (const [key, v] of conflicts) out.conflicts.push({ role: role.role, key, ...v });
  }

  return out;
}

/** Assemble an aggregate file with one region per contribution, in the role's syntax. */
function assembleAggregate(
  role: AggregateRole,
  contribs: Contribution[],
): { content: string; regions: FileRegion[] } {
  const open = (c: Contribution): string =>
    `${role.commentPrefix} <<phx:region iu=${c.iu_id} role=${role.role}${c.key ? ` key=${c.key}` : ''}>>`;
  const close = `${role.commentPrefix} <</phx:region>>`;

  const lines: string[] = role.fileHeader.split('\n');
  const regions: FileRegion[] = [];

  for (const c of contribs) {
    lines.push(open(c));
    const bodyStart = lines.length;
    for (const bl of c.body.split('\n')) lines.push(bl);
    const bodyEnd = lines.length;
    lines.push(close);
    lines.push('');
    regions.push({
      iu_id: c.iu_id, role: role.role, key: c.key || undefined, // symmetric with parse (empty → no key= → undefined)
      content_hash: sha256(c.body), start_line: bodyStart, end_line: bodyEnd,
    });
  }

  return { content: lines.join('\n') + '\n', regions };
}

/** Remap a line_provenance map after a set of line indices was removed from a module. */
function remapProvenance(prov: Record<string, string>, removed: Set<number>): Record<string, string> {
  const maxLine = Math.max(...Object.keys(prov).map(Number), ...removed, 0);
  const shift: number[] = new Array(maxLine + 2).fill(0);
  let acc = 0;
  for (let i = 0; i <= maxLine + 1; i++) {
    shift[i] = acc;
    if (removed.has(i)) acc++;
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(prov)) {
    const i = Number(k);
    if (removed.has(i)) continue;
    result[String(i - shift[i])] = v;
  }
  return result;
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
 * Parse region markers out of a shared file on disk — prefix-agnostic (matches the
 * `<<phx:region …>>` token regardless of the comment syntax that precedes it), so a
 * single parser serves every target.
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
    // Stop on the close marker OR a new open (a malformed/missing-close region) so a
    // following well-formed region is not swallowed.
    while (j < lines.length && !REGION_CLOSE_RE.test(lines[j]) && !REGION_OPEN_RE.test(lines[j])) j++;
    const body = lines.slice(bodyStart, j).join('\n');
    out.push({
      iu_id: open[1], role: open[2], key: open[3],
      body, content_hash: sha256(body), start_line: bodyStart, end_line: j,
    });
    // Resume AT a new open (so it's still parsed); otherwise skip past the close line.
    i = (j < lines.length && REGION_OPEN_RE.test(lines[j])) ? j : j + 1;
  }
  return out;
}
