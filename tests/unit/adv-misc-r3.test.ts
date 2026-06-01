import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluatePolicy } from '../../src/policy-engine.js';
import { ContentStore } from '../../src/store/content-store.js';
import { defaultPaceLayerMetadata } from '../../src/models/pace-layer.js';
import { collectInspectData } from '../../src/inspect.js';
import { CanonicalType } from '../../src/models/canonical.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import type { GeneratedManifest } from '../../src/models/manifest.js';

describe('adversarial: misc round-3', () => {
  it('#23 evaluatePolicy returns an independent required[] (caller cannot mutate the IU)', () => {
    const iu = { iu_id: 'A', name: 'A', risk_tier: 'low', evidence_policy: { required: ['lint'] } } as unknown as ImplementationUnit;
    const r = evaluatePolicy(iu, []);
    expect(r.required).not.toBe(iu.evidence_policy.required);
    r.required.push('HACKED');
    expect(iu.evidence_policy.required).toEqual(['lint']); // unchanged
  });

  it('#25 ContentStore.put rejects an empty id instead of writing to the objects dir', () => {
    const root = mkdtempSync(join(tmpdir(), 'adv-cs-'));
    const store = new ContentStore(root);
    expect(() => store.put('', { x: 1 })).toThrow();
    store.put('abcd', { x: 1 }); // valid id works
    rmSync(root, { recursive: true, force: true });
  });

  it('#36 defaultPaceLayerMetadata is deterministic (two calls are equal)', () => {
    expect(defaultPaceLayerMetadata()).toEqual(defaultPaceLayerMetadata());
  });

  it('#1 collectInspectData does not emit edges to dangling canon links (no crash source)', () => {
    const node = (id: string, linked: string[]): CanonicalNode =>
      ({ canon_id: id, type: CanonicalType.REQUIREMENT, statement: 's', tags: [], source_clause_ids: [], linked_canon_ids: linked, link_types: {} } as unknown as CanonicalNode);
    const canon = [node('n1', ['GHOST'])]; // n1 links to a non-existent node
    const manifest: GeneratedManifest = { iu_manifests: {}, shared_files: {}, generated_at: '' };
    const data = collectInspectData('p', 'S', [], canon, [], manifest, null);
    const edges = (data as { edges?: Array<{ to: string }> }).edges ?? [];
    expect(edges.some(e => e.to === 'canon:GHOST')).toBe(false);
  });
});
