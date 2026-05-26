/**
 * Section-based IU planner — the baseline impl.
 *
 * Groups canonical nodes by source document and top-level section, producing
 * one IU per section with derived contracts, risk tiers, and evidence policy.
 */

import { planIUs } from '../../iu-planner.js';
import type { IUPlannerLayer } from './types.js';

export const sectionBasedPlanner: IUPlannerLayer = {
  name: 'section-based',
  description: 'Groups canonical nodes into module-level IUs by source section.',
  async run(input) {
    return planIUs(input.canonNodes, input.clauses);
  },
};
