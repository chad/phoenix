/**
 * IU Planner Layer types.
 *
 * Plans Implementation Units from a canonical graph. Additive impls can split
 * oversized IUs, merge tightly-coupled ones, tighten boundary policy, or
 * refine risk tiers based on signals the baseline planner doesn't see.
 */

import type { CanonicalNode } from '../../models/canonical.js';
import type { Clause } from '../../models/clause.js';
import type { ImplementationUnit } from '../../models/iu.js';
import type { Layer } from '../types.js';

export interface IUPlannerInput {
  canonNodes: CanonicalNode[];
  clauses: Clause[];
}

export type IUPlannerOutput = ImplementationUnit[];

export type IUPlannerLayer = Layer<IUPlannerInput, IUPlannerOutput>;
