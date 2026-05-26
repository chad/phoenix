/**
 * Classifier Layer types.
 *
 * Classifies clause diffs into A/B/C/D change classes. Additive impls let
 * later stages refine specific subsets (e.g. an LLM that re-classifies only
 * D-class outputs from the rule-based baseline).
 */

import type { ClauseDiff } from '../../models/clause.js';
import type { CanonicalNode } from '../../models/canonical.js';
import type { ChangeClassification } from '../../models/classification.js';
import type { Layer } from '../types.js';

export interface ClassifierInput {
  diffs: ClauseDiff[];
  canonBefore: CanonicalNode[];
  canonAfter: CanonicalNode[];
  warmBefore?: Map<string, string>;
  warmAfter?: Map<string, string>;
}

export type ClassifierOutput = ChangeClassification[];

export type ClassifierLayer = Layer<ClassifierInput, ClassifierOutput>;
