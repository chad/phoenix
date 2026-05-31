import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { parseTscOutput, runCompileGate } from '../../src/compile-gate.js';
import type { CompileError } from '../../src/compile-gate.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

function iu(path: string): ImplementationUnit {
  return {
    iu_id: 'IU_' + path, kind: 'module', name: path, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: [], dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: [path],
  };
}

function fakeLLM(reply: string): LLMProvider {
  return { name: 'fake', model: 'v0', generate: async () => reply };
}

describe('parseTscOutput', () => {
  it('parses real tsc error lines into structured errors', () => {
    const out = [
      "src/generated/sprint-rollup/sprint-rollup.ts(74,57): error TS18048: 'sprint.capacity' is possibly 'undefined'.",
      'some unrelated line',
      "src/generated/issue/issue.ts(12,3): error TS2322: Type 'x' is not assignable to type 'y'.",
    ].join('\n');
    const errs = parseTscOutput(out);
    expect(errs).toHaveLength(2);
    expect(errs[0]).toMatchObject({ file: 'src/generated/sprint-rollup/sprint-rollup.ts', line: 74, col: 57, code: 'TS18048' });
    expect(errs[1].code).toBe('TS2322');
  });
});

describe('runCompileGate', () => {
  let root: string;
  const FILE = 'src/generated/x/x.ts';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'phoenix-gate-'));
    mkdirSync(dirname(join(root, FILE)), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  // Typecheck stub: errors while the file still contains BROKEN, clean afterwards.
  const stubCheck = (projectRoot: string): CompileError[] => {
    const c = readFileSync(join(projectRoot, FILE), 'utf8');
    return c.includes('BROKEN')
      ? [{ file: FILE, line: 1, col: 1, code: 'TS9999', message: 'broken', raw: `${FILE}(1,1): error TS9999: broken` }]
      : [];
  };

  it('passes immediately when the project already compiles', async () => {
    writeFileSync(join(root, FILE), 'const ok = 1;', 'utf8');
    const res = await runCompileGate(root, { ius: [iu(FILE)], typecheck: stubCheck });
    expect(res.ok).toBe(true);
    expect(res.repaired).toEqual([]);
    expect(res.rounds).toBe(0);
  });

  it('repairs a broken generated file using the LLM, then re-verifies clean', async () => {
    writeFileSync(join(root, FILE), 'const BROKEN = ;', 'utf8');
    const res = await runCompileGate(root, {
      llm: fakeLLM('const fixed = 1;'),
      ius: [iu(FILE)],
      typecheck: stubCheck,
    });
    expect(res.ok).toBe(true);
    expect(res.repaired).toEqual([FILE]);
    expect(readFileSync(join(root, FILE), 'utf8')).toContain('fixed');
  });

  it('is honest when there is no LLM: reports unresolved, repairs nothing', async () => {
    writeFileSync(join(root, FILE), 'const BROKEN = ;', 'utf8');
    const res = await runCompileGate(root, { ius: [iu(FILE)], typecheck: stubCheck });
    expect(res.ok).toBe(false);
    expect(res.unresolved).toHaveLength(1);
    expect(res.repaired).toEqual([]);
  });

  it('does not touch non-generated files and reports them unresolved', async () => {
    writeFileSync(join(root, FILE), 'const ok = 1;', 'utf8');
    // Error lives in a hand-written scaffold file we must never rewrite.
    const scaffoldErr = (): CompileError[] =>
      [{ file: 'src/server.ts', line: 3, col: 1, code: 'TS1005', message: 'oops', raw: 'src/server.ts(3,1): error TS1005: oops' }];
    const res = await runCompileGate(root, { llm: fakeLLM('whatever'), ius: [iu(FILE)], typecheck: scaffoldErr });
    expect(res.ok).toBe(false);
    expect(res.repaired).toEqual([]);
    expect(res.unresolved[0].file).toBe('src/server.ts');
  });

  it('gives up after maxRounds if repair never converges', async () => {
    writeFileSync(join(root, FILE), 'const BROKEN = 0;', 'utf8');
    // LLM keeps making edits but never removes BROKEN — must hit the maxRounds cutoff.
    let n = 0;
    const churningLLM: LLMProvider = { name: 'fake', model: 'v0', generate: async () => `const BROKEN = ${++n};` };
    const res = await runCompileGate(root, {
      llm: churningLLM, ius: [iu(FILE)], typecheck: stubCheck, maxRounds: 2,
    });
    expect(res.ok).toBe(false);
    expect(res.rounds).toBe(2);
  });

  it('stops early (before maxRounds) when a repair round makes no change', async () => {
    writeFileSync(join(root, FILE), 'const BROKEN = ;', 'utf8');
    const res = await runCompileGate(root, {
      llm: fakeLLM('const BROKEN = still;'), ius: [iu(FILE)], typecheck: stubCheck, maxRounds: 5,
    });
    expect(res.ok).toBe(false);
    expect(res.rounds).toBe(1); // edited once, then the LLM repeated itself → give up
  });
});
