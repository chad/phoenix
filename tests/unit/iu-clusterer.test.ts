import { describe, it, expect } from 'vitest';
import { clusterCanonNodes, clusterCanonNodesLLM } from '../../src/iu-clusterer.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CanonicalType } from '../../src/models/canonical.js';
import type { LLMProvider } from '../../src/llm/provider.js';

let seq = 0;
function node(type: CanonicalType, statement: string, tags: string[]): CanonicalNode {
  return {
    canon_id: `c${seq++}`, type, statement, tags,
    source_clause_ids: [], linked_canon_ids: [],
  };
}

// Two domain entities + a UI capability — note there is NO document/section structure
// here at all; clustering must come from the nodes' own semantics.
function corpus(): CanonicalNode[] {
  seq = 0;
  return [
    node(CanonicalType.REQUIREMENT, 'users can add a book with a title', ['book', 'title']),
    node(CanonicalType.REQUIREMENT, 'users can edit a book author', ['book', 'author']),
    node(CanonicalType.CONSTRAINT, 'a book isbn must be unique', ['book', 'isbn']),
    node(CanonicalType.REQUIREMENT, 'users can register a member with an email', ['member', 'email']),
    node(CanonicalType.CONSTRAINT, 'a member name must be present', ['member', 'name']),
    node(CanonicalType.REQUIREMENT, 'the dashboard shows a responsive layout', ['dashboard', 'layout', 'responsive']),
    node(CanonicalType.REQUIREMENT, 'the dashboard renders a sidebar', ['dashboard', 'sidebar', 'render']),
  ];
}

describe('clusterCanonNodes (rule)', () => {
  it('clusters by domain entity / capability, not by document structure', () => {
    const clusters = clusterCanonNodes(corpus());
    const byAnchor = Object.fromEntries(clusters.map(c => [c.anchor, c.nodes.length]));
    // Each entity is its own module; the UI is separate.
    expect(Object.keys(byAnchor)).toEqual(expect.arrayContaining(['book', 'member']));
    expect(byAnchor.book).toBe(3);
    expect(byAnchor.member).toBe(2);
    // A presentation cluster exists (named by a view marker) and holds both UI nodes.
    const view = clusters.find(c => !['book', 'member'].includes(c.anchor));
    expect(view?.nodes.length).toBe(2);
  });

  it('returns nothing for only CONTEXT nodes', () => {
    expect(clusterCanonNodes([node(CanonicalType.CONTEXT, 'background blurb', ['intro'])])).toEqual([]);
  });
});

describe('clusterCanonNodesLLM (semantic)', () => {
  const fake = (out: string): LLMProvider => ({ name: 'fake', model: 't', generate: async () => out });

  it('partitions per the model and maps members back to nodes', async () => {
    const llm = fake('[{"name":"Book","members":[1,2,3]},{"name":"Member","members":[4,5]},{"name":"Dashboard","members":[6,7]}]');
    const clusters = await clusterCanonNodesLLM(corpus(), llm);
    expect(clusters.map(c => c.anchor).sort()).toEqual(['book', 'dashboard', 'member']);
    expect(clusters.find(c => c.anchor === 'book')!.nodes.length).toBe(3);
  });

  it('falls back to the rule clusterer on a bad response, losing no nodes', async () => {
    const llm = fake('not json at all');
    const clusters = await clusterCanonNodesLLM(corpus(), llm);
    const total = clusters.reduce((s, c) => s + c.nodes.length, 0);
    expect(total).toBe(7);
  });
});

describe('phrasing-artifact anchors (the adapted-spec lesson)', () => {
  it("never names a cluster 'include'/'equal'/'able' — requirement phrasing is not a domain", () => {
    seq = 0;
    const nodes = [
      node(CanonicalType.REQUIREMENT, 'the room must include a name', ['room', 'include', 'name']),
      node(CanonicalType.REQUIREMENT, 'the room must include a topic', ['room', 'include', 'topic']),
      node(CanonicalType.REQUIREMENT, 'the avatar hash must equal the recomputed hash', ['avatar', 'equal', 'hash']),
      node(CanonicalType.REQUIREMENT, 'the avatar must be able to render offline', ['avatar', 'able', 'render']),
    ];
    const anchors = clusterCanonNodes(nodes).map(c => c.anchor);
    for (const junk of ['include', 'equal', 'able']) expect(anchors).not.toContain(junk);
  });
});

describe('clusterCanonNodesLLM — loud fallback and the two-stage path', () => {
  it('a garbage LLM reply falls back to rules LOUDLY (onFallback fires)', async () => {
    const bad: LLMProvider = { name: 'fake', model: 't', generate: async () => 'not json at all' };
    let heard: string | null = null;
    const clusters = await clusterCanonNodesLLM(corpus(), bad, { onFallback: (e) => { heard = e.message; } });
    expect(heard).not.toBeNull();               // the downgrade is announced
    expect(clusters.length).toBeGreaterThan(0); // and the rule clusterer still delivers
  });

  it('large graphs go two-stage: discover module names, then assign in batches', async () => {
    seq = 0;
    // 160 nodes (> LLM_SINGLE_CALL_MAX) across two entities.
    const nodes: CanonicalNode[] = [];
    for (let i = 0; i < 80; i++) nodes.push(node(CanonicalType.REQUIREMENT, `the room must satisfy rule ${i}`, ['room']));
    for (let i = 0; i < 80; i++) nodes.push(node(CanonicalType.REQUIREMENT, `the avatar must satisfy rule ${i}`, ['avatar']));

    const calls: string[] = [];
    const llm: LLMProvider = {
      name: 'fake', model: 't',
      generate: async (prompt: string) => {
        calls.push(prompt);
        if (prompt.includes('Name the domain modules')) return '["room", "avatar"]';
        // Assignment batch: numbers are global — route by statement content.
        const nums = [...prompt.matchAll(/^(\d+)\. \[\w+\] the (\w+)/gm)];
        const room = nums.filter(m => m[2] === 'room').map(m => +m[1]);
        const avatar = nums.filter(m => m[2] === 'avatar').map(m => +m[1]);
        return JSON.stringify({ room, avatar });
      },
    };
    const clusters = await clusterCanonNodesLLM(nodes, llm);
    expect(calls.length).toBeGreaterThanOrEqual(3); // 1 discovery + ≥2 assignment batches
    const total = clusters.reduce((s, c) => s + c.nodes.length, 0);
    expect(total).toBe(160);                        // nothing lost
    // Every cluster anchors on a real module (or a bounded split of one).
    for (const c of clusters) expect(/^(room|avatar)/.test(c.anchor)).toBe(true);
    // Oversized groups were split to a bounded grain.
    for (const c of clusters) expect(c.nodes.length).toBeLessThanOrEqual(24);
  });
});
