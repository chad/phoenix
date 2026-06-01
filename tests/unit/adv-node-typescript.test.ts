import { describe, it, expect } from 'vitest';
import { nodeTypescript, parseTscOutput } from '../../src/architectures/node-typescript.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

function iu(canon: string[] = ['CANON-1', 'CANON-2']): ImplementationUnit {
  return {
    iu_id: 'IU1', kind: 'module', name: 'Issue', risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: canon, dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: ['src/generated/issue/issue.ts'],
  };
}
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('adversarial: node-typescript', () => {
  it('#8 parseTscOutput tolerates CRLF line endings', () => {
    const out = 'src/foo.ts(1,2): error TS1: msg\r\nsrc/bar.ts(3,4): error TS2: msg2\r';
    expect(parseTscOutput(out)).toHaveLength(2);
  });

  it('#9 a LEADING `export default router;` in the body is de-duped (single default export)', () => {
    const body = "import { Hono } from 'hono';\nexport default router;\nconst router = new Hono();\nrouter.get('/', c => c.json({}));";
    const code = nodeTypescript.assemble(body, iu());
    expect(count(code, /export\s+default\s+router/g)).toBe(1);
  });

  it('#10 injects `const router` when the body uses new Hono() under another name', () => {
    const code = nodeTypescript.assemble("const r = new Hono();\nr.get('/', c => c.json({}));", iu());
    expect(/const\s+router\s*=\s*new Hono\(\)/.test(code)).toBe(true);
  });

  it('#35 collapses duplicate router declarations on a SINGLE line', () => {
    const code = nodeTypescript.assemble("const router = new Hono(); const router = new Hono();\nrouter.get('/', c => {});", iu());
    expect(count(code, /const\s+router\s*=\s*new Hono\(\)/g)).toBe(1);
  });

  it('#36 preserves a user import whose path merely contains "zod"/"hono"/"db.js"', () => {
    const code = nodeTypescript.assemble("import { Foo } from './schemas-zod.js';\nconst router = new Hono();\nconst x = Foo;", iu());
    expect(code).toContain("./schemas-zod.js");
  });

  it('#37 _phoenix.canon_ids emits the actual ids, not their count', () => {
    const code = nodeTypescript.assemble("const router = new Hono();", iu(['CANON-1', 'CANON-2', 'CANON-3']));
    expect(code).toContain('CANON-1');
    expect(code).toContain('CANON-3');
    expect(code).not.toMatch(/canon_ids:\s*\[\s*3\b/);
    // stub too
    expect(nodeTypescript.stub(iu(['CANON-9']))).toContain('CANON-9');
  });

  it('#59 recognize() does NOT delete unrelated lines mentioning "Database migrations"', () => {
    const mod = [
      "import { db, registerMigration } from '../../db.js';",
      "const note = 'See Database migrations doc';",
      "registerMigration('issues', `CREATE TABLE issues (id INTEGER)`);",
      "const x = 1;",
    ].join('\n');
    const rec = nodeTypescript.aggregates[0].recognize(mod);
    expect(rec.contributions.map(c => c.key)).toContain('issues');
    expect(rec.strippedCode).toContain('See Database migrations doc');
  });
});
