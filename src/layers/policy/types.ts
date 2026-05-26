/**
 * Policy Layer types.
 *
 * Evaluates whether a single IU has sufficient evidence. Per-IU so that
 * additional impls (custom security gates, domain-specific compliance checks)
 * can refine the verdict by combining with the prior evaluation.
 */

import type { ImplementationUnit } from '../../models/iu.js';
import type { EvidenceRecord, PolicyEvaluation } from '../../models/evidence.js';
import type { Layer } from '../types.js';

export interface PolicyInput {
  iu: ImplementationUnit;
  evidence: EvidenceRecord[];
}

export type PolicyOutput = PolicyEvaluation;

export type PolicyLayer = Layer<PolicyInput, PolicyOutput>;
