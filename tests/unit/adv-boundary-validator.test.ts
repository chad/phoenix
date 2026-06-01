import { describe, it, expect } from 'vitest';
import { matchGlob, detectBoundaryChanges } from '../../src/boundary-validator.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

describe('adversarial: boundary-validator', () => {
  it('#11 regex metacharacters in the glob pattern are literal, not wildcards', () => {
    expect(matchGlob('../internal.ts', '../internal.ts')).toBe(true);
    expect(matchGlob('../internalXts', '../internal.ts')).toBe(false); // '.' is literal
    expect(matchGlob('aaab', 'a+b')).toBe(false);                      // '+' is literal
  });

  it('#11 a malformed pattern never throws (returns false)', () => {
    expect(() => matchGlob('a', '../foo(bar')).not.toThrow();
    expect(matchGlob('a', '../foo(bar')).toBe(false);
  });

  it('#27 a single * does not cross path separators', () => {
    expect(matchGlob('../a', '../*')).toBe(true);
    expect(matchGlob('../a/b', '../*')).toBe(false);  // single segment only
    expect(matchGlob('xx/a', '../*')).toBe(false);    // literal '../' prefix required
    expect(matchGlob('../a/b', '../**')).toBe(true);  // ** crosses separators
  });

  it('#12 detectBoundaryChanges does not mutate the caller policy arrays', () => {
    const mk = (pkgs: string[]): ImplementationUnit => ({
      iu_id: 'I', kind: 'module', name: 'I', risk_tier: 'low',
      contract: { description: '', inputs: [], outputs: [], invariants: [] },
      source_canon_ids: [], dependencies: [],
      boundary_policy: { ...defaultBoundaryPolicy(), code: { ...defaultBoundaryPolicy().code, allowed_packages: pkgs } },
      enforcement: defaultEnforcement(), evidence_policy: { required: [] }, output_files: [],
    });
    const before = mk(['c', 'a', 'b']);
    detectBoundaryChanges(before, mk(['c', 'a', 'b']));
    expect(before.boundary_policy.code.allowed_packages).toEqual(['c', 'a', 'b']); // order preserved
  });
});
