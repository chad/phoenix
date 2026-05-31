import { describe, it, expect } from 'vitest';
import { splitSharedArtifacts, parseRegions, MIGRATIONS_FILE } from '../../src/artifacts.js';
import type { RegenResult } from '../../src/regen.js';
import { sha256 } from '../../src/semhash.js';

/** Build a minimal RegenResult for one module file. */
function makeResult(
  iu_id: string,
  path: string,
  content: string,
  line_provenance?: Record<string, string>,
): RegenResult {
  return {
    iu_id,
    files: new Map([[path, content]]),
    manifest: {
      iu_id,
      iu_name: iu_id,
      files: {
        [path]: {
          path,
          content_hash: sha256(content),
          size: content.length,
          ...(line_provenance ? { line_provenance } : {}),
        },
      },
      regen_metadata: {
        model_id: 'test', promptpack_hash: 'x', toolchain_version: 't', generated_at: 'now',
      },
    },
  };
}

const ISSUE_MODULE = `import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────
registerMigration('issues', \`
  CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL
  )
\`);

const router = new Hono();

router.get('/', (c) => c.json(db.prepare('SELECT * FROM issues').all()));

export default router;`;

describe('splitSharedArtifacts — migrations', () => {
  it('lifts registerMigration out of the module into the shared file', () => {
    const r = makeResult('ISSUE', 'src/generated/issue/issue.ts', ISSUE_MODULE);
    const split = splitSharedArtifacts([r], null);

    // Module no longer self-registers.
    const moduleNow = r.files.get('src/generated/issue/issue.ts')!;
    expect(moduleNow).not.toContain('registerMigration(');
    // Module still has its route + db usage.
    expect(moduleNow).toContain("router.get('/'");
    expect(moduleNow).toContain('db.prepare');

    // Shared file exists with a region for ISSUE.
    const shared = split.files.get(MIGRATIONS_FILE)!;
    expect(shared).toContain('registerMigration');
    expect(shared).toContain('phx:region iu=ISSUE role=migration key=issues');

    // Manifest: one region, hash over the body.
    expect(split.sharedFiles).toHaveLength(1);
    const region = split.sharedFiles[0].regions[0];
    expect(region.iu_id).toBe('ISSUE');
    expect(region.role).toBe('migration');
    expect(region.key).toBe('issues');

    // serverImports points at the migrations file.
    expect(split.serverImports).toEqual(['./generated/_migrations.js']);
  });

  it('prunes registerMigration from the db import when no longer used', () => {
    const r = makeResult('ISSUE', 'src/generated/issue/issue.ts', ISSUE_MODULE);
    splitSharedArtifacts([r], null);
    const moduleNow = r.files.get('src/generated/issue/issue.ts')!;
    expect(moduleNow).toContain("import { db } from '../../db.js'");
    expect(moduleNow).not.toContain('registerMigration');
  });

  it('round-trips: parsed region hash matches the recorded manifest hash', () => {
    const r = makeResult('ISSUE', 'src/generated/issue/issue.ts', ISSUE_MODULE);
    const split = splitSharedArtifacts([r], null);
    const shared = split.files.get(MIGRATIONS_FILE)!;
    const parsed = parseRegions(shared);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].content_hash).toBe(split.sharedFiles[0].regions[0].content_hash);
    expect(parsed[0].start_line).toBe(split.sharedFiles[0].regions[0].start_line);
  });

  it('dedupes duplicate table ownership, first IU wins', () => {
    const a = makeResult('ISSUE_A', 'src/generated/a/a.ts', ISSUE_MODULE);
    const b = makeResult('ISSUE_B', 'src/generated/b/b.ts', ISSUE_MODULE);
    const split = splitSharedArtifacts([a, b], null);

    // Only one region for the 'issues' table.
    const regions = split.sharedFiles[0].regions.filter(r => r.key === 'issues');
    expect(regions).toHaveLength(1);
    expect(regions[0].iu_id).toBe('ISSUE_A');
    // Conflict reported.
    expect(split.conflicts).toEqual([
      { table: 'issues', keptIU: 'ISSUE_A', droppedIUs: ['ISSUE_B'] },
    ]);
  });

  it('remaps line provenance across the removed block', () => {
    // Provenance on the import line (1), the route line, etc. The migration block is
    // lines 4..10 (header + registerMigration). After removal those keys drop and
    // later lines shift up.
    const lines = ISSUE_MODULE.split('\n');
    const routeIdx = lines.findIndex(l => l.includes("router.get('/'"));
    const prov = {
      '1': 'CANON_IMPORT',           // import line — kept, before the block
      '5': 'CANON_MIGRATION',        // inside the migration block — should drop
      [String(routeIdx)]: 'CANON_ROUTE', // route line — kept, shifts up
    };
    const r = makeResult('ISSUE', 'src/generated/issue/issue.ts', ISSUE_MODULE, prov);
    splitSharedArtifacts([r], null);

    const out = r.manifest.files['src/generated/issue/issue.ts'].line_provenance!;
    const moduleNow = r.files.get('src/generated/issue/issue.ts')!.split('\n');

    // The migration-line provenance is gone.
    expect(Object.values(out)).not.toContain('CANON_MIGRATION');
    // The route provenance still points at the route line in the NEW file.
    const newRouteKey = Object.keys(out).find(k => out[k] === 'CANON_ROUTE')!;
    expect(moduleNow[Number(newRouteKey)]).toContain("router.get('/'");
  });

  it('no-ops cleanly when there are no migrations', () => {
    const plain = `import { Hono } from 'hono';\nconst router = new Hono();\nexport default router;`;
    const r = makeResult('UI', 'src/generated/ui/ui.ts', plain);
    const split = splitSharedArtifacts([r], null);
    expect(split.sharedFiles).toHaveLength(0);
    expect(split.files.size).toBe(0);
    expect(r.files.get('src/generated/ui/ui.ts')).toBe(plain);
  });

  it('preserves regions for IUs not in the batch (partial regen merge)', () => {
    // First, full split to get an existing shared file.
    const issue = makeResult('ISSUE', 'src/generated/issue/issue.ts', ISSUE_MODULE);
    const first = splitSharedArtifacts([issue], null);
    const existing = parseRegions(first.files.get(MIGRATIONS_FILE)!);

    // Now regen only a different IU; preserve ISSUE's region.
    const sprintModule = ISSUE_MODULE.replace(/issues/g, 'sprints');
    const sprint = makeResult('SPRINT', 'src/generated/sprint/sprint.ts', sprintModule);
    const second = splitSharedArtifacts([sprint], null, { preserve: existing });

    const tables = second.sharedFiles[0].regions.map(r => r.key).sort();
    expect(tables).toEqual(['issues', 'sprints']);
  });
});
