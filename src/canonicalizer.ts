/**
 * Canonicalization Engine v2
 *
 * Phase 1: Extraction — sentence-level, scoring rubric, CONTEXT type.
 * Produces CandidateNode[] with confidence scores and coverage.
 *
 * Also exports the legacy extractCanonicalNodes() for backward compat,
 * which runs extraction + resolution in one call.
 */

import type { Clause } from './models/clause.js';
import type { CanonicalNode, CandidateNode, ExtractionCoverage } from './models/canonical.js';
import { CanonicalType } from './models/canonical.js';
import { sha256 } from './semhash.js';
import { normalizeText } from './normalizer.js';
import { segmentSentences } from './sentence-segmenter.js';
import { resolveGraph } from './resolution.js';
import { CONFIG } from './experiment-config.js';

// ─── Domain term whitelist (short tokens to keep) ────────────────────────────

const DOMAIN_TERMS = new Set([
  'id', 'ui', 'ux', 'api', 'jwt', 'sso', 'otp', 'ip', 'db', 'tls', 'ssl',
  'rsa', 'aes', 'rs256', 'hs256', 'oidc', 'oauth', '2fa', 'mfa', 'url',
  'uri', 'http', 'https', 'sql', 'css', 'html', 'xml', 'json', 'yaml',
  'csv', 'tcp', 'udp', 'dns', 'cdn', 'ci', 'cd', 'io', 'os', 'vm',
]);

// ─── Scoring rubric for type classification ──────────────────────────────────

interface TypeScores {
  [CanonicalType.REQUIREMENT]: number;
  [CanonicalType.CONSTRAINT]: number;
  [CanonicalType.INVARIANT]: number;
  [CanonicalType.DEFINITION]: number;
  [CanonicalType.CONTEXT]: number;
}

function emptyScores(): TypeScores {
  return {
    [CanonicalType.REQUIREMENT]: 0,
    [CanonicalType.CONSTRAINT]: 0,
    [CanonicalType.INVARIANT]: 0,
    [CanonicalType.DEFINITION]: 0,
    [CanonicalType.CONTEXT]: 0,
  };
}

/** Score a sentence across all types; highest score wins */
function scoreSentence(text: string, headingContext: CanonicalType | null): { type: CanonicalType; confidence: number } {
  const scores = emptyScores();
  const lower = text.toLowerCase();

  // ── Constraint signals ──
  if (/\b(?:must not|shall not|may not|cannot|can't|disallowed|forbidden|prohibited)\b/i.test(text)) {
    scores[CanonicalType.CONSTRAINT] += CONFIG.CONSTRAINT_NEGATION_WEIGHT;
  }
  if (/\b(?:limited to|maximum|minimum|at most|at least|no more than|no fewer than|up to|ceiling|floor)\b/i.test(text)) {
    scores[CanonicalType.CONSTRAINT] += CONFIG.CONSTRAINT_LIMIT_WEIGHT;
  }
  // Numeric bounds: "5 per minute", "≤ 100", "between 1 and 10"
  if (/\b\d+\s*(?:per|\/)\s*\w+\b/i.test(text) || /[≤≥<>]\s*\d+/.test(text)) {
    scores[CanonicalType.CONSTRAINT] += CONFIG.CONSTRAINT_NUMERIC_WEIGHT;
  }

  // ── Invariant signals ──
  if (/\b(?:always|never|at all times|regardless|invariant|guaranteed|must remain|must always|must never)\b/i.test(text)) {
    scores[CanonicalType.INVARIANT] += CONFIG.INVARIANT_SIGNAL_WEIGHT;
  }

  // ── Requirement signals ──
  if (/\b(?:must|shall)\b/i.test(text) && !/\b(?:must not|shall not|must always|must never|must remain)\b/i.test(text)) {
    scores[CanonicalType.REQUIREMENT] += CONFIG.REQUIREMENT_MODAL_WEIGHT;
  }
  if (/\b(?:required|requires?|needs? to|has to|will)\b/i.test(text)) {
    scores[CanonicalType.REQUIREMENT] += CONFIG.REQUIREMENT_KEYWORD_WEIGHT;
  }
  if (/\b(?:support|provide|implement|enable|allow|accept|return|create|delete|update|send|receive|handle|manage|track|store|validate|generate)\b/i.test(text)) {
    scores[CanonicalType.REQUIREMENT] += CONFIG.REQUIREMENT_VERB_WEIGHT;
  }

  // ── Definition signals ──
  if (/\b(?:is defined as|means|refers to|is a|is an)\b/i.test(text) && text.length < CONFIG.DEFINITION_MAX_LENGTH) {
    scores[CanonicalType.DEFINITION] += CONFIG.DEFINITION_EXPLICIT_WEIGHT;
  }
  // Colon pattern "Term: definition text" but not enumerations
  if (/^[A-Z][a-zA-Z\s]{2,30}:\s+[A-Z]/.test(text) && !/[:,]\s*$/.test(text)) {
    scores[CanonicalType.DEFINITION] += CONFIG.DEFINITION_COLON_WEIGHT;
  }

  // ── Context signals (no actionable keywords) ──
  if (!hasAnyModal(lower) && !hasAnyKeyword(lower)) {
    scores[CanonicalType.CONTEXT] += CONFIG.CONTEXT_NO_MODAL_WEIGHT;
  }
  // Short sentence without verb-like keywords
  if (text.split(/\s+/).length < 8 && !hasAnyModal(lower)) {
    scores[CanonicalType.CONTEXT] += CONFIG.CONTEXT_SHORT_WEIGHT;
  }

  // ── Heading context bonus ──
  if (headingContext) {
    scores[headingContext] += CONFIG.HEADING_CONTEXT_BONUS;
  }

  // ── Also give constraint "must" credit since "must" appears in constraints too ──
  if (/\b(?:must|shall)\b/i.test(text)) {
    scores[CanonicalType.CONSTRAINT] += CONFIG.CONSTRAINT_MUST_BONUS;
  }

  // Pick winner
  const entries = Object.entries(scores) as [CanonicalType, number][];
  entries.sort((a, b) => b[1] - a[1]);
  const [winType, winScore] = entries[0];
  const runnerUp = entries[1][1];

  // If nothing scored above 0, it's CONTEXT
  if (winScore === 0) {
    return { type: CanonicalType.CONTEXT, confidence: CONFIG.MIN_CONFIDENCE };
  }

  const confidence = Math.max(CONFIG.MIN_CONFIDENCE, Math.min(CONFIG.MAX_CONFIDENCE, (winScore - runnerUp) / Math.max(winScore, 1)));
  return { type: winType, confidence };
}

function hasAnyModal(lower: string): boolean {
  return /\b(?:must|shall|should|will|required|requires?|needs? to|has to|cannot|forbidden|prohibited)\b/.test(lower);
}

function hasAnyKeyword(lower: string): boolean {
  return /\b(?:support|provide|implement|enable|allow|accept|return|create|delete|update|send|receive|handle|manage|track|store|validate|generate|defined|means|refers)\b/.test(lower);
}

// ─── Heading context (same as v1) ────────────────────────────────────────────

const HEADING_CONTEXT: [RegExp, CanonicalType][] = [
  [/\b(?:constraint|security|limit|restrict)/i, CanonicalType.CONSTRAINT],
  [/\b(?:requirement|feature|capability)/i, CanonicalType.REQUIREMENT],
  [/\b(?:definition|glossary|term)/i, CanonicalType.DEFINITION],
  [/\b(?:invariant|guarantee)/i, CanonicalType.INVARIANT],
];

function getHeadingContext(sectionPath: string[]): CanonicalType | null {
  for (let i = sectionPath.length - 1; i >= 0; i--) {
    for (const [pattern, type] of HEADING_CONTEXT) {
      if (pattern.test(sectionPath[i])) return type;
    }
  }
  return null;
}

// ─── Phase 1: Extract candidates ─────────────────────────────────────────────

export interface ExtractionResult {
  candidates: CandidateNode[];
  coverage: ExtractionCoverage[];
}

/**
 * Phase 1: Extract candidate nodes from clauses using sentence segmentation
 * and scoring rubric.
 */
export function extractCandidates(clauses: Clause[]): ExtractionResult {
  const allCandidates: CandidateNode[] = [];
  const allCoverage: ExtractionCoverage[] = [];

  for (const clause of clauses) {
    const { candidates, coverage } = extractFromClause(clause);
    allCandidates.push(...candidates);
    allCoverage.push(coverage);
  }

  return { candidates: allCandidates, coverage: allCoverage };
}

function extractFromClause(clause: Clause): { candidates: CandidateNode[]; coverage: ExtractionCoverage } {
  const sentences = segmentSentences(clause.raw_text);
  const headingContext = getHeadingContext(clause.section_path);
  const candidates: CandidateNode[] = [];
  let extractedCount = 0;
  let contextCount = 0;
  const uncovered: ExtractionCoverage['uncovered'] = [];

  for (const sentence of sentences) {
    const content = sentence.text.trim();
    if (!content || content.length < CONFIG.MIN_EXTRACTION_LENGTH) {
      uncovered.push({ text: content, reason: 'too_short' });
      continue;
    }

    const normalizedStatement = normalizeText(content);
    if (!normalizedStatement) {
      uncovered.push({ text: content, reason: 'too_short' });
      continue;
    }

    const { type, confidence } = scoreSentence(content, headingContext);
    const tags = extractTerms(normalizedStatement);

    const candidateId = sha256([type, normalizedStatement, clause.clause_id].join('\x00'));

    candidates.push({
      candidate_id: candidateId,
      type,
      statement: normalizedStatement,
      confidence,
      source_clause_ids: [clause.clause_id],
      tags,
      sentence_index: sentence.index,
      extraction_method: 'rule',
    });

    if (type === CanonicalType.CONTEXT) {
      contextCount++;
    } else {
      extractedCount++;
    }
  }

  const total = sentences.length;
  const coverage: ExtractionCoverage = {
    clause_id: clause.clause_id,
    total_sentences: total,
    extracted_sentences: extractedCount,
    context_sentences: contextCount,
    coverage_pct: total > 0 ? ((extractedCount + contextCount) / total) * 100 : 0,
    uncovered,
  };

  return { candidates, coverage };
}

// ─── Term extraction (v2: acronym whitelist + hyphenated compounds) ───────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'must', 'need', 'to', 'of',
  'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
  'and', 'or', 'but', 'not', 'no', 'if', 'then', 'else', 'when', 'where',
  'that', 'this', 'these', 'those', 'it', 'its', 'all', 'each', 'every',
  'any', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
]);

/**
 * Extract key terms from normalized text.
 * Preserves domain acronyms and hyphenated compounds.
 */
export function extractTerms(text: string): string[] {
  const lower = text.toLowerCase();

  // Extract hyphenated compounds first (e.g., rate-limit, in-progress)
  const hyphenated = lower.match(/\b[a-z0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*/g) || [];

  // Split remaining into words
  const words = lower
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9-]/g, ''))
    .filter(Boolean);

  const terms = new Set<string>();

  // Add hyphenated compounds
  for (const h of hyphenated) {
    if (h.length >= CONFIG.MIN_TERM_LENGTH) terms.add(h);
  }

  // Add individual words
  for (const w of words) {
    // Skip stop words
    if (STOP_WORDS.has(w)) continue;
    // Keep domain terms regardless of length
    if (DOMAIN_TERMS.has(w)) {
      terms.add(w);
      continue;
    }
    // Keep words > 2 chars
    if (w.length > CONFIG.MIN_WORD_LENGTH && !w.includes('-')) {
      terms.add(w);
    }
  }

  return [...terms];
}

// ─── Legacy API: extract + resolve in one call ───────────────────────────────

/**
 * Extract canonical nodes from clauses (v2: sentence-level + resolution).
 * Backward-compatible API — returns CanonicalNode[].
 */
export function extractCanonicalNodes(clauses: Clause[]): CanonicalNode[] {
  const { candidates } = extractCandidates(clauses);
  return resolveGraph(candidates, clauses);
}
