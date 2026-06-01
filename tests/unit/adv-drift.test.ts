import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { detectDrift } from '../../src/drift.js';
import { DriftStatus } from '../../src/models/manifest.js';
import type { GeneratedManifest, DriftWaiver } from '../../src/models/manifest.js';
import { sha256 } from '../../src/semhash.js';
import { parseRegions as pr } from '../../src/artifacts.js';

const SHARED = 'src/generated/_migrations.ts';

function buildFile(regs: Array<{ iu: string; role: string; key: string; body: string }>): string {
  const lines: string[] = [];
  for (const r of regs) {
    lines.push(`// <<phx:region iu=${r.iu} role=${r.role} key=${r.key}>>`);
    for (const bl of r.body.split('\n')) lines.push(bl);
    lines.push('// <</phx:region>>', '');
  }
  return lines.join('\n') + '\n';
}

function sharedManifest(content: string): GeneratedManifest {
  return {
    iu_manifests: {},
    shared_files: { [SHARED]: { path: SHARED, content_hash: sha256(content), regions: pr(content) } },
    generated_at: 'now',
  };
}

describe('adversarial: drift (shared regions)', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'adv-drift-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const write = (rel: string, c: string) => { const f = join(root, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c, 'utf8'); };

  it('#13 a DUPLICATED/modified region (same key twice on disk) is reported as drift', () => {
    const pristine = buildFile([{ iu: 'IU1', role: 'migration', key: 'users', body: 'A' }]);
    const manifest = sharedManifest(pristine);
    // disk: the MODIFIED copy first, an unmodified copy second. A last-wins Map keeps
    // the clean copy and hides the drift entirely.
    write(SHARED, buildFile([
      { iu: 'IU1', role: 'migration', key: 'users', body: 'B' },   // tampered
      { iu: 'IU1', role: 'migration', key: 'users', body: 'A' },   // pristine
    ]));
    const report = detectDrift(manifest, root);
    expect(report.drifted_count).toBeGreaterThan(0);
  });

  it('#14 an EXTRA on-disk region absent from the manifest is reported UNTRACKED', () => {
    const pristine = buildFile([{ iu: 'IU1', role: 'migration', key: 'users', body: 'A' }]);
    const manifest = sharedManifest(pristine);
    write(SHARED, buildFile([
      { iu: 'IU1', role: 'migration', key: 'users', body: 'A' },
      { iu: 'IUX', role: 'migration', key: 'orders', body: 'Z' },
    ]));
    const report = detectDrift(manifest, root);
    expect(report.entries.some(e => e.status === DriftStatus.UNTRACKED && e.key === 'orders')).toBe(true);
  });

  it('#15 a FILE-level waiver does not suppress an un-waivered region', () => {
    const pristine = buildFile([
      { iu: 'IU1', role: 'migration', key: 'users', body: 'A' },
      { iu: 'IU2', role: 'migration', key: 'orders', body: 'C' },
    ]);
    const manifest = sharedManifest(pristine);
    write(SHARED, buildFile([
      { iu: 'IU1', role: 'migration', key: 'users', body: 'A2' },   // drifted
      { iu: 'IU2', role: 'migration', key: 'orders', body: 'C2' },  // drifted
    ]));
    const waiver: DriftWaiver = { kind: 'waiver', reason: 'r' };
    // a file-level waiver should NOT blanket every region
    const report = detectDrift(manifest, root, new Map([[SHARED, waiver]]));
    expect(report.drifted_count).toBe(2);

    // a region-scoped waiver suppresses only its own region
    const scoped = new Map([[`${SHARED}#IU1|migration|users`, waiver]]);
    const r2 = detectDrift(manifest, root, scoped);
    expect(r2.entries.filter(e => e.status === DriftStatus.WAIVED).map(e => e.key)).toEqual(['users']);
    expect(r2.drifted_count).toBe(1);
  });

  it('#40 a drifted region reports the ACTUAL on-disk line range, not the stale manifest one', () => {
    const pristine = buildFile([{ iu: 'IU1', role: 'migration', key: 'users', body: 'A' }]);
    const manifest = sharedManifest(pristine);
    const manifestRange = manifest.shared_files![SHARED].regions[0];
    // insert 3 blank lines above + edit the body → on-disk start_line shifts by 3.
    const shifted = '\n\n\n' + buildFile([{ iu: 'IU1', role: 'migration', key: 'users', body: 'EDITED' }]);
    write(SHARED, shifted);
    const drifted = detectDrift(manifest, root).entries.find(e => e.status === DriftStatus.DRIFTED)!;
    expect(drifted.region!.start_line).toBe(manifestRange.start_line + 3);
  });
});

describe('adversarial: drift (owned files)', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'adv-drift2-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function ownedManifest(file: string, hash: string): GeneratedManifest {
    return { iu_manifests: { I: { iu_id: 'I', iu_name: 'I', files: { [file]: { path: file, content_hash: hash, size: 1 } }, regen_metadata: { model_id: 't', promptpack_hash: 'x', toolchain_version: 't', generated_at: 'now' } } }, shared_files: {}, generated_at: 'now' };
  }

  it('#16 an EXPIRED waiver does not suppress drift', () => {
    const file = 'src/generated/x/x.ts';
    const full = join(root, file); mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, 'changed', 'utf8');
    const manifest = ownedManifest(file, sha256('original'));
    const expired: DriftWaiver = { kind: 'waiver', reason: 'r', expires: '2020-01-01' };
    const report = detectDrift(manifest, root, new Map([[file, expired]]));
    expect(report.entries[0].status).toBe(DriftStatus.DRIFTED);
  });

  it('#41 an unreadable (directory) path does not crash the whole report', () => {
    const file = 'src/generated/x/x.ts';
    mkdirSync(join(root, file), { recursive: true });  // path exists but is a directory
    const manifest = ownedManifest(file, sha256('original'));
    expect(() => detectDrift(manifest, root)).not.toThrow();
    const report = detectDrift(manifest, root);
    expect(report.entries.length).toBe(1);
  });
});
