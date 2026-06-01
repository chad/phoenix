import { describe, it, expect } from 'vitest';
import { normalizeText } from '../../src/normalizer.js';

describe('adversarial: normalizer', () => {
  it('#26 a decimal/version at line start is not eaten as a list marker', () => {
    expect(normalizeText('3.14 is pi')).toBe('3.14 is pi');
    expect(normalizeText('1.2.3 release notes')).toBe('1.2.3 release notes');
  });

  it('#50 a leading minus / negative number is not stripped as a bullet', () => {
    expect(normalizeText('-5 degrees and falling')).toBe('-5 degrees and falling');
  });

  it('#27 arithmetic/glob asterisks survive (only real emphasis stripped)', () => {
    expect(normalizeText('rate is 3 * 4 * 5 units')).toBe('rate is 3 * 4 * 5 units');
    expect(normalizeText('match **all** files')).toBe('match all files'); // real emphasis still stripped
  });

  it('#28 snake_case identifiers and dunders survive', () => {
    expect(normalizeText('set user_id and order_id fields')).toBe('set user_id and order_id fields');
    expect(normalizeText('call __init__ method')).toBe('call __init__ method');
  });

  it('#62 markdown image syntax does not leave a stray "!"', () => {
    expect(normalizeText('![diagram](img.png) shows it')).toBe('diagram shows it');
  });

  it('#52 NFC and NFD canonically-equivalent text normalize identically', () => {
    expect(normalizeText('café')).toBe(normalizeText('café'));
  });

  it('#29 normalizeText is idempotent on a list with an empty bullet', () => {
    const x = '- \n- apple\n- banana';
    expect(normalizeText(normalizeText(x))).toBe(normalizeText(x));
  });

  it('#51 a bare "next"/"after" in a bullet does not suppress unordered sorting', () => {
    const a = normalizeText('- zebra task\n- apple task\n- next quarter goals');
    const b = normalizeText('- apple task\n- next quarter goals\n- zebra task');
    expect(a).toBe(b); // order-independent → same hash
  });
});
