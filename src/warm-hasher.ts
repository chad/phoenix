/**
 * Warm Context Hasher
 *
 * Computes context_semhash_warm after canonicalization is available.
 * Incorporates canonical graph context into the clause hash.
 *
 * v2: Uses only typed edges (not untyped 'relates_to') and
 * filters by confidence threshold to reduce incidental invalidation.
 */

import type { Clause } from './models/clause.js';
import type { CanonicalNode } from './models/canonical.js';
import { sha256 } from './semhash.js';
import { CONFIG } from './experiment-config.js';

/**
 * Compute warm context hash for a clause, incorporating canonical context.
 *
 * Includes:
 * - normalized text
 * - section path
 * - sorted linked canonical node IDs (typed edges only, excluding weak 'relates_to')
 * - sorted canonical node types
 */
export function contextSemhashWarm(
  clause: Clause,
  canonicalNodes: CanonicalNode[],
): string {
  // Find canonical nodes sourced from this clause
  const relatedNodes = canonicalNodes.filter(
    n => n.source_clause_ids.includes(clause.clause_id)
      && (n.confidence ?? 1.0) >= CONFIG.WARM_MIN_CONFIDENCE
  );

  // Collect linked canon IDs — only from typed edges (not 'relates_to')
  const linkedIds = new Set<string>();
  for (const node of relatedNodes) {
    linkedIds.add(node.canon_id);
    for (const linkedId of node.linked_canon_ids) {
      const edgeType = node.link_types?.[linkedId];
      // Include all typed edges except weak 'relates_to'
      if (!edgeType || edgeType !== 'relates_to') {
        linkedIds.add(linkedId);
      }
    }
  }

  // Collect types of related nodes
  const types = new Set(relatedNodes.map(n => n.type));

  const parts = [
    clause.normalized_text,
    clause.section_path.join('/'),
    [...linkedIds].sort().join(','),
    [...types].sort().join(','),
  ];

  return sha256(parts.join('\x00'));
}

/**
 * Compute warm hashes for all clauses.
 * Returns a map of clause_id → context_semhash_warm.
 */
export function computeWarmHashes(
  clauses: Clause[],
  canonicalNodes: CanonicalNode[],
): Map<string, string> {
  const result = new Map<string, string>();
  for (const clause of clauses) {
    result.set(clause.clause_id, contextSemhashWarm(clause, canonicalNodes));
  }
  return result;
}
