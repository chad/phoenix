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
      const waiver = waivers?.get(filePath);

      if (!existsSync(fullPath)) {
        entries.push({
          status: DriftStatus.MISSING,
          file_path: filePath,
          iu_id: iuManifest.iu_id,
          expected_hash: entry.content_hash,
        });
        continue;
      }

      const actualContent = readFileSync(fullPath, 'utf8');
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

  let summary: string;
  if (drifted === 0 && missing === 0) {
    summary = `All ${clean} generated files are clean.${waived > 0 ? ` ${waived} waived.` : ''}`;
  } else {
    const parts: string[] = [];
    if (drifted > 0) parts.push(`${drifted} drifted`);
    if (missing > 0) parts.push(`${missing} missing`);
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
  const waiver = waivers?.get(shared.path);
  // Common region-identity fields for every entry from this shared file.
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

  const content = readFileSync(fullPath, 'utf8');
  if (sha256(content) === shared.content_hash) {
    // Whole file unchanged — all regions clean.
    return shared.regions.map(r => ({ ...base(r), actual_hash: r.content_hash }));
  }

  // File changed — localize to the drifted region(s).
  const onDisk = parseRegions(content);
  const idOf = (iu: string, role: string, k?: string): string => `${iu}|${role}|${k ?? ''}`;
  const diskByKey = new Map(onDisk.map(r => [idOf(r.iu_id, r.role, r.key), r]));

  return shared.regions.map((r): DriftEntry => {
    const found = diskByKey.get(idOf(r.iu_id, r.role, r.key));
    if (!found) return { ...base(r), status: DriftStatus.MISSING };
    if (found.content_hash === r.content_hash) return { ...base(r), actual_hash: found.content_hash };
    if (waiver) return { ...base(r), status: DriftStatus.WAIVED, actual_hash: found.content_hash, waiver };
    return { ...base(r), status: DriftStatus.DRIFTED, actual_hash: found.content_hash };
  });
}
