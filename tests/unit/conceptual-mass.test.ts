import { describe, it, expect } from 'vitest';
import {
  computeConceptualMass,
  interactionPotential,
  checkRatchet,
  MASS_THRESHOLDS,
} from '../../src/models/conceptual-mass.js';

describe('Conceptual Mass', () => {
  it('computes mass as sum of concept counts', () => {
    const mass = computeConceptualMass({
      contract_inputs: 2,
      contract_outputs: 1,
      contract_invariants: 1,
      dependency_count: 2,
      side_channel_count: 1,
      canon_node_count: 3,
      file_count: 2,
    });
    // 2+1+1 (contract) + 2 (deps) + 1 (side) + 3 (canon) = 10
    expect(mass).toBe(10);
  });

  it('computes interaction potential as n*(n-1)/2', () => {
    expect(interactionPotential(0)).toBe(0);
    expect(interactionPotential(1)).toBe(0);
    expect(interactionPotential(2)).toBe(1);
    expect(interactionPotential(5)).toBe(10);
    expect(interactionPotential(10)).toBe(45);
  });

  it('detects ratchet violation when mass grows', () => {
    expect(checkRatchet(10, 8)).toBe(true);
    expect(checkRatchet(10, 10)).toBe(false);
    expect(checkRatchet(8, 10)).toBe(false);
  });

  it('no violation when no previous data', () => {
    expect(checkRatchet(10, undefined)).toBe(false);
  });

  it('has sensible thresholds', () => {
    expect(MASS_THRESHOLDS.healthy).toBe(7);
    expect(MASS_THRESHOLDS.warning).toBe(12);
    expect(MASS_THRESHOLDS.danger).toBe(20);
  });
});
