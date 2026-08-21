import { describe, it, expect } from 'vitest';
import { deriveServices, nodeScaffold } from '../../src/scaffold.js';
import { nodeTypescript } from '../../src/architectures/node-typescript.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
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

const ius = [
  iu('task', 'src/generated/task/task.ts'),
  iu('summary', 'src/generated/summary/summary.ts'),
];

function serverFrom(declared?: ReadonlyMap<string, string>): string {
  const services = deriveServices(ius);
  return nodeScaffold(services, 'p', nodeTypescript, [], declared).files.get('src/server.ts')!;
}

describe('the spec\'s declared interface outranks the IU name', () => {
  it('without a declaration, the mount is the IU-name slug (the old behaviour, unchanged)', () => {
    const server = serverFrom();
    expect(server).toContain(`mount('/task',`);
    expect(server).toContain(`mount('/summary',`);
  });

  it('with a declaration, the declared path wins — the bug the bench found', () => {
    const server = serverFrom(new Map([
      ['src/generated/task/task.ts', '/tasks'],
      ['src/generated/summary/summary.ts', '/stats'],
    ]));
    expect(server).toContain(`mount('/tasks',`);
    expect(server).toContain(`mount('/stats',`);
    expect(server).not.toContain(`mount('/task',`);
    expect(server).not.toContain(`mount('/summary',`);
  });

  it('a partial declaration places what it knows and leaves the rest on the slug rule', () => {
    const server = serverFrom(new Map([['src/generated/task/task.ts', '/tasks']]));
    expect(server).toContain(`mount('/tasks',`);
    expect(server).toContain(`mount('/summary',`);
  });

  it('the architecture passes the declaration through to the scaffold', () => {
    const server = nodeTypescript
      .scaffold(deriveServices(ius), 'p', [], new Map([['src/generated/task/task.ts', '/tasks']]))
      .get('src/server.ts')!;
    expect(server).toContain(`mount('/tasks',`);
  });

  it('a declared mount is not renamed by the duplicate-prefix guard', () => {
    // Two modules, one declaration: the declared one keeps its exact path.
    const server = serverFrom(new Map([['src/generated/summary/summary.ts', '/task']]));
    expect(server).toContain(`mount('/task',`);
    expect((server.match(/mount\('\/task'/g) ?? []).length).toBe(1);
    expect(server).toContain(`mount('/task-2',`); // the slug-derived one yields, not the contract
  });
});
