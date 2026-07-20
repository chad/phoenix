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
  /** Source lines carrying a normative cue (headings excluded — a heading that says
   *  "Requirement" is structure, not a rule). */
  sourceNormatives: Array<{ line: number; text: string }>;
  /** Normatives cited by at least one derived RULE. */
  covered: number;
  /** Normatives cited only by Vision-section lines — acknowledged as unverifiable
   *  context, deliberately not rules. Not lost; not checkable. */
  vision: Array<{ line: number; text: string }>;
  /** Normatives NO derived line cites — intent lost in transformation. */
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
  /** Second-pass salvage: rules/vision recovered from first-pass drops. */
  rescued: { rules: number; vision: number };
  /** Rules the deterministic lint flags — shown to the human, never auto-deleted. */
  suspectRules: SuspectRule[];
  sourceSha: string;
  model: string;
}

export interface SuspectRule {
  text: string;
  reason: string;
  proposed: boolean;
}

/**
 * Deterministic rule lint — the patterns a human review rejected once, so the machine
 * flags them forever (prompts reduce occurrence; the lint catches recurrence). Flags,
 * never deletes: the human stays sovereign over what counts as a rule.
 *   - commentary: a "rule" with no modal verb is an observation, not an obligation
 *   - double negative: "must not fail to X" hides the actual requirement (state X)
 *   - project-planning meta: roadmap phases, launch posts, MVP scoping, and metric
 *     categories describe the PROJECT, not the system under construction
 */
export function lintRule(text: string): string | null {
  if (!/\b(must|shall|never|always)\b/i.test(text)) {
    return 'no modal verb — commentary, not a rule';
  }
  if (/\bmust not [^.]{0,40}\b(fail|unable|omit to|neglect)\b/i.test(text)) {
    return 'double negative — state what must happen instead';
  }
  if (/\b(roadmap|phase \d|launch post|success metric|metric categor|mvp\b|open.?source strategy)\b/i.test(text)) {
    return 'project-planning meta — describes the project, not the system';
  }
  return null;
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
7. PROJECT-PLANNING content is not system behavior. Roadmaps, phase sequences, MVP scoping, launch plans, HN/demo strategy, success metrics without numeric thresholds, open-source strategy, and risk lists describe the PROJECT — put their content under Vision, and never emit a rule about a roadmap phase, launch post, or metric category. (A metric WITH a numeric threshold the system itself must meet is a real rule.)
8. Never emit meta-commentary about the spec itself ("no thresholds are given…") as a bullet — if you cannot make a rule, classify the sentence as Vision or leave it uncited.
9. Scope rules exactly as the source scopes them: a world-level or product-level goal must NOT be widened into a per-entity requirement ("the world should show X" never becomes "every room must show X").
10. No double negatives ("must not fail to render") — state what MUST happen ("must render … as …").
11. Keep the section's original heading as the first line. Output ONLY markdown for this section — no preamble, no fences.`;

// ─── Derived-output parsing ──────────────────────────────────────────────────

const RESCUE_SYSTEM = `You are a requirements engineer. The first translation pass missed the sentences below — each is a normative sentence from a product spec that no derived rule cites. Give each ONE more careful attempt.

For EACH listed sentence, output exactly one bullet, in one of the two sections:
- Under "## Rescued rules": a machine-checkable rule — explicit entity subject, modal verb, checkable predicate — ending with <!-- from:LN --> citing the sentence's line number. Tables and list fragments become full-sentence rules.
- Under "### Vision (unverified context)": if the sentence CANNOT be machine-checked ("feel like", "evoke", aspirations) or is PROJECT-PLANNING content (roadmap, MVP scope, launch strategy, metric categories without thresholds), restate it WITHOUT modal verbs as plain description, ending with <!-- from:LN -->. NEVER force a rule from an unverifiable sentence — misclassifying vision as a rule is worse than admitting it.

No double negatives; scope rules exactly as the source scopes them; never emit meta-commentary about the spec as a bullet.

Output ONLY markdown with those two section headings (omit an empty section). Every listed line number must appear in exactly one bullet.`;

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
 * The lines whose citation carries an intro line's intent: a normative ending in ':'
 * introduces a list — the RULES live in the bullets that follow. Returns the 1-based
 * line numbers of the intro's block (bullets, table rows, indented continuations),
 * bounded and stopping at the next heading or flush plain paragraph.
 */
function introBlockLines(lines: string[], introIdx: number): number[] {
  if (!/:\s*$/.test(lines[introIdx].trim())) return [];
  const block: number[] = [];
  for (let j = introIdx + 1; j < Math.min(lines.length, introIdx + 40); j++) {
    const l = lines[j];
    if (/^#{1,6}\s/.test(l)) break;                       // next heading ends the block
    if (l.trim() === '') { if (block.length > 0) continue; else continue; } // leading/interior blanks ok
    if (/^\s*(?:[-*+]|\d+[.)])\s/.test(l) || /^\s*\|/.test(l) || /^\s{2,}\S/.test(l)) {
      block.push(j + 1);
      continue;
    }
    break;                                                // flush plain text ends the block
  }
  return block;
}

/**
 * The trust report, three-way: which source normatives the draft covers as RULES,
 * which it preserved as VISION (acknowledged unverifiable context), and which it
 * DROPPED (cited by nothing — intent lost); plus rules it PROPOSED (intent invented).
 * Line-level, with two shape smarts: markdown headings never count as normatives, and
 * an intro line ending in ':' is carried by its list block's citations.
 */
export function computeAdaptCoverage(source: string, rules: AdaptedRule[], unboundSpans: Array<[number, number]>): AdaptCoverage {
  const lines = source.split('\n');
  const sourceNormatives: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) continue; // headings are structure, not rules
    const text = undecorate(lines[i]);
    if (text.length >= 8 && isObligation(text)) sourceNormatives.push({ line: i + 1, text });
  }

  const ruleCited = new Set<number>();
  const visionCited = new Set<number>();
  for (const r of rules) {
    const target = /^vision\b/i.test(r.section) ? visionCited : ruleCited;
    for (const [a, b] of r.fromSpans) for (let n = a; n <= b; n++) target.add(n);
  }

  let covered = 0;
  const vision: Array<{ line: number; text: string }> = [];
  const dropped: Array<{ line: number; text: string }> = [];
  for (const n of sourceNormatives) {
    const carriers = [n.line, ...introBlockLines(lines, n.line - 1)];
    if (carriers.some(l => ruleCited.has(l))) covered++;
    else if (carriers.some(l => visionCited.has(l))) vision.push(n);
    else dropped.push(n);
  }

  return {
    sourceNormatives,
    covered,
    vision,
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

  let coverage = computeAdaptCoverage(source, allRules, allUnbound);
  const partsInOrder = derivedParts.filter(p => p.length > 0);

  // The rescue pass — first-pass drops get a second, targeted shot. Each dropped
  // sentence returns as a rule OR an explicit vision classification; whatever still
  // isn't cited stays honestly dropped.
  let rescued = { rules: 0, vision: 0 };
  if (coverage.dropped.length > 0) {
    const srcLines = source.split('\n');
    const RESCUE_BATCH = 20;
    const rescueParts: string[] = [];
    for (let off = 0; off < coverage.dropped.length; off += RESCUE_BATCH) {
      const batch = coverage.dropped.slice(off, off + RESCUE_BATCH);
      say(`rescue pass: ${batch.length} dropped obligation(s) get a second, targeted shot`);
      const listed = batch.map(d => {
        const ctx = srcLines.slice(Math.max(0, d.line - 3), Math.min(srcLines.length, d.line + 2))
          .map((l, i) => `${Math.max(0, d.line - 3) + i + 1}: ${l}`).join('\n');
        return `Line ${d.line}: ${srcLines[d.line - 1]}\nContext:\n${ctx}`;
      }).join('\n\n');
      try {
        const out = stripFences(await llm.generate(listed, { system: RESCUE_SYSTEM, temperature: 0, maxTokens: 4096 })).trim();
        rescueParts.push(out);
        const parsed = parseAdaptedSection(out, sourceLineCount);
        for (const r of parsed.rules) (/^vision\b/i.test(r.section) ? rescued.vision++ : rescued.rules++);
        allRules.push(...parsed.rules);
        allUnbound.push(...parsed.unboundSpans);
      } catch (e) {
        say(`rescue batch failed (${e instanceof Error ? e.message : String(e)}) — those lines stay dropped, honestly`);
      }
    }
    if (rescueParts.length > 0) {
      partsInOrder.push(`# Rescued obligations (second pass)\n\n${rescueParts.join('\n\n')}`);
      coverage = computeAdaptCoverage(source, allRules, allUnbound);
    }
  }

  const header = [
    `<!-- PHOENIX-DERIVED DRAFT — review, edit, then adopt.`,
    `     source: ${docName} (sha256:${sourceSha.slice(0, 16)}…, ${sourceLineCount} lines)`,
    `     model: ${llm.name}/${llm.model}`,
    `     coverage: ${coverage.covered}/${coverage.sourceNormatives.length} source obligations → rules · ${coverage.vision.length} preserved as vision · ${coverage.dropped.length} dropped · ${coverage.proposedRules.length} proposed (invented — endorse or delete) · rescued: ${rescued.rules} rules + ${rescued.vision} vision`,
    `     Provenance comments (from:Lx-Ly) are hash-invisible and safe to keep. -->`,
    '',
  ].join('\n');

  // The lint runs over every rule (cited and proposed alike) — a cited double
  // negative is as unreviewable as an invented one.
  const suspectRules: SuspectRule[] = [];
  for (const r of allRules) {
    if (/^vision\b/i.test(r.section)) continue; // vision lines are exempt — they are not rules
    const reason = lintRule(r.text);
    if (reason) suspectRules.push({ text: r.text, reason, proposed: r.proposed });
  }

  const derivedMarkdown = `${header}\n# Data model (derived)\n\n${glossary}\n\n${partsInOrder.join('\n\n')}\n`;
  return { derivedMarkdown, glossary, rules: allRules, coverage, rescued, suspectRules, sourceSha, model: `${llm.name}/${llm.model}` };
}
