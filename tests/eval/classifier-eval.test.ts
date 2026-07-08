/**
 * Classifier accuracy evaluation against gold-standard change pairs.
 *
 * Establishes the accuracy baseline the A/B/C/D classifier never had. The D-rate
 * trust loop is only meaningful if the classifier is actually accurate; this
 * measures that, and gates it in CI so a regression fails the build.
 */

import { describe, it, expect } from 'vitest';
import { parseSpec } from '../../src/spec-parser.js';
import { diffClauses } from '../../src/diff.js';
import { classifyChange } from '../../src/classifier.js';
import { DiffType } from '../../src/models/clause.js';
import { ChangeClass } from '../../src/models/classification.js';
import { CHANGE_PAIRS, type ChangePair } from './change-pairs.js';

function specFor(pair: ChangePair, text: string): string {
  const heading = pair.section.map((s, i) => `${'#'.repeat(i + 1)} ${s}`).join('\n\n');
  return `# Doc\n\n${heading}\n\n- ${text}\n`;
}

function classifyPair(pair: ChangePair): ChangeClass {
  const before = parseSpec(specFor(pair, pair.before), 'spec/eval.md');
  const after = parseSpec(specFor(pair, pair.after), 'spec/eval.md');
  const diffs = diffClauses(before, after);
  // The changed clause is the MODIFIED/MOVED/ADDED/REMOVED one; if all UNCHANGED,
  // classification is trivially A.
  const changed = diffs.find(d => d.diff_type !== DiffType.UNCHANGED);
  if (!changed) return ChangeClass.A;
  return classifyChange(changed, [], []).change_class;
}

describe('classifier accuracy (gold change pairs)', () => {
  const results = CHANGE_PAIRS.map(pair => {
    const actual = classifyPair(pair);
    const accept = new Set(pair.acceptable ?? [pair.expected]);
    return { pair, actual, correct: accept.has(actual) };
  });

  for (const { pair, actual, correct } of results) {
    it(`${pair.id}: ${pair.before.slice(0, 30)}… → expects ${pair.expected}`, () => {
      const accept = pair.acceptable ?? [pair.expected];
      expect(accept, `got ${actual} for "${pair.note}"`).toContain(actual);
      void correct;
    });
  }

  it('overall accuracy is at least 85% on the gold set', () => {
    const correct = results.filter(r => r.correct).length;
    const accuracy = correct / results.length;
    // Report the number so a regression is visible in the run output.
    console.log(`  Classifier accuracy: ${(accuracy * 100).toFixed(1)}% (${correct}/${results.length})`);
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });

  it('never misclassifies a real semantic change as trivial (A) — the dangerous error', () => {
    // A false "A" means a real requirement change silently skips regeneration.
    // This is the one error the trust surface must never make.
    const dangerous = results.filter(r =>
      r.actual === ChangeClass.A &&
      r.pair.expected !== ChangeClass.A &&
      !(r.pair.acceptable ?? []).includes(ChangeClass.A),
    );
    expect(dangerous.map(d => d.pair.id)).toEqual([]);
  });
});
