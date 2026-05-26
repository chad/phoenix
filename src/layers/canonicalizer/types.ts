/**
 * Canonicalizer Layer types.
 *
 * Input is the set of clauses to extract from. Output bundles both the
 * intermediate candidates (so enhancers can rewrite/reclassify before
 * resolution) and the resolved canonical graph. Enhancer impls typically
 * mutate `candidates` and re-run resolution; pure extractor impls produce
 * both fields from scratch.
 */

import type { Clause } from '../../models/clause.js';
import type { CandidateNode, CanonicalNode } from '../../models/canonical.js';
import type { Layer } from '../types.js';

export interface CanonicalizerInput {
  clauses: Clause[];
}

export interface CanonicalizerOutput {
  candidates: CandidateNode[];
  nodes: CanonicalNode[];
}

export type CanonicalizerLayer = Layer<CanonicalizerInput, CanonicalizerOutput>;
