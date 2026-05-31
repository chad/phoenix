import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { splitSharedArtifacts, MIGRATIONS_FILE } from '../../src/artifacts.js';
import type { RegenResult } from '../../src/regen.js';
import { detectDrift } from '../../src/drift.js';
import { DriftStatus } from '../../src/models/manifest.js';
import type { GeneratedManifest } from '../../src/models/manifest.js';
import { sha256 } from '../../src/semhash.js';

function moduleFor(table: string): string {
  return `import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';

registerMigration('${table}', \`
  CREATE TABLE IF NOT EXISTS ${table} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )
\`);

const router = new Hono();
export default router;`;
}

function makeResult(iu_id: string, path: string, content: string): RegenResult {
  return {
    iu_id,
    files: new Map([[path, content]]),
    manifest: {
      iu_id, iu_name: iu_id,
      files: { [path]: { path, content_hash: sha256(content), size: content.length } },
      regen_metadata: { model_id: 't', promptpack_hash: 'x', toolchain_version: 't', generated_at: 'now' },
    },
  };
}

describe('per-region drift on the shared migrations file', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'phoenix-drift-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function buildManifest(): GeneratedManifest {
    const issue = makeResult('ISSUE', 'src/generated/issue/issue.ts', moduleFor('issues'));
    const sprint = makeResult('SPRINT', 'src/generated/sprint/sprint.ts', moduleFor('sprints'));
    const split = splitSharedArtifacts([issue, sprint], null);

    // Write the shared file to disk.
    const full = join(root, MIGRATIONS_FILE);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, split.files.get(MIGRATIONS_FILE)!, 'utf8');

    const shared_files: GeneratedManifest['shared_files'] = {};
    for (const s of split.sharedFiles) shared_files[s.path] = s;
    return { iu_manifests: {}, shared_files, generated_at: 'now' };
  }

  it('reports all regions clean when the file is untouched', () => {
    const manifest = buildManifest();
    const report = detectDrift(manifest, root);
    const regionEntries = report.entries.filter(e => e.role === 'migration');
    expect(regionEntries).toHaveLength(2);
    expect(regionEntries.every(e => e.status === DriftStatus.CLEAN)).toBe(true);
    expect(report.drifted_count).toBe(0);
  });

  it('localizes an edit to one region, attributed to the owning IU', () => {
    const manifest = buildManifest();
    const full = join(root, MIGRATIONS_FILE);

    // Hand-edit inside the 'sprints' region only ('sprints' is unique to that region).
    const edited = readFileSync(full, 'utf8')
      .replace('CREATE TABLE IF NOT EXISTS sprints', 'CREATE TABLE IF NOT EXISTS sprints_v2');
    writeFileSync(full, edited, 'utf8');

    const report = detectDrift(manifest, root);
    const drifted = report.entries.filter(e => e.status === DriftStatus.DRIFTED);
    expect(drifted).toHaveLength(1);
    expect(drifted[0].iu_id).toBe('SPRINT');
    expect(drifted[0].role).toBe('migration');

    // The issues region is still clean.
    const issueEntry = report.entries.find(e => e.iu_id === 'ISSUE' && e.role === 'migration')!;
    expect(issueEntry.status).toBe(DriftStatus.CLEAN);
  });

  it('flags a region missing when its markers are deleted', () => {
    const manifest = buildManifest();
    const full = join(root, MIGRATIONS_FILE);
    // Delete the whole sprints region block.
    const content = readFileSync(full, 'utf8');
    const lines = content.split('\n').filter(l => !/sprints/.test(l) && !/iu=SPRINT/.test(l));
    writeFileSync(full, lines.join('\n'), 'utf8');

    const report = detectDrift(manifest, root);
    const sprint = report.entries.find(e => e.iu_id === 'SPRINT' && e.role === 'migration')!;
    expect(sprint.status).toBe(DriftStatus.MISSING);
  });
});
