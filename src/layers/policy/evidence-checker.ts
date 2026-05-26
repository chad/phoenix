/**
 * Default policy impl: checks the IU's required evidence against the records
 * it has collected. Returns PASS / INCOMPLETE / FAIL based on satisfied,
 * missing, and failed evidence kinds.
 */

import { evaluatePolicy } from '../../policy-engine.js';
import type { PolicyLayer } from './types.js';

export const evidenceChecker: PolicyLayer = {
  name: 'evidence-checker',
  description: 'Evaluates IU evidence records against the required-evidence list.',
  async run(input) {
    return evaluatePolicy(input.iu, input.evidence);
  },
};
