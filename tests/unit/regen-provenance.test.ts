import { describe, it, expect } from 'vitest';
import { generateIU } from '../../src/regen.js';
import type { RegenContext } from '../../src/regen.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';
import type { CanonicalNode } from '../../src/models/canonical.js';

function canon(id: string, type: string, statement: string): CanonicalNode {
  return {
    canon_id: id, type: type as CanonicalNode['type'], statement, tags: [],
    source_clause_ids: [], linked_canon_ids: [], confidence: 1, extraction_method: 'rule',
  } as CanonicalNode;
}

const IU: ImplementationUnit = {
  iu_id: 'iu-auth', kind: 'module', name: 'Auth', risk_tier: 'medium',
  contract: { description: 'auth', inputs: [], outputs: [], invariants: [] },
  source_canon_ids: ['c-req-1', 'c-con-1'],
  dependencies: [], boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
  evidence_policy: { required: [] }, output_files: ['auth.ts'],
};
const NODES = [
  canon('c-req-1', 'REQUIREMENT', 'users can log in'),
  canon('c-con-1', 'CONSTRAINT', 'passwords must be long'),
];

/** Fake provider that returns code annotated with provenance markers. */
function fakeLLM(code: string): LLMProvider {
  return { name: 'fake', model: 'test', generate: async () => code };
}

describe('generateIU — line-level provenance round-trip', () => {
  it('captures //phx markers into the manifest and strips them from written code', async () => {
    const llm = fakeLLM([
      "router.post('/login', login);  //phx:R1",
      'const minLen = 8; // phx:C1',
      'export const _phoenix = {};',
    ].join('\n'));
    const ctx: RegenContext = { llm, canonNodes: NODES, allIUs: [IU] };
    const result = await generateIU(IU, ctx);

    const entry = result.manifest.files['auth.ts'];
    expect(entry.line_provenance).toEqual({ '0': 'c-req-1', '1': 'c-con-1' });

    const written = result.files.get('auth.ts')!;
    expect(written).not.toContain('//phx');
    expect(written).toContain("router.post('/login', login);");
  });

  it('omits line_provenance when the model emits no markers', async () => {
    const llm = fakeLLM('const a = 1;\nexport const _phoenix = {};');
    const ctx: RegenContext = { llm, canonNodes: NODES, allIUs: [IU] };
    const result = await generateIU(IU, ctx);
    expect(result.manifest.files['auth.ts'].line_provenance).toBeUndefined();
  });
});
