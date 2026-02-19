/**
 * LLM-Enhanced Canonicalization
 *
 * When an LLM provider is available, uses it to extract richer
 * canonical nodes from clauses. Falls back to rule-based extraction
 * when no provider is configured.
 *
 * The LLM extracts structured JSON: type, statement, tags, and
 * cross-references between nodes — producing a higher-quality
 * canonical graph than regex patterns alone.
 */

import type { Clause } from './models/clause.js';
import type { CanonicalNode } from './models/canonical.js';
import { CanonicalType } from './models/canonical.js';
import type { LLMProvider } from './llm/provider.js';
import { sha256 } from './semhash.js';
import { extractCanonicalNodes as extractRuleBased } from './canonicalizer.js';

const CANON_SYSTEM_PROMPT = `You are a requirements engineer extracting structured canonical nodes from specification text.

For each meaningful statement, extract a JSON object with:
- type: one of REQUIREMENT, CONSTRAINT, INVARIANT, DEFINITION
- statement: the normalized canonical statement (clear, unambiguous, one idea)
- tags: array of key domain terms (lowercase, no stop words)

Rules:
- REQUIREMENT: something the system must do (capabilities, features)
- CONSTRAINT: something the system must NOT do, or limits/bounds
- INVARIANT: something that must ALWAYS or NEVER hold
- DEFINITION: defines a term or concept

Output a JSON array of objects. No markdown fences, no explanation.
Only extract nodes where there is a clear, actionable statement.
Skip headings, meta-text, and filler.`;

interface LLMCanonNode {
  type: string;
  statement: string;
  tags: string[];
}

/**
 * Extract canonical nodes using LLM when available, falling back to rules.
 */
export async function extractCanonicalNodesLLM(
  clauses: Clause[],
  llm: LLMProvider | null,
): Promise<CanonicalNode[]> {
  if (!llm) {
    return extractRuleBased(clauses);
  }

  try {
    const nodes = await extractWithLLM(clauses, llm);
    // Fall back if LLM produced nothing useful
    if (nodes.length === 0) {
      return extractRuleBased(clauses);
    }
    return nodes;
  } catch (err) {
    // Fall back to rule-based on any LLM failure
    return extractRuleBased(clauses);
  }
}

async function extractWithLLM(
  clauses: Clause[],
  llm: LLMProvider,
): Promise<CanonicalNode[]> {
  // Batch clauses into groups to avoid token limits
  const BATCH_SIZE = 20;
  const allNodes: CanonicalNode[] = [];

  for (let i = 0; i < clauses.length; i += BATCH_SIZE) {
    const batch = clauses.slice(i, i + BATCH_SIZE);
    const batchNodes = await extractBatch(batch, llm);
    allNodes.push(...batchNodes);
  }

  // Link nodes that share terms
  linkNodesByTerms(allNodes);

  return allNodes;
}

async function extractBatch(
  clauses: Clause[],
  llm: LLMProvider,
): Promise<CanonicalNode[]> {
  // Build prompt with clause text
  const prompt = buildCanonPrompt(clauses);

  const response = await llm.generate(prompt, {
    system: CANON_SYSTEM_PROMPT,
    temperature: 0.1,
    maxTokens: 4096,
  });

  // Parse LLM response
  const parsed = parseLLMResponse(response);

  // Convert to CanonicalNodes with provenance
  return parsed.map((item, idx) => {
    const clauseIdx = Math.min(idx, clauses.length - 1);
    const sourceClause = findBestSourceClause(item, clauses) ?? clauses[clauseIdx];

    const type = parseCanonType(item.type);
    const canonId = sha256([type, item.statement, sourceClause.clause_id].join('\x00'));

    return {
      canon_id: canonId,
      type,
      statement: item.statement,
      source_clause_ids: [sourceClause.clause_id],
      linked_canon_ids: [],
      tags: item.tags || [],
    };
  });
}

function buildCanonPrompt(clauses: Clause[]): string {
  const lines: string[] = [];
  lines.push('Extract canonical nodes from the following spec clauses:');
  lines.push('');

  for (const clause of clauses) {
    const section = clause.section_path.join(' > ');
    lines.push(`--- Clause [${section}] ---`);
    lines.push(clause.raw_text.trim());
    lines.push('');
  }

  lines.push('Output a JSON array of canonical nodes.');
  return lines.join('\n');
}

function parseLLMResponse(raw: string): LLMCanonNode[] {
  let text = raw.trim();

  // Strip markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    text = fenceMatch[1];
  }

  // Find JSON array
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart === -1 || arrayEnd === -1) return [];

  try {
    const parsed = JSON.parse(text.slice(arrayStart, arrayEnd + 1));
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item: unknown): item is LLMCanonNode => {
      if (!item || typeof item !== 'object') return false;
      const obj = item as Record<string, unknown>;
      return typeof obj.type === 'string' &&
             typeof obj.statement === 'string' &&
             obj.statement.length > 0;
    }).map(item => ({
      type: item.type,
      statement: item.statement,
      tags: Array.isArray(item.tags) ? item.tags.filter((t: unknown) => typeof t === 'string') : [],
    }));
  } catch {
    return [];
  }
}

function parseCanonType(raw: string): CanonicalType {
  const upper = raw.toUpperCase().trim();
  switch (upper) {
    case 'REQUIREMENT': return CanonicalType.REQUIREMENT;
    case 'CONSTRAINT': return CanonicalType.CONSTRAINT;
    case 'INVARIANT': return CanonicalType.INVARIANT;
    case 'DEFINITION': return CanonicalType.DEFINITION;
    default: return CanonicalType.REQUIREMENT;
  }
}

/**
 * Find the clause that best matches a canonical node by term overlap.
 */
function findBestSourceClause(node: LLMCanonNode, clauses: Clause[]): Clause | null {
  let bestClause: Clause | null = null;
  let bestScore = 0;

  const nodeTerms = new Set(
    (node.tags || []).concat(
      node.statement.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    )
  );

  for (const clause of clauses) {
    const clauseTerms = clause.normalized_text.toLowerCase().split(/\s+/);
    const overlap = clauseTerms.filter(t => nodeTerms.has(t)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      bestClause = clause;
    }
  }

  return bestClause;
}

/**
 * Link canonical nodes that share significant terms.
 */
function linkNodesByTerms(nodes: CanonicalNode[]): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const shared = nodes[i].tags.filter(t => nodes[j].tags.includes(t));
      if (shared.length >= 2) {
        if (!nodes[i].linked_canon_ids.includes(nodes[j].canon_id)) {
          nodes[i].linked_canon_ids.push(nodes[j].canon_id);
        }
        if (!nodes[j].linked_canon_ids.includes(nodes[i].canon_id)) {
          nodes[j].linked_canon_ids.push(nodes[i].canon_id);
        }
      }
    }
  }
}
