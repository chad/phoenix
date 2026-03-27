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
import { CONFIG } from './experiment-config.js';

export interface LLMCanonOptions {
  /** Enable self-consistency with k samples (default: 1 = no self-consistency) */
  selfConsistencyK?: number;
}

/**
 * Extract canonical nodes using rule-based extraction + LLM normalization.
 * Falls back to pure rule-based on any LLM failure.
 */
export async function extractCanonicalNodesLLM(
  clauses: Clause[],
  llm: LLMProvider | null,
  options?: LLMCanonOptions,
): Promise<CanonicalNode[]> {
  // Phase 1: rule-based extraction (always deterministic)
  const { candidates } = extractCandidates(clauses);

  if (!llm || candidates.length === 0) {
    return resolveGraph(candidates, clauses);
  }

  try {
    const k = options?.selfConsistencyK ?? 1;
    const normalized = await normalizeCandidates(candidates, llm, k);
    return resolveGraph(normalized, clauses);
  } catch {
    return resolveGraph(candidates, clauses);
  }
}

async function normalizeCandidates(
  candidates: CandidateNode[],
  llm: LLMProvider,
  k: number = 1,
): Promise<CandidateNode[]> {
  const results: CandidateNode[] = [];

  for (const c of candidates) {
    if (c.type === CanonicalType.CONTEXT) {
      results.push(c);
      continue;
    }

    try {
      const prompt = `Rewrite this ${c.type} statement in canonical form:\n"${c.statement}"`;

      if (k <= 1) {
        // Single-shot normalization
        const response = await llm.generate(prompt, {
          system: CONFIG.LLM_NORMALIZER_SYSTEM,
          temperature: CONFIG.LLM_NORMALIZER_TEMPERATURE,
          maxTokens: CONFIG.LLM_NORMALIZER_MAX_TOKENS,
        });
        const normalized = parseNormalizerResponse(response);
        if (normalized && normalized.length > 5) {
          const newId = sha256([c.type, normalized, c.source_clause_ids[0]].join('\x00'));
          results.push({ ...c, candidate_id: newId, statement: normalized, extraction_method: 'llm' });
        } else {
          results.push(c);
        }
      } else {
        // Self-consistency: generate k samples, select lexical medoid
        const samples: string[] = [];
        for (let i = 0; i < k; i++) {
          const response = await llm.generate(prompt, {
            system: CONFIG.LLM_NORMALIZER_SYSTEM,
            temperature: i === 0 ? CONFIG.LLM_NORMALIZER_TEMPERATURE : CONFIG.LLM_CONSISTENCY_TEMPERATURE,
            maxTokens: CONFIG.LLM_NORMALIZER_MAX_TOKENS,
          });
          const parsed = parseNormalizerResponse(response);
          if (parsed && parsed.length > 5) samples.push(parsed);
        }

        if (samples.length === 0) {
          results.push(c);
        } else {
          const medoid = selectMedoid(samples);
          const newId = sha256([c.type, medoid, c.source_clause_ids[0]].join('\x00'));
          results.push({ ...c, candidate_id: newId, statement: medoid, extraction_method: 'llm' });
        }
      }
    } catch {
      results.push(c);
    }
  }

  return results;
}

/**
 * Select the lexical medoid: the sample most similar to all others.
 * Similarity measured by token Jaccard. Ties broken alphabetically (deterministic).
 */
export function selectMedoid(samples: string[]): string {
  if (samples.length === 1) return samples[0];

  const tokenSets = samples.map(s => new Set(s.toLowerCase().split(/\s+/)));

  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < samples.length; i++) {
    let totalSim = 0;
    for (let j = 0; j < samples.length; j++) {
      if (i === j) continue;
      totalSim += jaccardTokens(tokenSets[i], tokenSets[j]);
    }
    // Ties broken alphabetically for determinism
    if (totalSim > bestScore || (totalSim === bestScore && samples[i] < samples[bestIdx])) {
      bestScore = totalSim;
      bestIdx = i;
    }
  }

  return samples[bestIdx];
}

function jaccardTokens(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
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

// ─── LLM-as-Reclassifier ─────────────────────────────────────────────────────

/**
 * Reclassify candidates using LLM. Keeps original statement, only changes type.
 * Preserves recall (no rewording) while improving type accuracy.
 */
export async function reclassifyCandidatesLLM(
  clauses: Clause[],
  llm: LLMProvider,
): Promise<CanonicalNode[]> {
  const { candidates } = extractCandidates(clauses);
  if (!llm || candidates.length === 0) {
    return resolveGraph(candidates, clauses);
  }

  const reclassified: CandidateNode[] = [];
  for (const c of candidates) {
    // Only reclassify low-confidence non-CONTEXT nodes
    if (c.type === CanonicalType.CONTEXT || c.confidence > 0.5) {
      reclassified.push(c);
      continue;
    }

    try {
      const prompt = `Classify this statement:\n"${c.statement}"`;
      const response = await llm.generate(prompt, {
        system: CONFIG.LLM_RECLASSIFIER_SYSTEM,
        temperature: CONFIG.LLM_RECLASSIFIER_TEMPERATURE,
        maxTokens: CONFIG.LLM_RECLASSIFIER_MAX_TOKENS,
      });

      const newType = parseReclassifierResponse(response);
      if (newType) {
        reclassified.push({ ...c, type: newType, extraction_method: 'llm' });
      } else {
        reclassified.push(c);
      }
    } catch {
      reclassified.push(c);
    }
  }

  return resolveGraph(reclassified, clauses);
}

function parseReclassifierResponse(raw: string): CanonicalType | null {
  const text = raw.trim();
  try {
    const objStart = text.indexOf('{');
    const objEnd = text.lastIndexOf('}');
    if (objStart !== -1 && objEnd !== -1) {
      const parsed = JSON.parse(text.slice(objStart, objEnd + 1));
      if (typeof parsed.type === 'string') {
        return parseCanonType(parsed.type);
      }
    }
  } catch {
    // Try to match type directly from text
  }

  // Fallback: look for a type keyword in the response
  const upper = text.toUpperCase();
  for (const t of ['INVARIANT', 'CONSTRAINT', 'DEFINITION', 'REQUIREMENT', 'CONTEXT']) {
    if (upper.includes(t)) return parseCanonType(t);
  }

  return null;
}

// ─── LLM-as-Extractor (behind --llm-extract flag) ───────────────────────────

// Extractor system prompt loaded from CONFIG

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
  const BATCH_SIZE = CONFIG.LLM_EXTRACTOR_BATCH_SIZE;
  const allCandidates: CandidateNode[] = [];

  for (let i = 0; i < clauses.length; i += BATCH_SIZE) {
    const batch = clauses.slice(i, i + BATCH_SIZE);
    const prompt = buildExtractPrompt(batch);

    const response = await llm.generate(prompt, {
      system: CONFIG.LLM_EXTRACTOR_SYSTEM,
      temperature: CONFIG.LLM_EXTRACTOR_TEMPERATURE,
      maxTokens: CONFIG.LLM_EXTRACTOR_MAX_TOKENS,
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
        confidence: CONFIG.LLM_EXTRACTOR_CONFIDENCE,
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
