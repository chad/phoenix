import { describe, it, expect } from 'vitest';
import { parseRegions, splitSharedArtifacts } from '../../src/artifacts.js';
import type { RegenResult } from '../../src/regen.js';
import type { ResolvedTarget } from '../../src/models/architecture.js';
import { sha256 } from '../../src/semhash.js';

const OPEN = (k: string) => `// <<phx:region iu=x role=migration key=${k}>>`;
const CLOSE = '// <</phx:region>>';

describe('adversarial: artifacts.parseRegions', () => {
  it('#1 a body line containing the close-marker TOKEN does not truncate the region', () => {
    const body = ['line1', '-- old <</phx:region>> note', 'line3'].join('\n');
    const file = [OPEN('k'), body, CLOSE].join('\n');
    const regions = parseRegions(file);
    expect(regions).toHaveLength(1);
    expect(regions[0].body).toBe(body);
    expect(regions[0].content_hash).toBe(sha256(body));
  });

  it('#2 a missing close (new open before close) does not swallow the next region', () => {
    const file = [OPEN('k1'), 'bodyA', OPEN('k2'), 'bodyB', CLOSE].join('\n');
    const regions = parseRegions(file);
    const keys = regions.map(r => r.key).sort();
    expect(keys).toEqual(['k1', 'k2']);
  });

  it('#31 a key containing spaces round-trips through the marker', () => {
    const file = [OPEN('create users'), 'body', CLOSE].join('\n');
    const regions = parseRegions(file);
    expect(regions).toHaveLength(1);
    expect(regions[0].key).toBe('create users');
  });

  it('does not match a marker-like token embedded mid-line as a structural open (guard)', () => {
    const file = ['x <<phx:region iu=a role=m key=k>> still text', 'y'].join('\n');
    expect(parseRegions(file)).toHaveLength(0);
  });
});

// A custom aggregate role to exercise the generic engine with an empty key.
function fakeTarget(): ResolvedTarget {
  return {
    architecture: { name: 'x', description: '', communicationPattern: '', dataOwnership: '', evaluationSurface: '', systemPrompt: '', runtimeTargets: [] },
    runtime: {
      name: 'x', description: '', language: 'x', fileExtension: 'ts', packages: {}, devPackages: {},
      moduleTemplate: '', promptExtension: '', moduleGuide: '', codeExamples: '', sharedFiles: {}, packageExtras: {},
      outputPathFor: s => `src/generated/${s}/${s}.ts`,
      assemble: c => c, stub: () => '', extractContract: () => null,
      compile: () => [], ownsGeneratedFile: () => false,
      aggregates: [{
        role: 'x', filePath: 'src/generated/_x.ts', commentPrefix: '//', fileHeader: '// hdr\n', importSpecifier: null,
        recognize: (code: string) => code.includes('MARK')
          ? { strippedCode: code.replace('MARK\n', ''), removed: [], contributions: [{ key: '', body: 'register()' }] }
          : { strippedCode: code, removed: [], contributions: [] },
      }],
      scaffold: () => new Map(),
    },
  };
}

describe('adversarial: artifacts.assembleAggregate empty key', () => {
  it('#57 an empty key is recorded identically to how it round-trips (symmetry)', () => {
    const result: RegenResult = {
      iu_id: 'IU', files: new Map([['src/generated/a/a.ts', 'MARK\nrest']]),
      manifest: { iu_id: 'IU', iu_name: 'IU', files: { 'src/generated/a/a.ts': { path: 'src/generated/a/a.ts', content_hash: 'h', size: 1 } }, regen_metadata: { model_id: 't', promptpack_hash: 'x', toolchain_version: 't', generated_at: 'now' } },
    };
    const split = splitSharedArtifacts([result], fakeTarget());
    const recordedKey = split.sharedFiles[0].regions[0].key;
    const parsedKey = parseRegions(split.files.get('src/generated/_x.ts')!)[0].key;
    expect(recordedKey).toBe(parsedKey); // both undefined — symmetric
  });
});
