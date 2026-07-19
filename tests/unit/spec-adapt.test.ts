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
    expect(result.coverage.dropped).toHaveLength(1);
    expect(result.coverage.dropped[0].line).toBe(3); // the vision sentence became context, not a rule
    expect(result.coverage.proposedRules).toHaveLength(0);
    expect(result.model).toBe('stub/stub-1');
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
