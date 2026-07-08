/**
 * IU Dependency Derivation — populates the Implementation Graph's edges.
 *
 * IU→IU dependencies are derived from the *actual generated code*: each IU's
 * files are scanned for relative imports, import paths are resolved to
 * project-relative files, and files are mapped back to their owning IU. The
 * result is the real coupling graph — the substrate for cascade propagation
 * (PRD §11), IU-level boundary enforcement (PRD §7), and selective
 * invalidation of dependent subtrees (PRD §0).
 *
 * Derived from code rather than declared by hand: mechanical enforcement over
 * social knowledge. The graph can never silently disagree with the imports.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import type { ImplementationUnit } from './models/iu.js';
import { extractDependencies } from './dep-extractor.js';

/** Map every generated file (project-relative, POSIX separators) to its owning IU. */
export function buildFileToIUMap(ius: ImplementationUnit[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const iu of ius) {
    for (const f of iu.output_files) map.set(normalizeSlashes(f), iu.iu_id);
  }
  return map;
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Resolve a relative import specifier from `fromFile` (project-relative) to the
 * project-relative file it names, trying the extension variants TS/JS/Python
 * emit (`./tasks.js` → `src/generated/tasks.ts`, `./tasks` → `.../tasks/index.ts`).
 * Returns the first candidate that exists in `knownFiles`, else null.
 */
export function resolveRelativeImport(
  fromFile: string,
  specifier: string,
  knownFiles: Set<string>,
): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = normalizeSlashes(normalize(join(dirname(fromFile), specifier)));
  const candidates = [
    base,
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.mjs$/, '.mts'),
    `${base}.ts`,
    `${base}.js`,
    `${base}.py`,
    `${base}/index.ts`,
    `${base}/index.js`,
  ];
  for (const c of candidates) {
    if (knownFiles.has(c)) return c;
  }
  return null;
}

/**
 * Derive the IU dependency graph from generated code on disk.
 * Returns iu_id → sorted unique list of iu_ids it imports from.
 * IUs whose files are missing simply contribute no edges (regen not run yet).
 */
export function deriveIUDependencies(
  projectRoot: string,
  ius: ImplementationUnit[],
): Map<string, string[]> {
  const fileToIU = buildFileToIUMap(ius);
  const knownFiles = new Set(fileToIU.keys());
  const deps = new Map<string, Set<string>>();
  for (const iu of ius) deps.set(iu.iu_id, new Set());

  for (const iu of ius) {
    for (const file of iu.output_files) {
      const full = join(projectRoot, file);
      if (!existsSync(full)) continue;
      let source: string;
      try {
        source = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const graph = extractDependencies(source, file);
      for (const imp of graph.imports) {
        if (!imp.is_relative) continue;
        const resolved = resolveRelativeImport(normalizeSlashes(file), imp.source, knownFiles);
        if (!resolved) continue;
        const targetIU = fileToIU.get(resolved);
        if (targetIU && targetIU !== iu.iu_id) deps.get(iu.iu_id)!.add(targetIU);
      }
    }
  }

  const result = new Map<string, string[]>();
  for (const [id, set] of deps) result.set(id, [...set].sort());
  return result;
}

/**
 * Apply derived dependencies onto the IU list (in place) and report changes.
 * Returns the IUs whose dependency set actually changed.
 */
export function applyDerivedDependencies(
  ius: ImplementationUnit[],
  derived: Map<string, string[]>,
): ImplementationUnit[] {
  const changed: ImplementationUnit[] = [];
  for (const iu of ius) {
    const next = derived.get(iu.iu_id) ?? [];
    const prev = [...iu.dependencies].sort();
    if (prev.length !== next.length || prev.some((v, i) => v !== next[i])) {
      iu.dependencies = next;
      changed.push(iu);
    }
  }
  return changed;
}
