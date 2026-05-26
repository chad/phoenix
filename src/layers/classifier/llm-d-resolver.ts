/**
 * LLM D-class resolver.
 *
 * Takes prior classifications and escalates only the uncertain (D-class) ones
 * to the LLM, replacing them in-place. Preserves all other classifications
 * verbatim. Falls back to the prior result for any LLM failure.
 */

import { ChangeClass } from '../../models/classification.js';
import type { ChangeClassification } from '../../models/classification.js';
import { resolveDiffWithLLM } from '../../classifier-llm.js';
import type { ClassifierLayer } from './types.js';

export const llmDResolver: ClassifierLayer = {
  name: 'llm-d-resolver',
  description: 'Escalates D-class (uncertain) prior classifications to the LLM.',
  enhancerOnly: true,
  async run(input, prior, ctx) {
    if (!prior) {
      throw new Error('llm-d-resolver requires a prior classifier impl');
    }
    if (!ctx.llm) return prior;

    const diffByPos = input.diffs;
    const resolved: ChangeClassification[] = [];
    for (let i = 0; i < prior.length; i++) {
      const c = prior[i];
      if (c.change_class !== ChangeClass.D) {
        resolved.push(c);
        continue;
      }
      const diff = diffByPos[i];
      if (!diff) {
        resolved.push(c);
        continue;
      }
      try {
        const llmClass = await resolveDiffWithLLM(diff, ctx.llm);
        resolved.push({
          ...c,
          change_class: llmClass,
          confidence: llmClass === ChangeClass.D ? c.confidence : Math.max(c.confidence, 0.75),
          llm_resolved: true,
        });
      } catch {
        resolved.push(c);
      }
    }
    return resolved;
  },
};
