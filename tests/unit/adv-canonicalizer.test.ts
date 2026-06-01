import { describe, it, expect } from 'vitest';
import { scoreSentence } from '../../src/canonicalizer.js';
import { CanonicalType } from '../../src/models/canonical.js';

describe('adversarial: canonicalizer', () => {
  it('#38 a curly-apostrophe "can’t" gets the same CONSTRAINT credit as a straight one', () => {
    const straight = scoreSentence("Users can't delete the record");
    const curly = scoreSentence('Users can’t delete the record'); // U+2019
    expect(curly.type).toBe(CanonicalType.CONSTRAINT);
    expect(curly.type).toBe(straight.type);
  });
});
