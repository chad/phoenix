import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pythonFastapi } from '../../src/architectures/python-fastapi.js';
import type { ServiceDescriptor } from '../../src/models/architecture.js';

const svc = (name: string, dir: string): ServiceDescriptor => ({ name, dir, modules: [`${dir}.py`], ius: [], port: 0 });

describe('adversarial: python-fastapi', () => {
  it('#0 pyCompile surfaces PYCHECK when the checker fails/produces no output (never false-clean)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adv-py-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'ok.py'), 'x = 1\n', 'utf8');
    const bin = mkdtempSync(join(tmpdir(), 'adv-bin-'));
    const shim = join(bin, 'python3');
    writeFileSync(shim, '#!/bin/sh\nexit 1\n', 'utf8'); // throws with NO output
    chmodSync(shim, 0o755);
    const saved = process.env.PATH;
    process.env.PATH = bin + ':' + saved;
    try {
      const errs = pythonFastapi.compile!(dir);
      expect(errs.length).toBeGreaterThan(0);
      expect(errs[0].code).toBe('PYCHECK');
    } finally {
      process.env.PATH = saved;
      rmSync(dir, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it('#11 forbidden import in comma form `import os, requests` is flagged', () => {
    expect(pythonFastapi.validateSource!('import os, requests\n')).toBeTruthy();
    expect(pythonFastapi.validateSource!('import sys, sqlalchemy as sa\n')).toBeTruthy();
    expect(pythonFastapi.validateSource!('import os, json\n')).toBeNull(); // both stdlib
  });

  it('#12 two web services do not both mount at root', () => {
    const files = pythonFastapi.scaffold([svc('admin dashboard', 'admin_dashboard'), svc('public web', 'public_web')], 'proj', []);
    const main = files.get('src/main.py')!;
    const emptyPrefixMounts = (main.match(/prefix=""/g) ?? []).length;
    expect(emptyPrefixMounts).toBeLessThanOrEqual(1);
  });

  it('#38 pruneMigrationImport removes register_migration even with a trailing comment', () => {
    const mod = "from src.db import db, register_migration  # noqa\nregister_migration('t', \"\"\"CREATE TABLE t (id INTEGER)\"\"\")\nx = 1\n";
    const rec = pythonFastapi.aggregates[0].recognize(mod);
    expect(rec.contributions.map(c => c.key)).toContain('t');
    expect(rec.strippedCode).toContain('from src.db import db');
    expect(rec.strippedCode).not.toContain('register_migration');
  });

  it('#39 recognize preserves a single-quoted table name containing a double-quote', () => {
    const rec = pythonFastapi.aggregates[0].recognize('register_migration(\'a"b\', """X""")\n');
    expect(rec.contributions[0].body).toContain('\'a"b\'');
    expect(rec.contributions[0].body).not.toContain('"a"b"');
  });

  it('#59 recognize does not delete unrelated lines mentioning "Database migrations"', () => {
    const mod = [
      'from src.db import register_migration',
      'note = "Database migrations are append-only"',
      "register_migration('t', \"\"\"CREATE TABLE t (id INTEGER)\"\"\")",
    ].join('\n');
    const rec = pythonFastapi.aggregates[0].recognize(mod);
    expect(rec.strippedCode).toContain('Database migrations are append-only');
  });

  it('#60 assemble injects a real router when the only mention is in a comment', () => {
    const code = pythonFastapi.assemble('# router = APIRouter()\nx = 1', { iu_id: 'I', name: 'N', risk_tier: 'low', source_canon_ids: [], kind: 'module', contract: { description: '', inputs: [], outputs: [], invariants: [] }, dependencies: [], boundary_policy: { code: { allowed_ius: [], allowed_packages: [], forbidden_ius: [], forbidden_packages: [], forbidden_paths: [] }, side_channels: { databases: [], queues: [], caches: [], config: [], external_apis: [], files: [] } }, enforcement: { dependency_violation: { severity: 'error' }, side_channel_violation: { severity: 'warning' } }, evidence_policy: { required: [] }, output_files: [] });
    expect(/^router\s*=\s*APIRouter\(\)/m.test(code)).toBe(true);
    expect(/^_phoenix\s*=/m.test(code)).toBe(true);
  });
});
