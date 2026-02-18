import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSpec } from '../../src/spec-parser.js';
import { extractCanonicalNodes } from '../../src/canonicalizer.js';
import { planIUs } from '../../src/iu-planner.js';
import { generateAll } from '../../src/regen.js';
import { ManifestManager } from '../../src/manifest.js';
import { detectDrift } from '../../src/drift.js';
import { extractDependencies } from '../../src/dep-extractor.js';
import { validateBoundary, detectBoundaryChanges } from '../../src/boundary-validator.js';
import { DriftStatus } from '../../src/models/manifest.js';

const SPEC = `# Authentication Service

The authentication service handles user login and session management.

## Requirements

- Users must authenticate with email and password
- Sessions expire after 24 hours
- Failed login attempts are rate-limited to 5 per minute
- Passwords must be hashed with bcrypt (cost factor 12)

## Security Constraints

- All endpoints must use HTTPS
- Tokens must be signed with RS256
- Password reset tokens expire after 1 hour`;

describe('Functional: Full IU Pipeline (C1 + C2)', () => {
  let projectRoot: string;
  let phoenixRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'phoenix-iu-'));
    phoenixRoot = join(projectRoot, '.phoenix');
    mkdirSync(phoenixRoot, { recursive: true });
  });

  it('end-to-end: spec → clauses → canon → IUs → generated code → manifest → drift check', async () => {
    // Phase A: Parse
    const clauses = parseSpec(SPEC, 'spec/auth.md');
    expect(clauses.length).toBeGreaterThan(0);

    // Phase B: Canonicalize
    const canon = extractCanonicalNodes(clauses);
    expect(canon.length).toBeGreaterThan(0);

    // Phase C1: Plan IUs
    const ius = planIUs(canon, clauses);
    expect(ius.length).toBeGreaterThan(0);

    // Phase C1: Generate code
    const results = await generateAll(ius);
    expect(results.length).toBe(ius.length);

    // Write generated files to disk
    for (const result of results) {
      for (const [path, content] of result.files) {
        const fullPath = join(projectRoot, path);
        mkdirSync(join(fullPath, '..'), { recursive: true });
        writeFileSync(fullPath, content, 'utf8');
      }
    }

    // Phase C1: Record manifest
    const manifestMgr = new ManifestManager(phoenixRoot);
    manifestMgr.recordAll(results.map(r => r.manifest));

    // Phase C1: Drift detection — should be clean
    const manifest = manifestMgr.load();
    const report = detectDrift(manifest, projectRoot);
    expect(report.drifted_count).toBe(0);
    expect(report.missing_count).toBe(0);
    expect(report.clean_count).toBe(results.reduce((sum, r) => sum + r.files.size, 0));
  });

  it('detects drift after manual edit', async () => {
    const clauses = parseSpec(SPEC, 'spec/auth.md');
    const canon = extractCanonicalNodes(clauses);
    const ius = planIUs(canon, clauses);
    const results = await generateAll(ius);

    // Write and record
    for (const result of results) {
      for (const [path, content] of result.files) {
        const fullPath = join(projectRoot, path);
        mkdirSync(join(fullPath, '..'), { recursive: true });
        writeFileSync(fullPath, content, 'utf8');
      }
    }
    const manifestMgr = new ManifestManager(phoenixRoot);
    manifestMgr.recordAll(results.map(r => r.manifest));

    // Now manually edit a file
    const firstResult = results[0];
    const firstFile = [...firstResult.files.keys()][0];
    const fullPath = join(projectRoot, firstFile);
    writeFileSync(fullPath, '// manually hacked\n' + readFileSync(fullPath, 'utf8'), 'utf8');

    // Drift detection should catch it
    const report = detectDrift(manifestMgr.load(), projectRoot);
    expect(report.drifted_count).toBeGreaterThan(0);
    expect(report.summary).toContain('DRIFT DETECTED');
  });

  it('regeneration after spec change produces new IUs', () => {
    // v1
    const clauses1 = parseSpec(SPEC, 'spec/auth.md');
    const canon1 = extractCanonicalNodes(clauses1);
    const ius1 = planIUs(canon1, clauses1);

    // v2 — add OAuth
    const specV2 = SPEC + '\n- OAuth2 providers (Google, GitHub) must be supported\n';
    const clauses2 = parseSpec(specV2, 'spec/auth.md');
    const canon2 = extractCanonicalNodes(clauses2);
    const ius2 = planIUs(canon2, clauses2);

    // v2 should have same or more IUs covering more canon nodes
    const totalCanonV2 = ius2.reduce((sum, iu) => sum + iu.source_canon_ids.length, 0);
    const totalCanonV1 = ius1.reduce((sum, iu) => sum + iu.source_canon_ids.length, 0);
    expect(totalCanonV2).toBeGreaterThanOrEqual(totalCanonV1);
  });

  it('boundary validator catches violations in generated code with bad imports', () => {
    const clauses = parseSpec(SPEC, 'spec/auth.md');
    const canon = extractCanonicalNodes(clauses);
    const ius = planIUs(canon, clauses);

    // Simulate code with a forbidden import
    const badCode = `import axios from 'axios';
import { secret } from './internal/admin.js';
const key = process.env.UNDECLARED_SECRET;
export function hack() {}`;

    const iu = {
      ...ius[0],
      boundary_policy: {
        code: {
          allowed_ius: [],
          allowed_packages: ['express'],
          forbidden_ius: [],
          forbidden_packages: ['axios'],
          forbidden_paths: ['./internal/**'],
        },
        side_channels: {
          databases: [], queues: [], caches: [],
          config: [], external_apis: [], files: [],
        },
      },
    };

    const graph = extractDependencies(badCode, 'src/auth.ts');
    const diags = validateBoundary(graph, iu);

    // Should catch: axios (forbidden), express not used but that's fine,
    // ./internal/admin.js (forbidden path), UNDECLARED_SECRET (undeclared config)
    expect(diags.length).toBeGreaterThanOrEqual(3);

    const categories = diags.map(d => d.category);
    expect(categories).toContain('dependency_violation');
    expect(categories).toContain('side_channel_violation');
  });

  it('boundary change detection triggers on policy update', () => {
    const clauses = parseSpec(SPEC, 'spec/auth.md');
    const canon = extractCanonicalNodes(clauses);
    const ius = planIUs(canon, clauses);

    const iuBefore = ius[0];
    const iuAfter = {
      ...iuBefore,
      boundary_policy: {
        ...iuBefore.boundary_policy,
        code: {
          ...iuBefore.boundary_policy.code,
          forbidden_packages: ['axios'],
        },
      },
    };

    const change = detectBoundaryChanges(iuBefore, iuAfter);
    expect(change).not.toBeNull();
    expect(change!.changes.length).toBeGreaterThan(0);
  });
});
