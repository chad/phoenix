/**
 * LLM-Enhanced Canonicalization
 *
 * v2: Two modes:
 * 1. LLM-as-normalizer (default): Rule-based extraction produces candidates,
 *    LLM normalizes each statement. Preserves deterministic extraction.
 * 2. LLM-as-extractor (--llm-extract flag): Full LLM extraction with
 *    explicit provenance required. Falls back to rules on any failure.
 */

import type { Clause } from './models/clause.js';
import type { CanonicalNode, CandidateNode } from './models/canonical.js';
import { CanonicalType } from './models/canonical.js';
import type { LLMProvider } from './llm/provider.js';
import { sha256 } from './semhash.js';
import { extractCandidates } from './canonicalizer.js';
import { resolveGraph } from './resolution.js';

// ─── LLM-as-Normalizer ──────────────────────────────────────────────────────

const NORMALIZER_SYSTEM = `You are a requirements engineer. Rewrite the given statement in canonical form.
Rules: one clear sentence, present tense, active voice, no pronouns, no ambiguity.
Output ONLY a JSON object: {"statement": "..."}
No markdown, no explanation.`;

/**
 * Extract canonical nodes using rule-based extraction + LLM normalization.
 * Falls back to pure rule-based on any LLM failure.
 */
export async function extractCanonicalNodesLLM(
  clauses: Clause[],
  llm: LLMProvider | null,
): Promise<CanonicalNode[]> {
  // Phase 1: rule-based extraction (always deterministic)
  const { candidates } = extractCandidates(clauses);

  if (!llm || candidates.length === 0) {
    return resolveGraph(candidates, clauses);
  }

  try {
    // Normalize statements via LLM
    const normalized = await normalizeCandidates(candidates, llm);
    return resolveGraph(normalized, clauses);
  } catch {
    // Fall back to rule-based candidates
    return resolveGraph(candidates, clauses);
  }
}

async function normalizeCandidates(
  candidates: CandidateNode[],
  llm: LLMProvider,
): Promise<CandidateNode[]> {
  // Only normalize non-CONTEXT nodes (CONTEXT is informational, not worth LLM cost)
  const results: CandidateNode[] = [];

  for (const c of candidates) {
    if (c.type === CanonicalType.CONTEXT) {
      results.push(c);
      continue;
    }

    try {
      const prompt = `Rewrite this ${c.type} statement in canonical form:\n"${c.statement}"`;
      const response = await llm.generate(prompt, {
        system: NORMALIZER_SYSTEM,
        temperature: 0,
        maxTokens: 150,
      });

      const normalized = parseNormalizerResponse(response);
      if (normalized && normalized.length > 5) {
        // Recompute ID with normalized statement
        const newId = sha256([c.type, normalized, c.source_clause_ids[0]].join('\x00'));
        results.push({
          ...c,
          candidate_id: newId,
          statement: normalized,
          extraction_method: 'llm',
        });
      } else {
        results.push(c);
      }
    } catch {
      results.push(c);
    }
  }

  return results;
}

function parseNormalizerResponse(raw: string): string | null {
  const text = raw.trim();

  // Try JSON parse
  try {
    // Strip fences if present
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = fenceMatch ? fenceMatch[1] : text;

    // Find JSON object
    const objStart = jsonStr.indexOf('{');
    const objEnd = jsonStr.lastIndexOf('}');
    if (objStart !== -1 && objEnd !== -1) {
      const parsed = JSON.parse(jsonStr.slice(objStart, objEnd + 1));
      if (typeof parsed.statement === 'string') {
        return parsed.statement.trim();
      }
    }
  } catch {
    // Not JSON — try to use raw text as the statement
  }

  // If it's a short plain text response (no JSON), use it directly
  if (text.length > 5 && text.length < 300 && !text.includes('{')) {
    return text;
  }

  return null;
}

// ─── LLM-as-Extractor (behind --llm-extract flag) ───────────────────────────

const EXTRACT_SYSTEM = `You are a requirements engineer extracting structured canonical nodes from specification text.

For each meaningful statement, extract a JSON object with:
- type: one of REQUIREMENT, CONSTRAINT, INVARIANT, DEFINITION, CONTEXT
- statement: the normalized canonical statement (clear, unambiguous, one idea)
- tags: array of key domain terms (lowercase, no stop words)
- source_section: the section heading this was extracted from

Rules:
- REQUIREMENT: something the system must do (capabilities, features)
- CONSTRAINT: something the system must NOT do, or limits/bounds
- INVARIANT: something that must ALWAYS or NEVER hold
- DEFINITION: defines a term or concept
- CONTEXT: framing text that gives meaning but isn't actionable alone

Output a JSON array. No markdown fences, no explanation.
Every node MUST include source_section.`;

interface LLMExtractedNode {
  type: string;
  statement: string;
  tags: string[];
  source_section?: string;
}

/**
 * Full LLM extraction with explicit provenance.
 * Only used with --llm-extract flag.
 */
export async function extractWithLLMFull(
  clauses: Clause[],
  llm: LLMProvider,
): Promise<CanonicalNode[]> {
  try {
    const candidates = await extractBatchLLM(clauses, llm);
    if (candidates.length === 0) {
      // Fall back to rule-based
      const { candidates: ruleCandidates } = extractCandidates(clauses);
      return resolveGraph(ruleCandidates, clauses);
    }
    return resolveGraph(candidates, clauses);
  } catch {
    const { candidates } = extractCandidates(clauses);
    return resolveGraph(candidates, clauses);
  }
}

async function extractBatchLLM(
  clauses: Clause[],
  llm: LLMProvider,
): Promise<CandidateNode[]> {
  const BATCH_SIZE = 20;
  const allCandidates: CandidateNode[] = [];

  for (let i = 0; i < clauses.length; i += BATCH_SIZE) {
    const batch = clauses.slice(i, i + BATCH_SIZE);
    const prompt = buildExtractPrompt(batch);

    const response = await llm.generate(prompt, {
      system: EXTRACT_SYSTEM,
      temperature: 0.1,
      maxTokens: 4096,
    });

    const parsed = parseLLMExtractResponse(response);

    for (let idx = 0; idx < parsed.length; idx++) {
      const item = parsed[idx];

      // Require explicit provenance — find matching clause by source_section
      const sourceClause = item.source_section
        ? findClauseBySection(item.source_section, batch)
        : null;

      if (!sourceClause) continue; // Drop nodes without valid provenance

      const type = parseCanonType(item.type);
      const candidateId = sha256([type, item.statement, sourceClause.clause_id].join('\x00'));

      allCandidates.push({
        candidate_id: candidateId,
        type,
        statement: item.statement,
        confidence: 0.7, // LLM extraction gets moderate confidence
        source_clause_ids: [sourceClause.clause_id],
        tags: item.tags || [],
        sentence_index: idx,
        extraction_method: 'llm',
      });
    }
  }

  return allCandidates;
}

function buildExtractPrompt(clauses: Clause[]): string {
  const lines: string[] = ['Extract canonical nodes from the following spec clauses:', ''];

  for (const clause of clauses) {
    const section = clause.section_path.join(' > ');
    lines.push(`--- Clause [${section}] ---`);
    lines.push(clause.raw_text.trim());
    lines.push('');
  }

  lines.push('Output a JSON array of canonical nodes. Every node must include source_section.');
  return lines.join('\n');
}

function parseLLMExtractResponse(raw: string): LLMExtractedNode[] {
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) text = fenceMatch[1];

  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart === -1 || arrayEnd === -1) return [];

  try {
    const parsed = JSON.parse(text.slice(arrayStart, arrayEnd + 1));
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item: unknown): item is LLMExtractedNode => {
      if (!item || typeof item !== 'object') return false;
      const obj = item as Record<string, unknown>;
      return typeof obj.type === 'string'
        && typeof obj.statement === 'string'
        && obj.statement.length > 0;
    }).map(item => ({
      type: item.type,
      statement: item.statement,
      tags: Array.isArray(item.tags) ? item.tags.filter((t: unknown) => typeof t === 'string') : [],
      source_section: typeof item.source_section === 'string' ? item.source_section : undefined,
    }));
  } catch {
    return [];
  }
}

function findClauseBySection(sectionName: string, clauses: Clause[]): Clause | null {
  const lower = sectionName.toLowerCase();

  // Exact match on section path
  for (const c of clauses) {
    const path = c.section_path.map(s => s.toLowerCase()).join(' > ');
    if (path.includes(lower) || lower.includes(path)) return c;
  }

  // Partial match on deepest heading
  for (const c of clauses) {
    const deepest = c.section_path[c.section_path.length - 1]?.toLowerCase() ?? '';
    if (deepest.includes(lower) || lower.includes(deepest)) return c;
  }

  return null;
}

function parseCanonType(raw: string): CanonicalType {
  const upper = raw.toUpperCase().trim();
  switch (upper) {
    case 'REQUIREMENT': return CanonicalType.REQUIREMENT;
    case 'CONSTRAINT': return CanonicalType.CONSTRAINT;
    case 'INVARIANT': return CanonicalType.INVARIANT;
    case 'DEFINITION': return CanonicalType.DEFINITION;
    case 'CONTEXT': return CanonicalType.CONTEXT;
    default: return CanonicalType.REQUIREMENT;
  }
}
