import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectDrift } from '../../src/drift.js';
import { DriftStatus } from '../../src/models/manifest.js';
import type { GeneratedManifest, DriftWaiver } from '../../src/models/manifest.js';
import { sha256 } from '../../src/semhash.js';

describe('detectDrift', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'phoenix-drift-'));
  });

  function writeFile(relPath: string, content: string) {
    const full = join(projectRoot, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }

  function makeManifest(files: Record<string, string>): GeneratedManifest {
    const iu_manifests: GeneratedManifest['iu_manifests'] = {
      'test-iu': {
        iu_id: 'test-iu',
        iu_name: 'TestIU',
        files: Object.fromEntries(
          Object.entries(files).map(([path, content]) => [
            path,
            { path, content_hash: sha256(content), size: content.length },
          ])
        ),
        regen_metadata: {
          model_id: 'test',
          promptpack_hash: 'abc',
          toolchain_version: '1.0',
          generated_at: new Date().toISOString(),
        },
      },
    };
    return { iu_manifests, generated_at: new Date().toISOString() };
  }

  it('reports CLEAN when files match manifest', () => {
    const content = 'export function auth() {}';
    writeFile('src/auth.ts', content);
    const manifest = makeManifest({ 'src/auth.ts': content });

    const report = detectDrift(manifest, projectRoot);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].status).toBe(DriftStatus.CLEAN);
    expect(report.drifted_count).toBe(0);
  });

  it('reports DRIFTED when file content differs', () => {
    const original = 'export function auth() {}';
    const modified = 'export function auth() { /* hacked */ }';
    writeFile('src/auth.ts', modified);
    const manifest = makeManifest({ 'src/auth.ts': original });

    const report = detectDrift(manifest, projectRoot);
    expect(report.entries[0].status).toBe(DriftStatus.DRIFTED);
    expect(report.drifted_count).toBe(1);
    expect(report.summary).toContain('DRIFT DETECTED');
  });

  it('reports MISSING when file does not exist', () => {
    const manifest = makeManifest({ 'src/missing.ts': 'content' });
    const report = detectDrift(manifest, projectRoot);
    expect(report.entries[0].status).toBe(DriftStatus.MISSING);
    expect(report.missing_count).toBe(1);
  });

  it('reports WAIVED when file differs but has waiver', () => {
    const original = 'export function auth() {}';
    const modified = 'export function auth() { /* patched */ }';
    writeFile('src/auth.ts', modified);
    const manifest = makeManifest({ 'src/auth.ts': original });

    const waiver: DriftWaiver = {
      kind: 'temporary_patch',
      reason: 'Hotfix for production issue',
      expires: '2099-03-01', // far future — an active (unexpired) waiver
    };
    const waivers = new Map([['src/auth.ts', waiver]]);

    const report = detectDrift(manifest, projectRoot, waivers);
    expect(report.entries[0].status).toBe(DriftStatus.WAIVED);
    expect(report.drifted_count).toBe(0);
  });

  it('handles multiple files with mixed statuses', () => {
    writeFile('src/a.ts', 'clean content');
    writeFile('src/b.ts', 'modified content');
    const manifest = makeManifest({
      'src/a.ts': 'clean content',
      'src/b.ts': 'original content',
      'src/c.ts': 'missing content',
    });

    const report = detectDrift(manifest, projectRoot);
    const statuses = report.entries.map(e => e.status);
    expect(statuses).toContain(DriftStatus.CLEAN);
    expect(statuses).toContain(DriftStatus.DRIFTED);
    expect(statuses).toContain(DriftStatus.MISSING);
  });
});
