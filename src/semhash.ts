/**
 * Semantic hashing for clauses.
 *
 * Two hash types:
 * - clause_semhash: content identity (normalized text only)
 * - context_semhash_cold: local structural context (content + section + neighbors)
 */

import { createHash } from 'node:crypto';

/**
 * Compute SHA-256 hex digest of input string.
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Compute clause_semhash — pure content identity.
 */
export function clauseSemhash(normalizedText: string): string {
  return sha256(normalizedText);
}

/**
 * Compute context_semhash_cold — content + local neighbour context.
 *
 * Document structure (the heading hierarchy) is no longer part of identity or
 * context; it survives only as provenance metadata on the clause.
 * Includes:
 * - normalized text
 * - previous clause's semhash (or empty string)
 * - next clause's semhash (or empty string)
 */
export function contextSemhashCold(
  normalizedText: string,
  prevClauseSemhash: string,
  nextClauseSemhash: string,
): string {
  const parts = [normalizedText, prevClauseSemhash, nextClauseSemhash];
  return sha256(parts.join('\x00'));
}

/**
 * Content-addressed clause ID = source document + normalized content. The heading a
 * statement fell under is provenance, not identity, so it is NOT hashed — a statement
 * keeps its identity if it is moved to a different section.
 */
export function clauseId(sourceDocId: string, normalizedText: string): string {
  return sha256([sourceDocId, normalizedText].join('\x00'));
}
