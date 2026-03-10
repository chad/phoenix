/**
 * Replacement Audit — the diagnostic from Chapter 4 of The Phoenix Architecture.
 *
 * "Pick a component and ask: could I replace this implementation entirely
 *  and have its dependents not notice?"
 *
 * Assesses each IU on:
 *   1. Boundary clarity — are contracts explicit and complete?
 *   2. Evaluation coverage — can a replacement be verified?
 *   3. Blast radius — how many dependents break if replacement goes wrong?
 *   4. Deletion safety — can it be removed without uncontrolled failure?
 *   5. Pace layer appropriateness — is regeneration cadence correct?
 *   6. Conceptual mass — is cognitive burden within budget?
 *   7. Negative knowledge — are past failures consulted?
 */

import type { ImplementationUnit } from './models/iu.js';
import type { EvaluationCoverage } from './models/evaluation.js';
import type { ConceptualMassReport } from './models/conceptual-mass.js';
import type { PaceLayerMetadata } from './models/pace-layer.js';
import type { NegativeKnowledge } from './models/negative-knowledge.js';
import {
  computeConceptualMass,
  interactionPotential,
  checkRatchet,
  MASS_THRESHOLDS,
} from './models/conceptual-mass.js';

/**
 * Readiness gradient — from The Phoenix Architecture Chapter 21.
 *
 * opaque       → behavior unknown, deeply coupled
 * observable   → behavior documented, boundaries traced
 * evaluable    → evaluations capture real behavior
 * regenerable  → safe to delete and replace
 */
export type ReadinessLevel = 'opaque' | 'observable' | 'evaluable' | 'regenerable';

export interface AuditResult {
  iu_id: string;
  iu_name: string;
  readiness: ReadinessLevel;
  score: number; // 0-100
  boundary_clarity: AuditDimension;
  evaluation_coverage: AuditDimension;
  blast_radius: AuditDimension;
  deletion_safety: AuditDimension;
  pace_layer: AuditDimension;
  conceptual_mass: AuditDimension;
  negative_knowledge: AuditDimension;
  blockers: AuditBlocker[];
  recommendations: string[];
}

export interface AuditDimension {
  name: string;
  score: number; // 0-100
  status: 'good' | 'warning' | 'critical';
  detail: string;
}

export interface AuditBlocker {
  category: 'boundary' | 'evaluation' | 'coupling' | 'mass' | 'pace' | 'negative_knowledge';
  severity: 'error' | 'warning';
  message: string;
  recommended_action: string;
}

export interface AuditInput {
  iu: ImplementationUnit;
  allIUs: ImplementationUnit[];
  evalCoverage: EvaluationCoverage;
  paceLayer?: PaceLayerMetadata;
  negativeKnowledge: NegativeKnowledge[];
  previousMass?: number;
}

/**
 * Run the replacement audit on a single IU.
 */
export function auditIU(input: AuditInput): AuditResult {
  const { iu, allIUs, evalCoverage, paceLayer, negativeKnowledge, previousMass } = input;
  const blockers: AuditBlocker[] = [];
  const recommendations: string[] = [];

  // 1. Boundary clarity
  const boundaryClarity = assessBoundaryClarity(iu, blockers);

  // 2. Evaluation coverage
  const evalDimension = assessEvaluationCoverage(iu, evalCoverage, blockers);

  // 3. Blast radius
  const blastRadius = assessBlastRadius(iu, allIUs, blockers);

  // 4. Deletion safety (composite of boundary + eval + blast radius)
  const deletionSafety = assessDeletionSafety(boundaryClarity, evalDimension, blastRadius);

  // 5. Pace layer
  const paceDimension = assessPaceLayer(iu, paceLayer, blockers);

  // 6. Conceptual mass
  const massDimension = assessConceptualMass(iu, previousMass, blockers);

  // 7. Negative knowledge
  const nkDimension = assessNegativeKnowledge(iu, negativeKnowledge, blockers, recommendations);

  // Composite score (weighted)
  const score = Math.round(
    boundaryClarity.score * 0.20 +
    evalDimension.score * 0.25 +
    blastRadius.score * 0.15 +
    deletionSafety.score * 0.15 +
    paceDimension.score * 0.10 +
    massDimension.score * 0.10 +
    nkDimension.score * 0.05
  );

  // Readiness level
  const readiness = scoreToReadiness(score, blockers);

  // Generate recommendations
  if (evalCoverage.gaps.length > 0) {
    recommendations.push(`Address ${evalCoverage.gaps.length} evaluation gap(s) before regenerating`);
  }
  if (boundaryClarity.score < 50) {
    recommendations.push('Define explicit boundary contracts before attempting regeneration');
  }
  if (blastRadius.score < 50) {
    recommendations.push('Reduce blast radius by introducing interface boundaries with dependents');
  }

  return {
    iu_id: iu.iu_id,
    iu_name: iu.name,
    readiness,
    score,
    boundary_clarity: boundaryClarity,
    evaluation_coverage: evalDimension,
    blast_radius: blastRadius,
    deletion_safety: deletionSafety,
    pace_layer: paceDimension,
    conceptual_mass: massDimension,
    negative_knowledge: nkDimension,
    blockers,
    recommendations,
  };
}

/**
 * Audit all IUs in the system.
 */
export function auditAll(
  ius: ImplementationUnit[],
  evalCoverages: Map<string, EvaluationCoverage>,
  paceLayers: Map<string, PaceLayerMetadata>,
  negativeKnowledge: NegativeKnowledge[],
  previousMasses: Map<string, number>,
): AuditResult[] {
  return ius.map(iu => auditIU({
    iu,
    allIUs: ius,
    evalCoverage: evalCoverages.get(iu.iu_id) ?? emptyEvalCoverage(iu),
    paceLayer: paceLayers.get(iu.iu_id),
    negativeKnowledge: negativeKnowledge.filter(nk => nk.subject_id === iu.iu_id),
    previousMass: previousMasses.get(iu.iu_id),
  }));
}

// ─── Dimension Assessors ─────────────────────────────────────────────────────

function assessBoundaryClarity(iu: ImplementationUnit, blockers: AuditBlocker[]): AuditDimension {
  let score = 0;
  const bp = iu.boundary_policy;
  const contract = iu.contract;

  // Contract completeness
  if (contract.description.length > 0) score += 15;
  if (contract.inputs.length > 0) score += 20;
  if (contract.outputs.length > 0) score += 20;
  if (contract.invariants.length > 0) score += 15;

  // Boundary policy declared
  const hasAllowedIUs = bp.code.allowed_ius.length > 0;
  const hasForbiddenIUs = bp.code.forbidden_ius.length > 0 || bp.code.forbidden_packages.length > 0;
  if (hasAllowedIUs || hasForbiddenIUs) score += 15;

  // Side channels declared
  const sideChannels = Object.values(bp.side_channels).flat();
  if (sideChannels.length > 0) score += 15;

  if (score < 40) {
    blockers.push({
      category: 'boundary',
      severity: 'error',
      message: `${iu.name} has weak boundary definition (score: ${score}/100)`,
      recommended_action: 'Define explicit inputs, outputs, invariants, and boundary policy',
    });
  }

  return {
    name: 'Boundary Clarity',
    score: Math.min(score, 100),
    status: score >= 70 ? 'good' : score >= 40 ? 'warning' : 'critical',
    detail: `Contract: ${contract.inputs.length} inputs, ${contract.outputs.length} outputs, ${contract.invariants.length} invariants`,
  };
}

function assessEvaluationCoverage(
  iu: ImplementationUnit,
  coverage: EvaluationCoverage,
  blockers: AuditBlocker[],
): AuditDimension {
  let score = Math.round(coverage.coverage_ratio * 60);

  // Bonus for diversity of evaluation bindings
  const bindingCount = Object.values(coverage.by_binding).filter(v => v > 0).length;
  score += bindingCount * 8;

  // Penalty for gaps
  score -= coverage.gaps.length * 5;
  score = Math.max(0, Math.min(100, score));

  if (coverage.total_evaluations === 0) {
    blockers.push({
      category: 'evaluation',
      severity: 'error',
      message: `${iu.name} has no behavioral evaluations`,
      recommended_action: 'Write evaluations at the IU boundary before regenerating',
    });
  } else if (coverage.gaps.length > 2) {
    blockers.push({
      category: 'evaluation',
      severity: 'warning',
      message: `${iu.name} has ${coverage.gaps.length} evaluation gaps`,
      recommended_action: 'Address evaluation gaps to improve regeneration safety',
    });
  }

  return {
    name: 'Evaluation Coverage',
    score,
    status: score >= 70 ? 'good' : score >= 40 ? 'warning' : 'critical',
    detail: `${coverage.total_evaluations} evaluations, ${Math.round(coverage.coverage_ratio * 100)}% canon coverage, ${coverage.gaps.length} gaps`,
  };
}

function assessBlastRadius(
  iu: ImplementationUnit,
  allIUs: ImplementationUnit[],
  blockers: AuditBlocker[],
): AuditDimension {
  // Count how many other IUs depend on this one
  const dependentCount = allIUs.filter(other =>
    other.iu_id !== iu.iu_id && other.dependencies.includes(iu.iu_id)
  ).length;

  // Invert: fewer dependents = higher score
  const maxDeps = Math.max(allIUs.length - 1, 1);
  const score = Math.round((1 - dependentCount / maxDeps) * 100);

  if (dependentCount > 3) {
    blockers.push({
      category: 'coupling',
      severity: 'warning',
      message: `${iu.name} has ${dependentCount} dependents — wide blast radius`,
      recommended_action: 'Consider introducing interface boundaries to reduce coupling',
    });
  }

  return {
    name: 'Blast Radius',
    score,
    status: score >= 70 ? 'good' : score >= 40 ? 'warning' : 'critical',
    detail: `${dependentCount} dependent IU(s)`,
  };
}

function assessDeletionSafety(
  boundary: AuditDimension,
  evaluation: AuditDimension,
  blastRadius: AuditDimension,
): AuditDimension {
  // Deletion safety is the minimum of the three foundations
  const score = Math.min(boundary.score, evaluation.score, blastRadius.score);

  return {
    name: 'Deletion Safety',
    score,
    status: score >= 70 ? 'good' : score >= 40 ? 'warning' : 'critical',
    detail: `Min of boundary (${boundary.score}), eval (${evaluation.score}), blast (${blastRadius.score})`,
  };
}

function assessPaceLayer(
  iu: ImplementationUnit,
  paceLayer: PaceLayerMetadata | undefined,
  blockers: AuditBlocker[],
): AuditDimension {
  if (!paceLayer) {
    blockers.push({
      category: 'pace',
      severity: 'warning',
      message: `${iu.name} has no pace layer classification`,
      recommended_action: 'Classify IU into a pace layer: surface, service, domain, or foundation',
    });
    return {
      name: 'Pace Layer',
      score: 50,
      status: 'warning',
      detail: 'No pace layer classification',
    };
  }

  let score = 70; // Classified is already good
  if (paceLayer.classification_rationale !== 'Default classification — needs review') {
    score += 15; // Reviewed classification
  }
  if (paceLayer.conservation) {
    score += 15; // Conservation is explicitly declared
  }

  return {
    name: 'Pace Layer',
    score: Math.min(score, 100),
    status: score >= 70 ? 'good' : score >= 40 ? 'warning' : 'critical',
    detail: `${paceLayer.pace_layer} layer, ${paceLayer.conservation ? 'conservation' : 'non-conservation'}, weight: ${paceLayer.dependency_weight}`,
  };
}

function assessConceptualMass(
  iu: ImplementationUnit,
  previousMass: number | undefined,
  blockers: AuditBlocker[],
): AuditDimension {
  const sideChannelCount = Object.values(iu.boundary_policy.side_channels).flat().length;

  const mass = computeConceptualMass({
    contract_inputs: iu.contract.inputs.length,
    contract_outputs: iu.contract.outputs.length,
    contract_invariants: iu.contract.invariants.length,
    dependency_count: iu.dependencies.length,
    side_channel_count: sideChannelCount,
    canon_node_count: iu.source_canon_ids.length,
    file_count: iu.output_files.length,
  });

  const ip = interactionPotential(mass);
  const ratchetViolation = checkRatchet(mass, previousMass);

  // Score: lower mass = higher score
  let score = 100;
  if (mass > MASS_THRESHOLDS.danger) score = 20;
  else if (mass > MASS_THRESHOLDS.warning) score = 50;
  else if (mass > MASS_THRESHOLDS.healthy) score = 70;

  if (ratchetViolation) {
    score -= 20;
    blockers.push({
      category: 'mass',
      severity: 'warning',
      message: `${iu.name} conceptual mass grew from ${previousMass} to ${mass} (ratchet violation)`,
      recommended_action: 'Compact: reduce concepts, merge redundant abstractions, or split the IU',
    });
  }

  if (mass > MASS_THRESHOLDS.danger) {
    blockers.push({
      category: 'mass',
      severity: 'error',
      message: `${iu.name} has conceptual mass ${mass} (>${MASS_THRESHOLDS.danger}): exceeds working memory`,
      recommended_action: 'This IU is too complex for one person to reason about safely. Split it.',
    });
  }

  return {
    name: 'Conceptual Mass',
    score: Math.max(0, score),
    status: score >= 70 ? 'good' : score >= 40 ? 'warning' : 'critical',
    detail: `Mass: ${mass}, interactions: ${ip}${ratchetViolation ? ' ⚠ RATCHET VIOLATION' : ''}${previousMass !== undefined ? ` (prev: ${previousMass})` : ''}`,
  };
}

function assessNegativeKnowledge(
  iu: ImplementationUnit,
  nk: NegativeKnowledge[],
  blockers: AuditBlocker[],
  recommendations: string[],
): AuditDimension {
  // Having negative knowledge is good — it means lessons are captured
  const score = nk.length > 0 ? 80 : 60;

  if (nk.length > 0) {
    const constraints = nk.filter(n => n.kind === 'incident_constraint');
    if (constraints.length > 0) {
      recommendations.push(
        `Consult ${constraints.length} incident constraint(s) before regenerating ${iu.name}`
      );
    }
    const failedGens = nk.filter(n => n.kind === 'failed_generation');
    if (failedGens.length > 0) {
      recommendations.push(
        `${failedGens.length} prior generation attempt(s) failed for ${iu.name} — review before retrying`
      );
    }
  }

  return {
    name: 'Negative Knowledge',
    score,
    status: score >= 70 ? 'good' : 'warning',
    detail: nk.length > 0
      ? `${nk.length} record(s): ${nk.map(n => n.kind).join(', ')}`
      : 'No negative knowledge recorded',
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreToReadiness(score: number, blockers: AuditBlocker[]): ReadinessLevel {
  const hasErrors = blockers.some(b => b.severity === 'error');
  if (hasErrors || score < 30) return 'opaque';
  if (score < 50) return 'observable';
  if (score < 75) return 'evaluable';
  return 'regenerable';
}

function emptyEvalCoverage(iu: ImplementationUnit): EvaluationCoverage {
  return {
    iu_id: iu.iu_id,
    iu_name: iu.name,
    total_evaluations: 0,
    by_binding: { domain_rule: 0, boundary_contract: 0, constraint: 0, invariant: 0, failure_mode: 0 },
    by_origin: { specified: 0, characterization: 0, incident: 0, audit: 0 },
    canon_ids_covered: [],
    canon_ids_uncovered: iu.source_canon_ids,
    coverage_ratio: 0,
    conservation_count: 0,
    gaps: [{
      category: 'missing_boundary',
      subject: iu.iu_id,
      message: `No evaluations exist for ${iu.name}`,
      recommended_action: 'Write behavioral evaluations before attempting regeneration',
    }],
  };
}
