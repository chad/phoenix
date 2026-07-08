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
import type { ResolvedTarget } from './models/architecture.js';
import { sha256 } from './semhash.js';

/** Deterministic, rule-clustered planning (no LLM). */
export function planIUs(canonNodes: CanonicalNode[], clauses?: Clause[], target?: ResolvedTarget | null): ImplementationUnit[] {
  void clauses; // source anchoring stays on the nodes as provenance; not used for grouping
  if (canonNodes.filter(n => n.type !== CanonicalType.CONTEXT).length === 0) return [];
  return buildIUsFromClusters(clusterCanonNodes(canonNodes), target);
}

/** Semantic planning — LLM domain clustering when a provider is given; rule fallback. */
export async function planIUsAuto(
  canonNodes: CanonicalNode[],
  clauses?: Clause[],
  llm?: LLMProvider | null,
  target?: ResolvedTarget | null,
): Promise<ImplementationUnit[]> {
  void clauses;
  if (canonNodes.filter(n => n.type !== CanonicalType.CONTEXT).length === 0) return [];
  const clusters = llm ? await clusterCanonNodesLLM(canonNodes, llm) : clusterCanonNodes(canonNodes);
  return buildIUsFromClusters(clusters, target);
}

export function buildIUsFromClusters(clusters: CanonCluster[], target?: ResolvedTarget | null): ImplementationUnit[] {
  const ius: ImplementationUnit[] = [];
  const usedPaths = new Set<string>();
  const pathFor = (slug: string): string =>
    target?.runtime.outputPathFor(slug) ?? `src/generated/${slug}/${slug}.ts`;
  for (const cluster of clusters) {
    const nodes = cluster.nodes;
    if (nodes.length === 0) continue;

    const name = cleanName(cluster.anchor.replace(/-/g, ' '));
    const baseSlug = slugify(cluster.anchor);
    // Distinct clusters whose anchors slugify identically (or to empty) must NOT share
    // an output file — disambiguate with a stable numeric suffix.
    let serviceName = baseSlug;
    let outputPath = pathFor(serviceName);
    for (let n = 2; usedPaths.has(outputPath); n++) {
      serviceName = `${baseSlug}-${n}`;
      outputPath = pathFor(serviceName);
    }
    usedPaths.add(outputPath);
    const riskTier = deriveRiskTier(nodes);
    const canonIds = nodes.map(n => n.canon_id);

    // Build a readable description from the requirements (not a wall of text)
    const requirements = nodes.filter(n => n.type === 'REQUIREMENT').slice(0, 5);
    const constraints = nodes.filter(n => n.type === 'CONSTRAINT' || n.type === 'INVARIANT');
    const description = requirements.map(n => n.statement).join('. ');

    // Sort a COPY for the order-independent hash; keep canonIds (source_canon_ids) in
    // original node/document order so provenance ordering is preserved.
    const iuId = sha256(['iu', serviceName, name, ...[...canonIds].sort()].join('\x00'));

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
      evidence_policy: evidencePolicyForTier(riskTier),
      output_files: [outputPath],
    });
  }

  // Sort for deterministic output — codepoint order is locale/ICU-independent and
  // portable across Node builds (full-icu vs small/no-icu); localeCompare is not.
  ius.sort((a, b) => (a.output_files[0] < b.output_files[0] ? -1 : a.output_files[0] > b.output_files[0] ? 1 : 0));

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
  if (/\b(?:notification|message)\b/i.test(allStatements)) inputs.push('notification');
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

/**
 * Risk-tiered evidence policy per PRD §10:
 *   low      → typecheck, lint, boundary validation
 *   medium   → + unit tests
 *   high     → + property tests, threat note, static analysis
 *   critical → + human signoff OR formal/simulation evidence (a one_of group)
 */
export function evidencePolicyForTier(tier: string): { required: string[]; one_of?: string[][] } {
  switch (tier) {
    case 'low':
      return { required: ['typecheck', 'lint', 'boundary_validation'] };
    case 'medium':
      return { required: ['typecheck', 'lint', 'boundary_validation', 'unit_tests'] };
    case 'high':
      return { required: ['typecheck', 'lint', 'boundary_validation', 'unit_tests', 'property_tests', 'threat_note', 'static_analysis'] };
    case 'critical':
      return {
        required: ['typecheck', 'lint', 'boundary_validation', 'unit_tests', 'property_tests', 'threat_note', 'static_analysis'],
        one_of: [['human_signoff', 'formal_verification', 'simulation']],
      };
    default:
      return { required: ['typecheck'] };
  }
}

/** Back-compat: the flat required list (used where one_of isn't modeled). */
export function evidenceForTier(tier: string): string[] {
  return evidencePolicyForTier(tier).required;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'module'; // never empty (mirrors iu-clusterer.slugAnchor)
}
