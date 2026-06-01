import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { runCompileGate } from '../../src/compile-gate.js';
import type { CompileError } from '../../src/compile-gate.js';
import type { ResolvedTarget } from '../../src/models/architecture.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

function iu(...paths: string[]): ImplementationUnit {
  return {
    iu_id: 'IU_' + paths[0], kind: 'module', name: paths[0], risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: [], dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: paths,
  };
}

function target(opts: { validateSource?: (c: string) => string | null }): ResolvedTarget {
  return {
    architecture: { name: 'x', description: '', communicationPattern: '', dataOwnership: '', evaluationSurface: '', systemPrompt: '', runtimeTargets: [] },
    runtime: {
      name: 'x', description: '', language: 'x', fileExtension: 'ts', packages: {}, devPackages: {},
      moduleTemplate: '', promptExtension: '', moduleGuide: '', codeExamples: '', sharedFiles: {}, packageExtras: {},
      outputPathFor: s => s, assemble: c => c, stub: () => '', extractContract: () => null,
      compile: () => [], ownsGeneratedFile: f => f.startsWith('src/generated/'),
      validateSource: opts.validateSource, aggregates: [], scaffold: () => new Map(),
    },
  };
}

describe('adversarial: compile-gate', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'adv-gate-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const write = (rel: string, c: string) => { const f = join(root, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c, 'utf8'); };

  it('#3 a no-op LLM echo (differs only by trailing newline) is detected — no burn, newline kept', async () => {
    const file = 'src/generated/x/x.ts';
    write(file, 'export const x = 1;\n');
    const echo: LLMProvider = { name: 'f', model: 'v', generate: async () => readFileSync(join(root, file), 'utf8') };
    const persistent = (): CompileError[] => [{ file, line: 1, col: 1, code: 'X', message: 'e', raw: `${file}(1,1): error X: e` }];
    const res = await runCompileGate(root, { target: target({}), typecheck: persistent, llm: echo, maxRounds: 3 });
    expect(res.rounds).toBe(0);                 // detected no-op, broke immediately
    expect(res.repaired).toEqual([]);           // not falsely listed as repaired
    expect(readFileSync(join(root, file), 'utf8').endsWith('\n')).toBe(true); // newline preserved
  });

  it('#32 surfaces the FULL source-gate message, not truncated at the first period', async () => {
    const file = 'src/generated/p/p.ts';
    write(file, 'ok');
    const res = await runCompileGate(root, {
      target: target({ validateSource: () => 'Bad thing happened. Here is how to fix it: do X.' }),
      typecheck: () => [], ius: [iu(file)],
    });
    const sg = res.unresolved.find(e => e.code === 'SOURCE_GATE')!;
    expect(sg.message).toContain('how to fix it');
  });

  it('#33 a fixable source-gate error is repaired IN the loop when an LLM is available', async () => {
    const file = 'src/generated/p/p.ts';
    write(file, 'BADJS rest\n');
    const llm: LLMProvider = { name: 'f', model: 'v', generate: async () => 'rest\n' };
    const res = await runCompileGate(root, {
      target: target({ validateSource: c => c.includes('BADJS') ? 'inline error. fix it.' : null }),
      typecheck: () => [], llm, ius: [iu(file)], maxRounds: 3,
    });
    expect(res.ok).toBe(true);
    expect(readFileSync(join(root, file), 'utf8')).not.toContain('BADJS');
  });

  it('#58 dedups a shared owned file and skips non-owned files', async () => {
    write('src/generated/page.ts', 'ERR here');
    write('public/x.ts', 'ERR here');
    const res = await runCompileGate(root, {
      target: target({ validateSource: c => c.includes('ERR') ? 'e. m.' : null }),
      typecheck: () => [],
      ius: [iu('src/generated/page.ts'), iu('src/generated/page.ts', 'public/x.ts')],
    });
    const sg = res.unresolved.filter(e => e.code === 'SOURCE_GATE');
    expect(sg).toHaveLength(1);
    expect(sg[0].file).toBe('src/generated/page.ts');
  });
});
