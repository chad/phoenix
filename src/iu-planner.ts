/**
 * IU Planner — maps the canonical graph to Implementation Unit proposals.
 *
 * IUs emerge from DOMAIN clustering (see iu-clusterer), not document structure:
 * each IU is a domain entity (or a UI/report capability) plus its constraints and
 * operations. The source location survives only as provenance on each node.
 *   - planIUs:      deterministic, rule-clustered (no LLM).
 *   - planIUsAuto:  semantic LLM clustering when a provider is available, rule fallback.
 * CONTEXT nodes are excluded from IU generation (they don't produce code).
 */

import type { CanonicalNode } from './models/canonical.js';
import { CanonicalType } from './models/canonical.js';
import type { Clause } from './models/clause.js';
import type { ImplementationUnit } from './models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from './models/iu.js';
import type { CanonCluster } from './iu-clusterer.js';
import { clusterCanonNodes, clusterCanonNodesLLM } from './iu-clusterer.js';
import type { LLMProvider } from './llm/provider.js';
import { sha256 } from './semhash.js';

/** Deterministic, rule-clustered planning (no LLM). */
export function planIUs(canonNodes: CanonicalNode[], clauses?: Clause[]): ImplementationUnit[] {
  void clauses; // source anchoring stays on the nodes as provenance; not used for grouping
  if (canonNodes.filter(n => n.type !== CanonicalType.CONTEXT).length === 0) return [];
  return buildIUsFromClusters(clusterCanonNodes(canonNodes));
}

/** Semantic planning — LLM domain clustering when a provider is given; rule fallback. */
export async function planIUsAuto(
  canonNodes: CanonicalNode[],
  clauses?: Clause[],
  llm?: LLMProvider | null,
): Promise<ImplementationUnit[]> {
  void clauses;
  if (canonNodes.filter(n => n.type !== CanonicalType.CONTEXT).length === 0) return [];
  const clusters = llm ? await clusterCanonNodesLLM(canonNodes, llm) : clusterCanonNodes(canonNodes);
  return buildIUsFromClusters(clusters);
}

function buildIUsFromClusters(clusters: CanonCluster[]): ImplementationUnit[] {
  const ius: ImplementationUnit[] = [];
  for (const cluster of clusters) {
    const nodes = cluster.nodes;
    if (nodes.length === 0) continue;

    const name = cleanName(cluster.anchor.replace(/-/g, ' '));
    const serviceName = slugify(cluster.anchor);
    const fileName = serviceName;
    const riskTier = deriveRiskTier(nodes);
    const canonIds = nodes.map(n => n.canon_id);

    // Build a readable description from the requirements (not a wall of text)
    const requirements = nodes.filter(n => n.type === 'REQUIREMENT').slice(0, 5);
    const constraints = nodes.filter(n => n.type === 'CONSTRAINT' || n.type === 'INVARIANT');
    const description = requirements.map(n => n.statement).join('. ');

    const iuId = sha256(['iu', serviceName, name, ...canonIds.sort()].join('\x00'));

    // Derive typed inputs/outputs from node statements
    const { inputs, outputs } = deriveContract(nodes, name);

    ius.push({
      iu_id: iuId,
      kind: 'module' as const,
      name,
      risk_tier: riskTier,
      contract: {
        description,
        inputs,
        outputs,
        invariants: constraints.map(n => n.statement),
      },
      source_canon_ids: canonIds,
      dependencies: [],
      boundary_policy: defaultBoundaryPolicy(),
      enforcement: defaultEnforcement(),
      evidence_policy: {
        required: evidenceForTier(riskTier),
      },
      output_files: [`src/generated/${serviceName}/${fileName}.ts`],
    });
  }

  // Sort for deterministic output
  ius.sort((a, b) => a.output_files[0].localeCompare(b.output_files[0]));

  return ius;
}

/**
 * Derive a service name from a document ID.
 * "spec/api-gateway.md" → "api-gateway"
 * "spec/deep/user-service.md" → "user-service"
 * "test.md" → "test"
 */
function deriveServiceName(docId: string): string {
  const base = docId.split('/').pop() || docId;
  return slugify(base.replace(/\.md$/i, ''));
}

/**
 * A refinement section refines an entity defined elsewhere in the same document
 * (validation, rules, workflow, constraints, limits, policies) rather than
 * introducing its own resource, so it should fold into the entity's IU instead of
 * becoming a peer module that re-creates the table.
 */
function isRefinementSection(sectionName: string): boolean {
  return /\b(validation|rule|rules|constraint|constraints|workflow|invariant|invariants|limit|limits|policy|policies)\b/i.test(sectionName);
}

/**
 * Clean up a section name to be a natural IU name.
 * "Security Constraints" → "Security Constraints"
 * "3.2 Authentication" → "Authentication"
 */
function cleanName(raw: string): string {
  return raw
    .replace(/^\d+(\.\d+)*\s*/, '')   // strip leading numbers
    .replace(/\s+/g, ' ')
    .trim() || 'Main';
}

/**
 * Derive typed contract inputs/outputs from canonical nodes.
 */
function deriveContract(
  nodes: CanonicalNode[],
  sectionName: string,
): { inputs: string[]; outputs: string[] } {
  const inputs: string[] = [];
  const outputs: string[] = [];

  // Look for common patterns in statements
  const allStatements = nodes.map(n => n.statement).join(' ');

  if (/\brequest\b/i.test(allStatements)) inputs.push('request');
  if (/\buser\b/i.test(allStatements) && /\b(?:create|account|authenticate)\b/i.test(allStatements)) inputs.push('user');
  if (/\btoken\b/i.test(allStatements)) inputs.push('token');
  if (/\btemplate\b/i.test(allStatements)) inputs.push('template');
  if (/\bnotification|message\b/i.test(allStatements)) inputs.push('notification');
  if (/\bconfig\b/i.test(allStatements)) inputs.push('config');

  if (/\bresponse\b/i.test(allStatements)) outputs.push('response');
  if (/\bresult\b/i.test(allStatements)) outputs.push('result');
  if (/\bevent\b/i.test(allStatements)) outputs.push('event');

  return { inputs, outputs };
}

function deriveRiskTier(nodes: CanonicalNode[]): 'low' | 'medium' | 'high' | 'critical' {
  const hasConstraint = nodes.some(n => n.type === 'CONSTRAINT');
  const hasInvariant = nodes.some(n => n.type === 'INVARIANT');
  const size = nodes.length;

  if (hasInvariant) return 'high';
  if (hasConstraint && size > 2) return 'high';
  if (hasConstraint) return 'medium';
  if (size > 3) return 'medium';
  return 'low';
}

function evidenceForTier(tier: string): string[] {
  switch (tier) {
    case 'low': return ['typecheck', 'lint', 'boundary_validation'];
    case 'medium': return ['typecheck', 'lint', 'boundary_validation', 'unit_tests'];
    case 'high': return ['typecheck', 'lint', 'boundary_validation', 'unit_tests', 'property_tests', 'static_analysis'];
    case 'critical': return ['typecheck', 'lint', 'boundary_validation', 'unit_tests', 'property_tests', 'static_analysis', 'human_signoff'];
    default: return ['typecheck'];
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
