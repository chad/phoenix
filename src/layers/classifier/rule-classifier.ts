/**
 * Rule-based classifier — deterministic baseline using the existing scoring
 * signals (norm diff, semhash delta, term Jaccard, canon impact, etc.).
 */

import { classifyChanges } from '../../classifier.js';
import type { ClassifierLayer } from './types.js';

export const ruleClassifier: ClassifierLayer = {
  name: 'rule-classifier',
  description: 'Deterministic A/B/C/D classification using diff and semantic signals.',
  async run(input) {
    return classifyChanges(
      input.diffs,
      input.canonBefore,
      input.canonAfter,
      input.warmBefore,
      input.warmAfter,
    );
  },
};
