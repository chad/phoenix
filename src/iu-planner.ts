/**
 * IU Planner — maps canonical nodes to Implementation Unit proposals.
 *
 * Groups related requirements into module-level IUs based on:
 * - Source document (service boundary)
 * - Source section within a document (module boundary)
 *
 * Naming produces natural developer-facing identifiers:
 *   spec/api-gateway.md, section "Rate Limiting"
 *   → name: "Rate Limiting"
 *   → file: src/generated/api-gateway/rate-limiting.ts
 */

import type { CanonicalNode } from './models/canonical.js';
import { CanonicalType } from './models/canonical.js';
import type { Clause } from './models/clause.js';
import type { ImplementationUnit } from './models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from './models/iu.js';
import { sha256 } from './semhash.js';

/**
 * Plan IUs from canonical nodes, grouping by source document + section.
 *
 * Each top-level section of each spec document becomes one IU.
 * Canon nodes are assigned to the IU of their source clause's section.
 * CONTEXT nodes are excluded from IU generation (they don't produce code).
 */
export function planIUs(
  canonNodes: CanonicalNode[],
  clauses: Clause[],
): ImplementationUnit[] {
  // Filter out CONTEXT nodes — they don't generate code
  canonNodes = canonNodes.filter(n => n.type !== CanonicalType.CONTEXT);
  if (canonNodes.length === 0) return [];

  // Index clauses by ID
  const clauseMap = new Map(clauses.map(c => [c.clause_id, c]));

  // Group canonical nodes by (doc, top-level section)
  const buckets = new Map<string, { nodes: CanonicalNode[]; docId: string; sectionName: string }>();

  for (const node of canonNodes) {
    const clause = node.source_clause_ids
      .map(id => clauseMap.get(id))
      .find(c => c !== undefined);

    if (!clause) continue;

    const docId = clause.source_doc_id;
    // Use the second level of section_path as the grouping key.
    // section_path[0] is typically the doc title, section_path[1] is the first real section.
    // If there's only one level, use that.
    const sectionName = clause.section_path.length > 1
      ? clause.section_path[1]
      : clause.section_path[0] || 'main';

    const key = `${docId}::${sectionName}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { nodes: [], docId, sectionName };
      buckets.set(key, bucket);
    }
    bucket.nodes.push(node);
  }

  // Merge small buckets (≤1 node) into their document's largest bucket
  const docBuckets = new Map<string, string[]>(); // docId → keys
  for (const [key, bucket] of buckets) {
    const list = docBuckets.get(bucket.docId) ?? [];
    list.push(key);
    docBuckets.set(bucket.docId, list);
  }

  for (const [docId, keys] of docBuckets) {
    const small = keys.filter(k => buckets.get(k)!.nodes.length <= 1);
    const large = keys.filter(k => buckets.get(k)!.nodes.length > 1);

    if (small.length > 0 && large.length > 0) {
      // Find the largest bucket in this doc
      const targetKey = large.sort((a, b) =>
        buckets.get(b)!.nodes.length - buckets.get(a)!.nodes.length
      )[0];
      const target = buckets.get(targetKey)!;
      for (const smallKey of small) {
        target.nodes.push(...buckets.get(smallKey)!.nodes);
        buckets.delete(smallKey);
      }
    }
  }

  // Convert buckets to IUs
  const ius: ImplementationUnit[] = [];

  for (const [, bucket] of buckets) {
    const { nodes, docId, sectionName } = bucket;
    if (nodes.length === 0) continue;

    const name = cleanName(sectionName);
    const serviceName = deriveServiceName(docId);
    const fileName = slugify(name);
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
