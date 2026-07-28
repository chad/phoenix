/**
 * Spec adaptation — the LLM drafts, the human adopts.
 *
 * The machinery under test is the trust surface, not the prose: section splitting with
 * stable global line numbers, provenance parsing (tight spans, proposed markers,
 * hallucinated references reported never trusted), and the coverage report that names
 * both failure modes — dropped intent and invented intent. The LLM itself is a stub;
 * what we pin is that whatever it returns is receipted honestly.
 */

import { describe, it, expect } from 'vitest';
import {
  lintRule,
  splitSpecSections,
  parseAdaptedSection,
  computeAdaptCoverage,
  adaptSpec,
} from '../../src/spec-adapt.js';
import type { LLMProvider } from '../../src/llm/provider.js';

class StubProvider implements LLMProvider {
  readonly name = 'stub';
  readonly model = 'stub-1';
  constructor(private handler: (prompt: string, system?: string) => string) {}
  async generate(prompt: string, options?: { system?: string }): Promise<string> {
    return this.handler(prompt, options?.system);
  }
}

describe('splitSpecSections', () => {
  it('splits on top-level headings with global 1-based line numbers and keeps the preamble', () => {
    const src = ['title line', 'intro', '# One', 'a', 'b', '# Two', 'c'].join('\n');
    const sections = splitSpecSections(src);
    expect(sections.map(s => [s.heading, s.startLine, s.lines.length])).toEqual([
      ['(preamble)', 1, 2],
      ['# One', 3, 3],
      ['# Two', 6, 2],
    ]);
  });

  it('does not split on ## subsections', () => {
    const src = ['# One', 'x', '## Sub', 'y'].join('\n');
    const sections = splitSpecSections(src);
    expect(sections).toHaveLength(1);
    expect(sections[0].lines).toHaveLength(4);
  });
});

describe('parseAdaptedSection', () => {
  it('parses rules with tight spans and proposed markers', () => {
    const md = [
      '# Rooms',
      '- The room must have a unique name. <!-- from:L10-L12 -->',
      '- A room may hold at most 500 participants. <!-- from:L14 -->',
      '- The room should log arrivals. <!-- proposed -->',
      '- Cozy. <!-- from:L20 -->',                 // too short after strip → dropped
      'plain prose line, not a rule',
    ].join('\n');
    const { rules, unboundSpans } = parseAdaptedSection(md, 100);
    expect(rules).toHaveLength(3);
    expect(rules[0].fromSpans).toEqual([[10, 12]]);
    expect(rules[0].proposed).toBe(false);
    expect(rules[1].fromSpans).toEqual([[14, 14]]);
    expect(rules[2].proposed).toBe(true);
    expect(unboundSpans).toHaveLength(0);
  });

  it('citation shapes models actually emit: comma lists and bare-second-number spans', () => {
    const md = [
      '- The room must have a name. <!-- from:L10,L14 -->',
      '- A room may hold 500. <!-- from:L20-24 -->',
      '- Names are unique. <!-- from:L30, L31-L33 -->',
    ].join('\n');
    const { rules, unboundSpans } = parseAdaptedSection(md, 100);
    expect(rules.map(r => r.fromSpans)).toEqual([[[10, 10], [14, 14]], [[20, 24]], [[30, 30], [31, 33]]]);
    expect(rules.every(r => !r.proposed)).toBe(true);
    expect(unboundSpans).toHaveLength(0);
  });

  it('bullets with no provenance at all are not rules (a list is not a citation)', () => {
    const { rules } = parseAdaptedSection('- The room must be cozy.\n- Another bare bullet.', 100);
    expect(rules).toHaveLength(0);
  });

  it('spans outside the source are reported as hallucinated, never trusted as coverage', () => {
    const md = '- The room must have a name. <!-- from:L999-L1001 -->\n- Bad order. <!-- from:L20-L10 -->';
    const { rules, unboundSpans } = parseAdaptedSection(md, 100);
    expect(rules).toHaveLength(2);
    expect(rules.every(r => r.fromSpans.length === 0)).toBe(true);
    expect(rules.every(r => r.proposed)).toBe(true); // no valid span ⇒ treated as invented
    expect(unboundSpans).toEqual([[999, 1001], [20, 10]]);
  });
});

describe('computeAdaptCoverage', () => {
  const source = [
    '# Rooms',                                                     // L1
    'A room must have a unique name.',                             // L2  normative
    'The vibe should feel cozy and warm.',                         // L3  normative
    '- Read-only participant.',                                    // L4  normative (list fragment)
    'This is plain description with no cue.',                      // L5
  ].join('\n');

  it('markdown headings never count as normatives ("## 8.1 Requirement" is structure)', () => {
    const src = '## 8.1 Requirement\nA room must have a name.';
    const c = computeAdaptCoverage(src, [], []);
    expect(c.sourceNormatives).toEqual([{ line: 2, text: 'A room must have a name.' }]);
  });

  it('an intro line ending in ":" is carried by its list block\'s citations', () => {
    const src = [
      '# Users',
      'A user must be able to:',        // L2 — normative intro, never cited directly
      '',
      '- create a room',                // L4 — cited by a rule
      '- send a message',               // L5
      'Plain paragraph ends the block.',
    ].join('\n');
    const rules = [{ text: 'The user must be able to create a room.', fromSpans: [[4, 4]] as Array<[number, number]>, proposed: false, section: 'Users' }];
    const c = computeAdaptCoverage(src, rules, []);
    expect(c.covered).toBe(1);
    expect(c.dropped).toHaveLength(0);
  });

  it('a normative cited only by a Vision line lands in vision, not covered, not dropped', () => {
    const rules = [{ text: 'The vibe is cozy and warm.', fromSpans: [[3, 3]] as Array<[number, number]>, proposed: false, section: 'Vision (unverified context)' }];
    const c = computeAdaptCoverage(source, rules, []);
    expect(c.covered).toBe(0);
    expect(c.vision).toEqual([{ line: 3, text: 'The vibe should feel cozy and warm.' }]);
    expect(c.dropped).toHaveLength(2);
  });

  it('names covered, dropped, and proposed in the open', () => {
    const rules = [
      { text: 'The room must have a unique name.', fromSpans: [[2, 2]] as Array<[number, number]>, proposed: false, section: 'Rooms' },
      { text: 'A participant may be read-only.', fromSpans: [[4, 4]] as Array<[number, number]>, proposed: false, section: 'Rooms' },
      { text: 'The system must log every arrival.', fromSpans: [] as Array<[number, number]>, proposed: true, section: 'Rooms' },
    ];
    const c = computeAdaptCoverage(source, rules, []);
    expect(c.sourceNormatives).toHaveLength(3);
    expect(c.covered).toBe(2);
    expect(c.dropped).toEqual([{ line: 3, text: 'The vibe should feel cozy and warm.' }]);
    expect(c.proposedRules).toEqual(['The system must log every arrival.']);
  });

  it('a normative covered only by a hallucinated span is dropped (honestly)', () => {
    const c = computeAdaptCoverage(source, [], [[999, 1000]]);
    expect(c.covered).toBe(0);
    expect(c.dropped).toHaveLength(3);
    expect(c.unboundSpans).toEqual([[999, 1000]]);
  });
});

describe('adaptSpec (stub LLM — the trust surface, not the prose)', () => {
  it('assembles a draft with a receipt header, provenance, and a coverage report', async () => {
    const source = [
      '# FreeqWorld',                                              // L1
      'A room must have a unique name.',                           // L2
      'The design should evoke a 1992 RPG.',                       // L3
      '# Presence',                                                // L4
      'The server must accept at most 15 updates per second.',     // L5
    ].join('\n');

    const llm = new StubProvider((prompt, system) => {
      if (system?.includes('converting one section') === false) return '# Data model\n- Room: name (string, unique)';
      if (prompt.includes('"# FreeqWorld"')) return [
        '# FreeqWorld',
        '- The room must have a unique name. <!-- from:L2 -->',
        '### Vision (unverified context)',
        'The design evokes a 1992 RPG. <!-- from:L3 -->'.replace(/^/, '- '),
      ].join('\n');
      return '# Presence\n- The server must accept at most 15 position updates per second. <!-- from:L5 -->';
    });

    const result = await adaptSpec('freeqworld.md', source, llm);
    expect(result.derivedMarkdown).toContain('PHOENIX-DERIVED DRAFT');
    expect(result.derivedMarkdown).toContain('from:L2');
    expect(result.coverage.covered).toBe(2);
    // The vision sentence was PRESERVED as context — acknowledged, not lost, not a rule.
    expect(result.coverage.vision).toEqual([{ line: 3, text: 'The design should evoke a 1992 RPG.' }]);
    expect(result.coverage.dropped).toHaveLength(0);
    expect(result.coverage.proposedRules).toHaveLength(0);
    expect(result.rescued).toEqual({ rules: 0, vision: 0 }); // nothing dropped → no rescue calls
    expect(result.model).toBe('stub/stub-1');
  });

  it('the rescue pass gives dropped obligations a second shot and recomputes coverage', async () => {
    const source = [
      '# Channels',                                                  // L1
      'A channel must have a unique name.',                          // L2 — first pass covers
      '| Invite-only channel | Guarded entrance |',                  // L3 — first pass MISSES
    ].join('\n');
    let rescueCalls = 0;
    const llm = new StubProvider((prompt, system) => {
      if (system?.includes('first translation pass missed')) {
        rescueCalls++;
        expect(prompt).toContain('Line 3:');
        return '## Rescued rules\n- The channel with access policy invite-only must require an invitation to enter. <!-- from:L3 -->';
      }
      if (system?.includes('converting one section') === false) return '# Data model\n- Channel: name';
      return '# Channels\n- The channel must have a unique name. <!-- from:L2 -->';
    });
    const result = await adaptSpec('s.md', source, llm);
    expect(rescueCalls).toBe(1);
    expect(result.rescued).toEqual({ rules: 1, vision: 0 });
    expect(result.coverage.covered).toBe(2);
    expect(result.coverage.dropped).toHaveLength(0);
    expect(result.derivedMarkdown).toContain('# Rescued obligations (second pass)');
  });

  it('fence-wrapped model output is stripped before parsing', async () => {
    const llm = new StubProvider((prompt, system) =>
      system?.includes('converting one section') === false
        ? '# Data model\n- Room: name'
        : '```markdown\n# FreeqWorld\n- The room must have a unique name. <!-- from:L2 -->\n```');
    const result = await adaptSpec('s.md', '# FreeqWorld\nA room must have a unique name.', llm);
    expect(result.coverage.covered).toBe(1);
  });
});

describe('lintRule — the patterns a human review rejected once, flagged forever', () => {
  it('flags commentary (no modal verb) — the L1960 class', () => {
    expect(lintRule('No numeric targets or thresholds are given for any launch metric, so these read as categories of interest.'))
      .toMatch(/no modal verb/);
  });

  it('flags double negatives — the L1606 class', () => {
    expect(lintRule('Client must not fail to render a Message when the type is unsupported.'))
      .toMatch(/double negative/);
    expect(lintRule('Client must render an unsupported structured event as a generic event.')).toBeNull();
  });

  it('flags project-planning meta — the L1939 / roadmap-module class', () => {
    expect(lintRule('Each roadmap phase (2–6) must have a unique phase number.')).toMatch(/project-planning/);
    expect(lintRule('The MVP must include public read-only guest access.')).toMatch(/project-planning/);
    expect(lintRule('The room must have a unique name.')).toBeNull();
  });

  it('a metric WITH a system threshold is a real rule, not planning meta', () => {
    expect(lintRule('The server must accept at most 15 position updates per second per participant.')).toBeNull();
  });

  it('adaptSpec surfaces suspects without deleting them (human stays sovereign)', async () => {
    const llm = new StubProvider((prompt, system) => {
      if (system?.includes('converting one section') === false) return '# Data model\n- Room: name';
      return '# Plan\n- Each roadmap phase must have a unique number. <!-- from:L2 -->';
    });
    const result = await adaptSpec('s.md', '# Plan\nEach roadmap phase must have a unique number.', llm);
    expect(result.suspectRules).toHaveLength(1);
    expect(result.suspectRules[0].reason).toMatch(/project-planning/);
    expect(result.rules).toHaveLength(1); // still in the draft — flagged, not deleted
  });
});

describe('integration contracts (MG4) — the product thesis preserved, not dissolved', () => {
  it('captures integration bindings emitted by the section transform', async () => {
    const llm = new StubProvider((prompt, system) => {
      if (system?.includes('converting one section') === false) return '# Data model\n- Room: name';
      return [
        '# World',
        '- A room must have a unique name. <!-- from:L2 -->',
        '### Integration contracts',
        '- The room must subscribe to its channel on the Freeq service so messages appear as bubbles. <!-- integration --> <!-- from:L3 -->',
      ].join('\n');
    });
    const result = await adaptSpec('s.md', '# World\nA room must have a unique name.\nRooms are channels.', llm);
    expect(result.integrationContracts).toHaveLength(1);
    expect(result.integrationContracts[0]).toMatch(/subscribe to its channel/);
    // it is NOT counted as an ordinary rule/proposal
    expect(result.coverage.proposedRules.join(' ')).not.toMatch(/subscribe to its channel/);
  });
});
