/**
 * Drift Detection — compares working tree vs generated manifest.
 *
 * Detects when generated files have been manually edited without
 * a waiver, which breaks the provenance chain.
 */

import { readFileSync, existsSync } from 'node:fs';
import type { GeneratedManifest, DriftEntry, DriftReport, DriftWaiver, SharedFileManifest } from './models/manifest.js';
import { DriftStatus } from './models/manifest.js';
import { sha256 } from './semhash.js';
import { parseRegions } from './artifacts.js';

/** A waiver only suppresses drift while it is unexpired. */
function activeWaiver(waiver: DriftWaiver | undefined): DriftWaiver | undefined {
  if (!waiver) return undefined;
  if (waiver.expires && new Date(waiver.expires).getTime() < Date.now()) return undefined;
  return waiver;
}

/**
 * Check all files in the manifest against the working tree.
 */
export function detectDrift(
  manifest: GeneratedManifest,
  projectRoot: string,
  waivers?: Map<string, DriftWaiver>,
): DriftReport {
  const entries: DriftEntry[] = [];

  for (const iuManifest of Object.values(manifest.iu_manifests)) {
    for (const [filePath, entry] of Object.entries(iuManifest.files)) {
      const fullPath = projectRoot + '/' + filePath;
      const waiver = activeWaiver(waivers?.get(filePath));

      if (!existsSync(fullPath)) {
        entries.push({
          status: DriftStatus.MISSING,
          file_path: filePath,
          iu_id: iuManifest.iu_id,
          expected_hash: entry.content_hash,
        });
        continue;
      }

      // An existing-but-unreadable path (a directory, or deleted in the race window)
      // must not abort the whole report — treat it as drift for this one file.
      let actualContent: string;
      try {
        actualContent = readFileSync(fullPath, 'utf8');
      } catch {
        entries.push({ status: DriftStatus.DRIFTED, file_path: filePath, iu_id: iuManifest.iu_id, expected_hash: entry.content_hash });
        continue;
      }
      const actualHash = sha256(actualContent);

      if (actualHash === entry.content_hash) {
        entries.push({
          status: DriftStatus.CLEAN,
          file_path: filePath,
          iu_id: iuManifest.iu_id,
          expected_hash: entry.content_hash,
          actual_hash: actualHash,
        });
      } else if (waiver) {
        entries.push({
          status: DriftStatus.WAIVED,
          file_path: filePath,
          iu_id: iuManifest.iu_id,
          expected_hash: entry.content_hash,
          actual_hash: actualHash,
          waiver,
        });
      } else {
        entries.push({
          status: DriftStatus.DRIFTED,
          file_path: filePath,
          iu_id: iuManifest.iu_id,
          expected_hash: entry.content_hash,
          actual_hash: actualHash,
        });
      }
    }
  }

  // Shared aggregate files: drift is per-region, attributed to the owning IU.
  for (const shared of Object.values(manifest.shared_files ?? {})) {
    entries.push(...detectSharedDrift(shared, projectRoot, waivers));
  }

  const clean = entries.filter(e => e.status === DriftStatus.CLEAN).length;
  const drifted = entries.filter(e => e.status === DriftStatus.DRIFTED).length;
  const missing = entries.filter(e => e.status === DriftStatus.MISSING).length;
  const waived = entries.filter(e => e.status === DriftStatus.WAIVED).length;
  const untracked = entries.filter(e => e.status === DriftStatus.UNTRACKED).length;

  let summary: string;
  if (drifted === 0 && missing === 0 && untracked === 0) {
    summary = `All ${clean} generated files are clean.${waived > 0 ? ` ${waived} waived.` : ''}`;
  } else {
    const parts: string[] = [];
    if (drifted > 0) parts.push(`${drifted} drifted`);
    if (missing > 0) parts.push(`${missing} missing`);
    if (untracked > 0) parts.push(`${untracked} untracked`);
    summary = `DRIFT DETECTED: ${parts.join(', ')}. ${clean} clean.`;
  }

  return { entries, clean_count: clean, drifted_count: drifted, missing_count: missing, summary };
}

/**
 * Per-region drift for a shared aggregate file. Fast path: whole-file hash matches →
 * every region is clean. Otherwise parse the on-disk region markers, hash each region
 * body, and compare to the manifest region (matched by iu_id + role + key), emitting
 * one DriftEntry per region attributed to its owning IU.
 */
function detectSharedDrift(
  shared: SharedFileManifest,
  projectRoot: string,
  waivers?: Map<string, DriftWaiver>,
): DriftEntry[] {
  const fullPath = projectRoot + '/' + shared.path;
  const idOf = (iu: string, role: string, k?: string): string => `${iu}|${role}|${k ?? ''}`;
  // Region-scoped waiver: `<file>#<iu>|<role>|<key>` so a waiver targets ONE region.
  // A bare file-path waiver no longer blankets every region of a shared file.
  const regionWaiver = (r: { iu_id: string; role: string; key?: string }): DriftWaiver | undefined =>
    activeWaiver(waivers?.get(`${shared.path}#${idOf(r.iu_id, r.role, r.key)}`));

  const base = (r: { iu_id: string; role: string; key?: string; content_hash: string; start_line: number; end_line: number }): DriftEntry => ({
    status: DriftStatus.CLEAN,
    file_path: shared.path,
    iu_id: r.iu_id,
    role: r.role,
    key: r.key,
    region: { start_line: r.start_line, end_line: r.end_line },
    expected_hash: r.content_hash as string | undefined,
  });

  if (!existsSync(fullPath)) {
    return shared.regions.map(r => ({ ...base(r), status: DriftStatus.MISSING }));
  }

  let content: string;
  try {
    content = readFileSync(fullPath, 'utf8');
  } catch {
    return shared.regions.map(r => ({ ...base(r), status: DriftStatus.DRIFTED }));
  }

  if (sha256(content) === shared.content_hash) {
    // Whole file unchanged — all regions clean.
    return shared.regions.map(r => ({ ...base(r), actual_hash: r.content_hash }));
  }

  // File changed — localize. Group on-disk regions by identity into ARRAYS so duplicate
  // keys are not collapsed (a last-wins Map could hide a tampered duplicate).
  const onDisk = parseRegions(content);
  const diskByKey = new Map<string, typeof onDisk>();
  for (const d of onDisk) {
    const id = idOf(d.iu_id, d.role, d.key);
    (diskByKey.get(id) ?? diskByKey.set(id, []).get(id)!).push(d);
  }
  const manifestIds = new Set(shared.regions.map(r => idOf(r.iu_id, r.role, r.key)));
  const entries: DriftEntry[] = [];

  for (const r of shared.regions) {
    const matches = diskByKey.get(idOf(r.iu_id, r.role, r.key));
    if (!matches || matches.length === 0) { entries.push({ ...base(r), status: DriftStatus.MISSING }); continue; }
    // A duplicated region is itself drift (the body is ambiguous / tampered).
    if (matches.length > 1) {
      const d = matches[0];
      entries.push({ ...base(r), status: DriftStatus.DRIFTED, actual_hash: d.content_hash, region: { start_line: d.start_line, end_line: d.end_line } });
      continue;
    }
    const found = matches[0];
    const region = { start_line: found.start_line, end_line: found.end_line }; // report the ACTUAL on-disk lines
    if (found.content_hash === r.content_hash) { entries.push({ ...base(r), actual_hash: found.content_hash }); continue; }
    const waiver = regionWaiver(r);
    if (waiver) entries.push({ ...base(r), status: DriftStatus.WAIVED, actual_hash: found.content_hash, region, waiver });
    else entries.push({ ...base(r), status: DriftStatus.DRIFTED, actual_hash: found.content_hash, region });
  }

  // Regions present on disk but absent from the manifest are UNTRACKED.
  for (const d of onDisk) {
    if (!manifestIds.has(idOf(d.iu_id, d.role, d.key))) {
      entries.push({ status: DriftStatus.UNTRACKED, file_path: shared.path, iu_id: d.iu_id, role: d.role, key: d.key, region: { start_line: d.start_line, end_line: d.end_line }, actual_hash: d.content_hash });
    }
  }
  return entries;
}
