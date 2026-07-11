import { describe, it, expect } from 'vitest';
import { runSuite } from '../../src/eval/harness.js';
import type { CapabilityCase } from '../../src/eval/harness.js';

function c(id: string, expect_: 'green' | 'red', passed: boolean, redReason?: string): CapabilityCase {
  return { id, capability: 'test', description: id, expect: expect_, redReason, tier: 'unit', run: () => ({ passed, detail: id }) };
}

describe('eval harness classification (the Red/Green discipline)', () => {
  it('green + pass = green; green + fail = REGRESSION', async () => {
    const sc = await runSuite([c('a', 'green', true), c('b', 'green', false)]);
    expect(sc.results.find(r => r.case.id === 'a')!.classification).toBe('green');
    expect(sc.results.find(r => r.case.id === 'b')!.classification).toBe('regression');
    expect(sc.regressions).toHaveLength(1);
    expect(sc.greenHealth).toBe(0.5);
  });

  it('red + fail = known-red; red + pass = PROMOTION', async () => {
    const sc = await runSuite([c('x', 'red', false, 'broken'), c('y', 'red', true, 'was broken')]);
    expect(sc.results.find(r => r.case.id === 'x')!.classification).toBe('known-red');
    expect(sc.results.find(r => r.case.id === 'y')!.classification).toBe('promotion');
    expect(sc.promotions).toHaveLength(1);
    // Reds don't count against green-health.
    expect(sc.greenHealth).toBe(1);
  });

  it('a thrown case is a failure, never a crash', async () => {
    const boom: CapabilityCase = { id: 'boom', capability: 't', description: '', expect: 'green', tier: 'unit', run: () => { throw new Error('kaboom'); } };
    const sc = await runSuite([boom]);
    expect(sc.regressions).toHaveLength(1);
    expect(sc.results[0].detail).toMatch(/kaboom/);
  });

  it('a red without a reason is rejected (the backlog must explain itself)', async () => {
    await expect(runSuite([c('nored', 'red', false)])).rejects.toThrow(/redReason/);
  });

  it('totals stay internally consistent', async () => {
    const sc = await runSuite([c('a', 'green', true), c('b', 'green', false), c('x', 'red', false, 'r'), c('y', 'red', true, 'r')]);
    expect(sc.green + sc.knownRed + sc.regressions.length + sc.promotions.length).toBe(sc.total);
  });
});
