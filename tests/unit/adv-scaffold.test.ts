import { describe, it, expect } from 'vitest';
import { deriveServices, nodeScaffold } from '../../src/scaffold.js';
import { nodeTypescript } from '../../src/architectures/node-typescript.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import type { ServiceDescriptor } from '../../src/models/architecture.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

function iu(name: string, ...files: string[]): ImplementationUnit {
  return {
    iu_id: 'IU_' + name, kind: 'module', name, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: [], dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: files,
  };
}

describe('adversarial: scaffold', () => {
  it('#17 deriveServices assigns ports by SORTED order, not input order (deterministic)', () => {
    const a = deriveServices([iu('Z', 'src/generated/zebra/z.ts'), iu('A', 'src/generated/apple/a.ts')]);
    const b = deriveServices([iu('A', 'src/generated/apple/a.ts'), iu('Z', 'src/generated/zebra/z.ts')]);
    expect(a.map(s => [s.dir, s.port])).toEqual(b.map(s => [s.dir, s.port]));
    expect(a.find(s => s.dir === 'apple')!.port).toBe(3000);
  });

  it('#18 deriveServices dedups a module two IUs target the same file', () => {
    const svcs = deriveServices([iu('A', 'src/generated/svc/m.ts'), iu('B', 'src/generated/svc/m.ts')]);
    expect(svcs[0].modules).toEqual(['m.ts']);
    expect(svcs[0].ius).toHaveLength(1);
  });

  it('#19 nodeScaffold (no target) does not crash on a module name with empty dash segments', () => {
    const svc: ServiceDescriptor = { name: 'Web Ui', dir: 'web-ui', modules: ['a--b.ts'], ius: [iu('X', 'src/generated/web-ui/a--b.ts')], port: 3000 };
    expect(() => nodeScaffold([svc], 'p', null)).not.toThrow();
  });

  it('#20 generateArchTests emits a valid identifier for a nested module path', () => {
    const svcs = deriveServices([iu('A', 'src/generated/api/v1/users.ts')]);
    const test = nodeTypescript.scaffold(svcs, 'p', []).get('src/generated/api/__tests__/api.test.ts')!;
    expect(/import\s+v1Users\b/.test(test)).toBe(true);
    expect(/import\s+\w*\/\w*/.test(test)).toBe(false); // no slash in the import binding
  });

  it('#42 module names containing ".ts" earlier are not corrupted in the server import path', () => {
    const svcs = deriveServices([iu('A', 'src/generated/svc/a.tsconfig.ts')]);
    const server = nodeTypescript.scaffold(svcs, 'p', []).get('src/server.ts')!;
    expect(server).toContain('a.tsconfig.js');
    expect(server).not.toContain('a.jsconfig');
  });

  it('#43 generateServiceIndex disambiguates toCamelCase collisions', () => {
    const svcs = deriveServices([iu('A', 'src/generated/svc/user-profile.ts'), iu('B', 'src/generated/svc/user_profile.ts')]);
    const idx = nodeTypescript.scaffold(svcs, 'p', []).get('src/generated/svc/index.ts')!;
    const names = [...idx.matchAll(/export \* as (\w+) from/g)].map(m => m[1]);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2); // distinct identifiers
  });

  it('#44 mount prefix never collapses to root/empty for a non-web IU', () => {
    const svcs = deriveServices([iu('!!!', 'src/generated/svc/m.ts')]);
    const server = nodeTypescript.scaffold(svcs, 'p', []).get('src/server.ts')!;
    expect(server).not.toMatch(/mount\(\s*'\/?'\s*,/); // not mount('') or mount('/')
  });
});
