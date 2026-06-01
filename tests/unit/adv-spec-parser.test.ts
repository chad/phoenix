import { describe, it, expect } from 'vitest';
import { extractSections } from '../../src/spec-parser.js';

const split = (s: string): string[] => s.split('\n');

describe('adversarial: spec-parser extractSections', () => {
  it('#16 a #-line inside a fenced code block is not parsed as a heading', () => {
    const secs = extractSections(split('# Real\nbody\n```\n# NotAHeading\ncode\n```\nmore'));
    const headings = secs.map(s => s.heading);
    expect(headings).toContain('Real');
    expect(headings).not.toContain('NotAHeading');
  });

  it('#32 a hash with only whitespace is not a heading (no empty section_path entry)', () => {
    const secs = extractSections(split('#    \nbody'));
    expect(secs).toEqual([]); // no real heading
  });

  it('#31 the last section range does not count the trailing-newline empty line', () => {
    const secs = extractSections(split('intro\n# H1\nbody\n')); // ['intro','# H1','body','']
    const last = secs[secs.length - 1];
    expect(last.heading).toBe('H1');
    expect(last.endLine).toBe(3); // 'body' is line 3, not the empty line 4
  });

  it('#40 preamble rawText is consistent with its line range', () => {
    const secs = extractSections(split('\n\nintro\n# H1\nbody')); // preamble lines 1-3
    const preamble = secs.find(s => s.heading === '(preamble)')!;
    expect(preamble.rawText.split('\n').length).toBe(preamble.endLine - preamble.startLine + 1);
  });
});
