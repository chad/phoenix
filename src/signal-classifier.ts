/**
 * Signal Classifier — separate intent from noise at ingestion.
 *
 * Phoenix must treat input as unstructured (a spec, but equally raw meeting notes,
 * a transcript, or a chat thread). Before a statement is canonicalized it is
 * classified as SIGNAL — a requirement, constraint, invariant, definition, or
 * decision — or NOISE: greetings, speaker labels, timestamps, agenda/process talk,
 * reactions, and conversational filler that carry no intent.
 *
 * Two classifiers, mirroring the rest of the pipeline:
 * - a deterministic rule gate (no LLM) used everywhere, biased to KEEP when unsure
 *   so we never silently drop a requirement — the D-rate / evaluation trust loop
 *   catches residual noise;
 * - an LLM batch classifier for the warm path, which makes the genuinely semantic
 *   "is this actually intent?" judgment, with the rule gate as fallback.
 *
 * This is the front end of the domain-driven redesign: nothing here depends on
 * document structure.
 */

import type { LLMProvider } from './llm/provider.js';

export interface SignalVerdict {
  /** True if the statement carries intent and should be canonicalized. */
  signal: boolean;
  /** Short machine reason (e.g. 'greeting', 'speaker-label', 'normative', 'unsure-keep'). */
  reason: string;
}

const SPEAKER_LABEL = /^\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\s*:\s+(?=\S)/; // "John:", "Mary Smith: "
const BARE_SPEAKER_LABEL = /^\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\s*:\s*$/; // "Mary Smith: " with no content
// Domain/section/field nouns that share the "Word:" shape but are NOT speaker labels.
const NOT_SPEAKER = /^(?:account|search|status|error|warning|note|notes|example|summary|overview|user|users|system|api|admin|client|server|config|database|payment|order|product|report|dashboard|page|view|field|section|feature|priority|severity|todo|done|input|output|result|response|request|name|email|password|title|description|tag|label|goal|scope|context)$/i;

// ── Hard noise — always drop (unambiguous structural / conversational) ───────
const HARD_NOISE: { re: RegExp; reason: string }[] = [
  { re: /^\s*(?:hi|hello|hey|yo|good (?:morning|afternoon|evening)|thanks|thank you|cheers|regards|best|bye|see you|ttyl)\b/i, reason: 'greeting' },
  // Only a VALIDATED clock time (00-23:00-59[:00-59]) — not '16:9' or '99:99'.
  { re: /^\s*\[?(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\s*(?:am|pm)?\]?(?=\s|$)/i, reason: 'timestamp' },
  { re: /^\s*@\w+/, reason: 'mention' },
  { re: /^\s*(?:ok(?:ay)?|yeah|yep|yup|sure|sounds good|got it|makes sense|agreed|nice|cool|lol|haha|\+1|\^|same|ditto)[.! ]*$/i, reason: 'reaction' },
  { re: /^\s*(?:um+|uh+|hmm+|so,? ?|well,? ?|btw,? ?|fyi,? ?)\b/i, reason: 'filler' },
];

// ── Soft noise — process/deferral; dropped UNLESS a strong requirement is present ─
const SOFT_NOISE: { re: RegExp; reason: string }[] = [
  // 'minutes'/'sidebar' removed — they're common domain words (a 30-minute timeout, a UI sidebar).
  { re: /\b(?:agenda|attendees|action items?|next steps|parking lot|housekeeping|round[- ]?table)\b/i, reason: 'meeting-meta' },
  // 'revisit'/'table' require their deferral object and (for table) must not be the noun 'the table'.
  { re: /\b(?:circle back|look(?:ing)? at (?:this|it|that) later|come back to (?:this|it|that)|revisit (?:this|it|that|later)|(?<!the )table (?:this|it|that)|punt(?: on)?|follow up (?:later|offline)|take(?:n)? (?:this )?offline|discuss(?: this| it)? (?:later|offline)|sync (?:up )?(?:later|offline)|moving on|anyway)\b/i, reason: 'deferral' },
];

// ── Strong signal — a genuine requirement/constraint/definition/decision ─────
const SIGNAL_PATTERNS: RegExp[] = [
  /\b(?:must|must not|shall|may not|cannot|can(?:'|no)t|required to|has to|is required)\b/i,
  /\b(?:the system|the app(?:lication)?|the service|users?|admins?|clients?|the api)\b[^?]*\b(?:can|must|will|should|shall|may|are able to)\b/i,
  /\b(?:is|are) defined as\b|\bmeans\b|\brefers to\b|\bconsists of\b/i,                 // definitions (not bare 'is a')
  /\b(?:we (?:decided|agreed|will use|chose|picked|settled on|are going with)|decision:|let's use)\b/i, // decisions
  /\b(?:at most|at least|no more than|no fewer than|maximum|minimum|limited to|up to|exactly|between)\b.*\b\d/i, // numeric constraints
  /\b(?:create|read|update|delete|edit|view|list|search|filter|validate|assign|move|track|store|compute)\b/i, // CRUD/ops verbs
];

/** Remove a leading speaker label so it doesn't leak into the canonical statement —
 *  but NOT when the prefix is a domain/section noun ('Account:', 'Search:'). */
export function stripSpeakerLabel(text: string): string {
  if (!SPEAKER_LABEL.test(text)) return text.trim();
  const label = text.slice(0, text.indexOf(':')).trim();
  if (NOT_SPEAKER.test(label) || NOT_SPEAKER.test(label.split(/\s+/)[0])) return text.trim();
  return text.replace(SPEAKER_LABEL, '').trim();
}

// Explicit, strong requirement patterns that outrank any noise rule.
const STRONG_SIGNAL: RegExp[] = [SIGNAL_PATTERNS[0], SIGNAL_PATTERNS[1]];
const STRONG_RE = /\b(?:must|must not|shall|cannot|can(?:'|no)t|create|read|update|delete|edit|view|list|search|filter|validate|assign|move|track|store|compute|defined as|means|refers to)\b/i;
const LEAD_IN_RE = /^(?:anyway|so|well|ok(?:ay)?|moving on|actually|right|um+|uh+|hmm+)\b/i;

function isLeadInNoise(seg: string): boolean {
  const s = seg.trim();
  if (s.length === 0) return true; // empty only — a 1-char segment may be a meaningful identifier
  return SOFT_NOISE.some(p => p.re.test(s)) || LEAD_IN_RE.test(s);
}

/**
 * Clean a kept statement: drop a leading speaker label, a "<chatter> — <requirement>"
 * lead-in, and a "anyway,/so,/ok," filler prefix, so the canonical statement is just
 * the intent. The dropped text survives as provenance via the source clause.
 */
export function stripLeadingNoise(text: string): string {
  let t = stripSpeakerLabel(text);
  const parts = t.split(/\s+[—–-]\s+/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1].trim();
    if (STRONG_RE.test(last) && parts.slice(0, -1).every(isLeadInNoise)) return last;
  }
  t = t.replace(/^(?:anyway|so|well|ok(?:ay)?|moving on|actually|right)\s*,\s*/i, '').trim();
  return t;
}

/**
 * Rule-based signal gate. Deterministic; conservative. Order: drop unambiguous hard
 * noise; strip a speaker label; a strong requirement keeps the line (even if it also
 * mentions deferral/process); otherwise soft process-noise and bare questions drop;
 * everything else is kept (recall over precision — the D-rate/eval loop handles the
 * rest). The LLM classifier makes the finer semantic call on the warm path.
 */
export function classifySignal(text: string): SignalVerdict {
  const t = text.trim();
  if (t.length < 3 || !/[a-z]/i.test(t)) return { signal: false, reason: 'empty' };
  // A line that is ONLY a dangling speaker label carries no intent.
  if (BARE_SPEAKER_LABEL.test(t)) return { signal: false, reason: 'speaker-label' };

  const s = stripSpeakerLabel(t);

  // An EXPLICIT, strong requirement (must/shall/subject+modal) wins over EVERY noise
  // rule — a real requirement that merely opens with 'So '/'Best '/'16:9 ' must survive.
  for (const re of STRONG_SIGNAL) if (re.test(s) || re.test(t)) return { signal: true, reason: 'normative' };

  for (const { re, reason } of HARD_NOISE) if (re.test(t)) return { signal: false, reason };
  for (const { re, reason } of HARD_NOISE) if (re.test(s)) return { signal: false, reason };

  // Weaker signal patterns (definitions, decisions, numeric, CRUD) keep the line.
  for (const re of SIGNAL_PATTERNS) if (re.test(s)) return { signal: true, reason: 'normative' };

  // Soft noise judged on the original line too (a speaker-label strip can remove a
  // meta word, e.g. "Agenda: roadmap, lunch").
  for (const { re, reason } of SOFT_NOISE) if (re.test(t) || re.test(s)) return { signal: false, reason };

  if (/\?\s*$/.test(s) && !/\b(must|shall|create|update|delete|support|allow|require|validate)\b/i.test(s)) {
    return { signal: false, reason: 'question' };
  }

  return { signal: true, reason: 'unsure-keep' };
}

/**
 * LLM batch signal classifier for the warm path. Makes the semantic intent-vs-noise
 * judgment. Falls back to the rule gate on any parse/transport failure.
 */
export async function classifySignalBatchLLM(
  texts: string[],
  llm: LLMProvider,
): Promise<SignalVerdict[]> {
  if (texts.length === 0) return [];
  const numbered = texts.map((t, i) => `${i + 1}. ${t.replace(/\n/g, ' ')}`).join('\n');
  const prompt = `You are filtering unstructured product notes (which may be raw meeting notes or chat) down to statements that express software intent.

For each numbered line, decide if it is SIGNAL — a requirement, constraint, invariant, definition, or an explicit decision about what to build — or NOISE — greetings, speaker labels, timestamps, agenda/process talk, questions, reactions, examples, or conversational filler.

Return ONLY a JSON array of objects [{"i": <line number>, "signal": <true|false>, "reason": "<2-4 words>"}], one per line, no prose.

Lines:
${numbered}`;

  try {
    const raw = await llm.generate(prompt, { temperature: 0, maxTokens: 4096 });
    const jsonText = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1);
    const parsed = JSON.parse(jsonText) as { i: number; signal: boolean; reason?: string }[];
    const byIndex = new Map(parsed.map(p => [p.i, p]));
    return texts.map((t, idx) => {
      const p = byIndex.get(idx + 1);
      if (!p || typeof p.signal !== 'boolean') return classifySignal(t);
      return { signal: p.signal, reason: p.reason || 'llm' };
    });
  } catch {
    return texts.map(classifySignal); // fallback to the deterministic gate
  }
}
