/**
 * IU Planner layer registry.
 *
 * Default stack: `["section-based"]`. Append refiners (e.g. risk-uplift,
 * boundary-tightener) to enhance the baseline plan without replacing it.
 */

import { LayerRegistry } from '../types.js';
import type { IUPlannerInput, IUPlannerOutput } from './types.js';
import { sectionBasedPlanner } from './section-based.js';

export const iuPlannerRegistry = new LayerRegistry<IUPlannerInput, IUPlannerOutput>('iu-planner');

iuPlannerRegistry.register(sectionBasedPlanner);

export const DEFAULT_IU_PLANNER_STACK = ['section-based'];

export type { IUPlannerInput, IUPlannerOutput, IUPlannerLayer } from './types.js';
export { sectionBasedPlanner };
