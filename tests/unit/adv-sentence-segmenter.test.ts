import { describe, it, expect } from 'vitest';
import { segmentSentences, splitCompoundModals } from '../../src/sentence-segmenter.js';

const texts = (s: string): string[] => segmentSentences(s).map(x => x.text);

describe('adversarial: sentence-segmenter', () => {
  it('#13 abbreviations (U.S., Mr.) do not trigger false sentence splits', () => {
    const t = 'The applicable regulatory framework here states that the U.S. Government must comply fully now.';
    const out = segmentSentences(t).map(s => s.text);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('U.S. Government');
  });

  it('#14 a decimal at line start is not a list marker', () => {
    expect(texts('1.5 must be supported by the system')).toEqual(['1.5 must be supported by the system']);
  });

  it('#15 a negative number at line start keeps its minus', () => {
    expect(texts('-5 is the minimum value')).toEqual(['-5 is the minimum value']);
  });

  it('#28 a 4-digit year + period is prose, not a list marker', () => {
    expect(texts('2024. was a good year')).toEqual(['2024. was a good year']);
  });

  it('#29 leading markdown emphasis is not a bullet', () => {
    expect(texts('*important* note here')).toEqual(['*important* note here']);
  });

  it('real bullets and numbered items still parse (guard)', () => {
    expect(segmentSentences('- do the thing').some(s => s.fromList)).toBe(true);
    expect(segmentSentences('3. do the thing here').some(s => s.fromList)).toBe(true);
  });

  it('#30 "may not" compound modal splits symmetrically with "must not"', () => {
    expect(splitCompoundModals('Users may not delete records and may not modify logs')).toHaveLength(2);
  });
});
