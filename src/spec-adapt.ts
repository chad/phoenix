/**
 * Spec adaptation — the LLM drafts, the human adopts.
 *
 * Phoenix's extractor binds entity-shaped requirements ("The room must have a unique
 * name"). Real specs arrive as vision docs ("the design should evoke…") and the system
 * honestly flags 100+ unverifiable obligations instead of compiling intent. The fix is
 * NOT to widen the frozen extractor with LLM judgment inside the trust path — it is to
 * draft a DERIVED spec: an operational restatement the human reviews, edits, and adopts.
 *
 * The trust discipline (same shape as spec-proposals, larger scale):
 *   - the source spec is never touched; the draft lands in spec.adapted/
 *   - every derived rule carries provenance: <!-- from:L120-L124 --> back to the exact
 *     source lines it restates. Rules the LLM invented to fill gaps carry
 *     <!-- proposed --> and demand explicit human endorsement.
 *   - the coverage report names BOTH failure modes in the open:
 *       dropped  — source normative sentences no derived rule cites (intent lost)
 *       proposed — derived rules with no source span (intent invented)
 *   - the journal receipts the transformation (model, hashes, coverage numbers)
 *
 * Provenance comments are hash-invisible: normalizeText strips HTML comments, so the
 * annotations ride in the adopted file without perturbing clause identity.
 */

import type { LLMProvider } from './llm/provider.js';
import { isObligation } from './constraints/obligations.js';
import { sha256 } from './semhash.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SpecSection {
  /** The section's heading line (or '(preamble)'). */
  heading: string;
  /** 1-based global line number of the section's first line. */
  startLine: number;
  lines: string[];
}

export interface AdaptedRule {
  /** The derived requirement text (comment stripped). */
  text: string;
  /** 1-based source line spans this rule restates. Empty when proposed. */
  fromSpans: Array<[number, number]>;
  /** true = no source span: the LLM filled a gap; the human must endorse. */
  proposed: boolean;
  /** The derived section heading this rule appears under. */
  section: string;
}

export interface AdaptCoverage {
  /** Source lines carrying a normative cue. */
  sourceNormatives: Array<{ line: number; text: string }>;
  /** Normatives cited by at least one derived rule. */
  covered: number;
  /** Normatives NO derived rule cites — intent lost in transformation. */
  dropped: Array<{ line: number; text: string }>;
  /** Derived rules with no source span — intent invented. */
  proposedRules: string[];
  /** from-spans pointing outside the source file — hallucinated references. */
  unboundSpans: Array<[number, number]>;
}

export interface AdaptResult {
  derivedMarkdown: string;
  glossary: string;
  rules: AdaptedRule[];
  coverage: AdaptCoverage;
  sourceSha: string;
  model: string;
}

// ─── Section splitting ───────────────────────────────────────────────────────

/**
 * Split a markdown spec into top-level sections ('# ' headings), preserving any
 * preamble. Line numbers are global (1-based) so provenance spans are stable.
 */
export function splitSpecSections(content: string): SpecSection[] {
  const lines = content.split('\n');
  const sections: SpecSection[] = [];
  let cur: SpecSection | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (/^# /.test(lines[i])) {
      if (cur) sections.push(cur);
      cur = { heading: lines[i].trim(), startLine: i + 1, lines: [lines[i]] };
    } else {
      if (!cur) cur = { heading: '(preamble)', startLine: 1, lines: [] };
      cur.lines.push(lines[i]);
    }
  }
  if (cur && cur.lines.some(l => l.trim().length > 0)) sections.push(cur);
  return sections.filter(s => s.heading !== '(preamble)' || s.lines.some(l => l.trim()));
}

/** Oversized sections are adapted in sequential chunks of this many lines. */
export const ADAPT_CHUNK_LINES = 250;

// ─── Prompts ─────────────────────────────────────────────────────────────────

const GLOSSARY_SYSTEM = `You are a requirements engineer extracting a data model from a product specification.
List every entity the spec discusses, with its attributes, value types, enums, and relationships to other entities.
Rules:
- Entities are nouns the spec's rules are ABOUT (room, message, avatar) — never pronouns, roles-in-passing, or UI regions.
- For each attribute give: name, type, and any constraint the spec states or directly implies (range, enum values, uniqueness, required/optional).
- Note relationships explicitly (a message belongs to a channel; a bot is owned by a participant).
- Output ONLY a markdown bullet list. No prose, no headings beyond one "# Data model" line.`;

const SECTION_SYSTEM = `You are a requirements engineer converting one section of a product specification into machine-checkable requirements.

You will receive the spec's data model and one section with line numbers ("N: text"). Produce the same section rewritten as operational requirements.

Rules for the rewrite:
1. Every requirement is ONE bullet line: an explicit entity subject from the data model, a modal verb (must / must not / always / never), and a machine-checkable predicate (a number, an enum value, uniqueness, presence, ordering, equality). One rule per line — split compound sentences.
2. NEVER use pronouns as subjects. If the source says "it" or "they", name the entity.
3. Every restated rule ends with a provenance comment citing the source line numbers it came from: <!-- from:L120-L124 -->. Cite tightly.
4. If the section implies a rule it never states (a gap a reader must assume), you MAY add it as a bullet ending with <!-- proposed --> — sparingly. Never silently invent.
5. Aspirations that cannot be machine-checked ("feel like", "evoke", "recognizable", "not annoying") go under a "### Vision (unverified context)" subsection, rewritten WITHOUT modal verbs as plain descriptive sentences, each with provenance. Do not delete them — they are context, not rules.
6. Tables and list fragments carrying normative content become full-sentence rules with provenance.
7. Keep the section's original heading as the first line. Output ONLY markdown for this section — no preamble, no fences.`;

// ─── Derived-output parsing ──────────────────────────────────────────────────

const FROM_COMMENT_RE = /<!--\s*from:([^>]*)-->/g;
// Inside a from: body, citations appear as L120, L120-L124, L120-124, or comma lists
// (L120, L124) — models vary; every shape parses to tight spans.
const SPAN_RE = /L?(\d+)(?:\s*-\s*L?(\d+))?/g;
const PROPOSED_RE = /<!--\s*proposed\s*-->/;

/**
 * Parse one adapted section's markdown into rules with provenance. Spans outside the
 * source's line count are collected separately (hallucinated references — reported,
 * never trusted).
 */
export function parseAdaptedSection(
  markdown: string,
  sourceLineCount: number,
): { rules: AdaptedRule[]; unboundSpans: Array<[number, number]> } {
  const rules: AdaptedRule[] = [];
  const unboundSpans: Array<[number, number]> = [];
  let section = '';
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (/^#{1,4}\s/.test(line)) { section = line.replace(/^#{1,4}\s+/, ''); continue; }
    if (!/^[-*]\s/.test(line)) continue;
    if (!line.includes('<!--')) continue; // a bare bullet is not a citation — not a rule
    const proposed = PROPOSED_RE.test(line);
    const spans: Array<[number, number]> = [];
    for (const cm of line.matchAll(FROM_COMMENT_RE)) {
      for (const m of cm[1].matchAll(SPAN_RE)) {
        const a = parseInt(m[1], 10);
        const b = m[2] ? parseInt(m[2], 10) : a;
        if (a < 1 || b > sourceLineCount || a > b) unboundSpans.push([a, b]);
        else spans.push([a, b]);
      }
    }
    const text = line.replace(/^[-*]\s+/, '').replace(FROM_COMMENT_RE, '').replace(PROPOSED_RE, '').trim();
    if (text.length < 8) continue;
    // No valid span (none given, or all hallucinated) ⇒ the rule is INVENTED as far as
    // the source is concerned: keep it, marked proposed, so the human endorses or deletes.
    rules.push({ text, fromSpans: spans, proposed: proposed || spans.length === 0, section });
  }
  return { rules, unboundSpans };
}

// ─── Coverage ────────────────────────────────────────────────────────────────

/** Strip list/table decoration so the normative detector sees the sentence. */
function undecorate(line: string): string {
  return line.replace(/^\s*[-*]\s+/, '').replace(/^\s*\|/, '').replace(/\|\s*$/, '').trim();
}

/**
 * The trust report: which source normatives the draft covers (a derived rule cites
 * their line), which it DROPPED (intent lost), and which rules it PROPOSED (intent
 * invented). Line-level: a normative is covered when any rule's span contains it.
 */
export function computeAdaptCoverage(source: string, rules: AdaptedRule[], unboundSpans: Array<[number, number]>): AdaptCoverage {
  const lines = source.split('\n');
  const sourceNormatives: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const text = undecorate(lines[i]);
    if (text.length >= 8 && isObligation(text)) sourceNormatives.push({ line: i + 1, text });
  }
  const citedLines = new Set<number>();
  for (const r of rules) {
    // Vision-section lines acknowledge a normative as context — they do not COVER it
    // as a checkable rule, and the report must not pretend otherwise.
    if (/^vision\b/i.test(r.section)) continue;
    for (const [a, b] of r.fromSpans) for (let n = a; n <= b; n++) citedLines.add(n);
  }
  const dropped = sourceNormatives.filter(n => !citedLines.has(n.line));
  return {
    sourceNormatives,
    covered: sourceNormatives.length - dropped.length,
    dropped,
    proposedRules: rules.filter(r => r.proposed).map(r => r.text),
    unboundSpans,
  };
}

// ─── The transformation ──────────────────────────────────────────────────────

function stripFences(text: string): string {
  const m = text.match(/```(?:markdown|md)?\s*\n([\s\S]*?)\n?```/);
  return m ? m[1] : text;
}

function numbered(lines: string[], startLine: number): string {
  return lines.map((l, i) => `${startLine + i}: ${l}`).join('\n');
}

/**
 * Adapt one spec document. Two phases: a whole-spec data-model pass, then per-section
 * rewrites with the glossary in context (sections over ADAPT_CHUNK_LINES are chunked —
 * provenance spans are global line numbers, so chunking never corrupts citation).
 * Sections are independent and adapted CONCURRENTLY; `checkpoint` fires after each one
 * so the caller can persist partial work — a crashed run loses nothing completed.
 */
export async function adaptSpec(
  docName: string,
  source: string,
  llm: LLMProvider,
  opts: {
    onProgress?: (msg: string) => void;
    checkpoint?: (partsInOrder: string[], glossary: string) => void;
    concurrency?: number;
  } = {},
): Promise<AdaptResult> {
  const say = opts.onProgress ?? (() => {});
  const sourceLineCount = source.split('\n').length;
  const sourceSha = sha256(source);

  say('extracting the data model (whole-spec pass)');
  const glossary = stripFences(await llm.generate(
    `Extract the data model from this specification.\n\n${source}`,
    { system: GLOSSARY_SYSTEM, temperature: 0, maxTokens: 4096 },
  )).trim();

  // Flatten sections into chunk jobs (order preserved by job index).
  interface Job { heading: string; chunk: string[]; startLine: number; index: number }
  const jobs: Job[] = [];
  for (const section of splitSpecSections(source)) {
    for (let off = 0; off < section.lines.length; off += ADAPT_CHUNK_LINES) {
      jobs.push({
        heading: section.heading,
        chunk: section.lines.slice(off, off + ADAPT_CHUNK_LINES),
        startLine: section.startLine + off,
        index: jobs.length,
      });
    }
  }

  const derivedParts: string[] = new Array(jobs.length).fill('');
  const allRules: AdaptedRule[] = [];
  const allUnbound: Array<[number, number]> = [];
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  let next = 0, done = 0;

  async function worker(): Promise<void> {
    while (next < jobs.length) {
      const job = jobs[next++];
      say(`adapting ${job.heading}${job.chunk.length >= ADAPT_CHUNK_LINES ? ` (from line ${job.startLine})` : ''} [${++done}/${jobs.length}]`);
      const out = stripFences(await llm.generate(
        `Data model:\n${glossary}\n\nSection "${job.heading}" of the source spec (line numbers are global — cite them):\n\n${numbered(job.chunk, job.startLine)}`,
        { system: SECTION_SYSTEM, temperature: 0, maxTokens: 8192 },
      )).trim();
      derivedParts[job.index] = out;
      const parsed = parseAdaptedSection(out, sourceLineCount);
      allRules.push(...parsed.rules);
      allUnbound.push(...parsed.unboundSpans);
      opts.checkpoint?.([...derivedParts], glossary);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const coverage = computeAdaptCoverage(source, allRules, allUnbound);
  const partsInOrder = derivedParts.filter(p => p.length > 0);

  const header = [
    `<!-- PHOENIX-DERIVED DRAFT — review, edit, then adopt.`,
    `     source: ${docName} (sha256:${sourceSha.slice(0, 16)}…, ${sourceLineCount} lines)`,
    `     model: ${llm.name}/${llm.model}`,
    `     coverage: ${coverage.covered}/${coverage.sourceNormatives.length} source obligations cited · ${coverage.dropped.length} dropped · ${coverage.proposedRules.length} proposed (invented — endorse or delete)`,
    `     Provenance comments (from:Lx-Ly) are hash-invisible and safe to keep. -->`,
    '',
  ].join('\n');

  const derivedMarkdown = `${header}\n# Data model (derived)\n\n${glossary}\n\n${partsInOrder.join('\n\n')}\n`;
  return { derivedMarkdown, glossary, rules: allRules, coverage, sourceSha, model: `${llm.name}/${llm.model}` };
}
