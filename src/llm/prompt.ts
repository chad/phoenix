/**
 * Prompt Builder — constructs LLM prompts from IU contracts.
 *
 * Turns the structured IU (requirements, constraints, invariants,
 * inputs, outputs) into a prompt that produces working TypeScript.
 */

import type { ImplementationUnit } from '../models/iu.js';
import type { CanonicalNode } from '../models/canonical.js';
import type { ResolvedTarget } from '../models/architecture.js';
import type { NegativeKnowledge } from '../models/negative-knowledge.js';

export const SYSTEM_PROMPT = `You are a senior TypeScript engineer generating production-quality module implementations for Phoenix VCS.

Rules:
- Output ONLY the TypeScript module code. No markdown fences, no explanation.
- The module must be a valid ES module (.ts) that compiles under strict mode.
- Export all public functions and types.
- Use descriptive types (not \`any\` or \`unknown\` where a real type is appropriate).
- Implement the actual logic described in the requirements — not stubs or TODOs.
- Keep the code clean, readable, and minimal. No over-engineering.
- Include the _phoenix metadata constant exactly as specified.
- Do NOT import from external packages. ZERO runtime dependencies.
- Use only Node.js built-in modules (node:crypto, node:events, node:http, etc.) when needed.
- For WebSocket-like features, use raw node:http or define the interface — do NOT import 'ws'.
- For DOM/browser code, do NOT use DOM APIs. Generate string HTML templates instead.
- For EventEmitter, use node:events and cast as needed. Prefer simple callbacks or Maps.
- The code must compile under TypeScript strict mode (strict: true, no implicit any).
- If the requirements describe a data structure, define and export the types.
- If the requirements describe validation rules, implement them with clear error messages.
- If the requirements describe state management, use a class or closure — your choice.`;

/**
 * Build the user prompt for generating an IU implementation.
 */
/**
 * Get the system prompt, optionally extended with architecture-specific rules.
 */
export function getSystemPrompt(target?: ResolvedTarget | null): string {
  if (!target) return SYSTEM_PROMPT;
  const arch = target.architecture;
  const rt = target.runtime;

  const allowedPkgs = Object.keys(rt.packages).map(p => `'${p}'`).join(', ');

  // Build system prompt from architecture + runtime
  return `You are a senior ${rt.language} engineer generating production-quality module implementations.

Rules:
- Implement the actual logic described in the requirements — not stubs or TODOs.
- Keep the code clean, readable, and minimal. No over-engineering.
- You MUST import from these packages: ${allowedPkgs}. Use them as shown in the examples below.
- Do NOT import any other packages. Do NOT re-implement functionality that the allowed packages provide.

${arch.systemPrompt}
${rt.promptExtension}`;
}

/**
 * A provenance label binds a short, prompt-stable token (R1, C1, I1) to a canon
 * node so the model can cite which requirement a generated line implements
 * without copying long content-addressed ids. Same function drives prompt
 * rendering and post-generation marker extraction so the labels always match.
 */
export interface ProvenanceLabel {
  label: string;
  canonId: string;
  type: string;
  statement: string;
}

export function provenanceLabels(iu: ImplementationUnit, canonNodes: CanonicalNode[]): ProvenanceLabel[] {
  const nodes = canonNodes.filter(n => iu.source_canon_ids.includes(n.canon_id));
  const out: ProvenanceLabel[] = [];
  let r = 0, c = 0, inv = 0;
  for (const n of nodes) {
    if (n.type === 'REQUIREMENT') out.push({ label: `R${++r}`, canonId: n.canon_id, type: n.type, statement: n.statement });
    else if (n.type === 'CONSTRAINT') out.push({ label: `C${++c}`, canonId: n.canon_id, type: n.type, statement: n.statement });
    else if (n.type === 'INVARIANT') out.push({ label: `I${++inv}`, canonId: n.canon_id, type: n.type, statement: n.statement });
  }
  return out;
}

/**
 * Extract `//phx:<label>` markers the model emitted, mapping each annotated line
 * (0-based index) to its canon id, and return the code with the markers stripped
 * so the written source stays clean. Stripping the trailing marker does not shift
 * line numbers, so the indices stay valid against the cleaned code.
 */
export function extractLineProvenance(
  code: string,
  labels: ProvenanceLabel[],
): { code: string; lineProvenance: Record<string, string> } {
  const byLabel: Record<string, string> = {};
  for (const l of labels) byLabel[l.label.toUpperCase()] = l.canonId;
  // One marker may cite several labels (e.g. //phx:C1,C2 or //phx:R1 R2) and may be
  // written as a line comment (//phx:R1) or a block comment (/*phx:R1*/) — the model
  // uses block style inside template literals. Match the whole list, strip it, and
  // record the first resolvable label as the line's primary provenance.
  const re = /\s*(?:\/\/|\/\*)\s*phx:\s*([A-Za-z]\d+(?:[\s,]+[A-Za-z]\d+)*)\s*(?:\*\/)?\s*$/;
  const lineProvenance: Record<string, string> = {};
  const out = code.split('\n').map((line, i) => {
    const m = line.match(re);
    if (!m) return line;
    for (const tok of m[1].split(/[\s,]+/)) {
      const canonId = byLabel[tok.trim().toUpperCase()];
      if (canonId) { lineProvenance[String(i)] = canonId; break; }
    }
    return line.slice(0, m.index).replace(/\s+$/, '');
  });
  return { code: out.join('\n'), lineProvenance };
}

/**
 * The real, already-generated contract of a sibling IU — its request/response
 * schemas and routes — so a consumer IU is generated *against* it instead of
 * guessing field names, types, enum spellings, and nullability.
 */
export interface SiblingContract {
  name: string;
  mountPath: string;
  contract: string;
}

/**
 * Extract fixed vocabularies (enumerations) from canonical statements — e.g.
 * "Status must be one of: backlog, todo, in_progress, in_review, done". The same
 * token list is then injected into every IU's prompt so producers and consumers
 * use identical spellings instead of each re-inventing them ('in_progress' vs
 * 'inprogress' vs 'in-progress'). This is the cross-IU binding for enums.
 */
export function extractVocabularies(canonNodes: CanonicalNode[]): { label: string; values: string[] }[] {
  const byKey = new Map<string, { label: string; values: string[] }>();
  const re = /\b(\w+)\b[^.;:]*?\bone of\b[^:]*:?\s*([a-z0-9_][a-z0-9_,\s]*?)(?:[.;]|$)/gi;
  for (const node of canonNodes) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(node.statement))) {
      const values = m[2]
        .split(/\s*,\s*|\s+or\s+|\s+and\s+/)
        .map(t => t.trim())
        .filter(t => /^[a-z0-9_]+$/i.test(t) && t.length > 0);
      if (values.length < 2) continue;
      // Label: the noun this enumeration constrains (word before "must be one of").
      const lead = m[0].match(/(\w+)\s+(?:must|should|is|are|can)\b/i);
      const label = (lead ? lead[1] : m[1]).toLowerCase();
      const key = values.join(',').toLowerCase();
      if (!byKey.has(key)) byKey.set(key, { label, values });
    }
  }
  return [...byKey.values()];
}

/**
 * Build the user prompt for generating an IU implementation.
 */
export function buildPrompt(
  iu: ImplementationUnit,
  canonNodes: CanonicalNode[],
  siblingModules?: string[],
  target?: ResolvedTarget | null,
  negativeKnowledge?: NegativeKnowledge[],
  siblingContracts?: SiblingContract[],
): string {
  const lines: string[] = [];
  const labels = provenanceLabels(iu, canonNodes);
  const labelOf: Record<string, string> = {};
  for (const l of labels) labelOf[l.canonId] = l.label;
  const lab = (canonId: string) => (labelOf[canonId] ? `[${labelOf[canonId]}] ` : '');

  lines.push(`Generate a TypeScript module implementing "${iu.name}".`);
  lines.push('');

  // Fixed vocabularies — the exact enum tokens, shared across every IU so producers
  // and consumers never drift on spelling (e.g. 'in_progress' vs 'inprogress').
  const vocabularies = extractVocabularies(canonNodes);
  if (vocabularies.length > 0) {
    lines.push('## Fixed vocabularies — use these EXACT string values everywhere');
    lines.push('Use these literal strings verbatim in schemas, DB values, request bodies, and UI — do not change spelling, case, or separators (e.g. always `in_progress`, never `inprogress` or `in-progress`).');
    for (const v of vocabularies) {
      lines.push(`- ${v.label}: ${v.values.map(x => `'${x}'`).join(' | ')}`);
    }
    lines.push('');
  }

  // Inter-IU contract propagation. Each IU is generated by a separate model call;
  // without the producer's real contract a consumer (e.g. a web UI calling an API)
  // guesses field names/types/enums and they drift apart. Inject the actual schemas
  // and routes of sibling modules so this module is generated against them.
  if (siblingContracts && siblingContracts.length > 0) {
    lines.push('## Sibling module contracts — call these EXACTLY (do NOT invent field names)');
    lines.push('These modules already exist. When this module calls them over HTTP, use the EXACT');
    lines.push('field names, types, and enum values shown below. For an optional field that is empty,');
    lines.push('OMIT it from the request body — only send null if the schema marks it `.nullable()`.');
    for (const s of siblingContracts) {
      lines.push('');
      lines.push(`### "${s.name}" — mounted at ${s.mountPath}`);
      lines.push('```ts');
      lines.push(s.contract);
      lines.push('```');
    }
    lines.push('');
  }

  // Negative knowledge — the system's immune memory. Past failed approaches and
  // incident-driven constraints for this IU. Shaping the prompt with what failed
  // is the "gradient of trust": better shapes, not just better prompts.
  if (negativeKnowledge && negativeKnowledge.length > 0) {
    lines.push('## Known failures — do not repeat');
    lines.push('Previous attempts on this module ran into the following. Avoid them:');
    for (const nk of negativeKnowledge.slice(0, 8)) {
      lines.push(`- ${nk.what_was_tried} — ${nk.why_it_failed}`);
      if (nk.constraint_for_future) {
        lines.push(`  → ${nk.constraint_for_future}`);
      }
    }
    lines.push('');
  }

  // For architecture mode, inject the mandatory imports at the top of the prompt
  if (target) {
    lines.push('## MANDATORY: Your module MUST start with these exact imports');
    lines.push('```');
    lines.push(`import { Hono } from 'hono';`);
    lines.push(`import { db, registerMigration } from '../../db.js';`);
    lines.push(`import { z } from 'zod';`);
    lines.push('```');
    lines.push('Do NOT import Database from better-sqlite3. Do NOT create new Database(). Use the db import above.');
    lines.push('');
    lines.push('## Schema conventions');
    lines.push('- In create/update schemas, optional string and number fields must accept null as well as undefined: use `.nullable().optional()`. Clients send null for cleared fields, so a field that is only `.optional()` will reject valid requests.');
    lines.push('- Use snake_case for all field and column names, and keep field names identical between the create schema, the update schema, the DB columns, and the JSON you return.');
    lines.push('- For an enumerated set of NUMBERS (e.g. allowed point values 1,2,3,5,8,13), use `z.union([z.literal(1), z.literal(2), ...])` or `z.number().refine(v => [1,2,3,5,8,13].includes(v))`. NEVER use `z.enum([...])` with numbers — `z.enum` accepts string literals only and will not compile.');
    lines.push("- Call SQL functions like `datetime('now')` directly inside the SQL string (e.g. `SET completed_at = datetime('now')`). NEVER pass them as a bound `?` parameter — that stores the literal text \"datetime('now')\" instead of a timestamp.");
    lines.push('');
    lines.push('## Browser code (only if this module returns an HTML page via c.html(`...`))');
    lines.push('The HTML you emit is executed by a real browser, so it must be valid JS/HTML — not merely a valid TypeScript string (TypeScript will not catch errors inside the page).');
    lines.push('- Do NOT build inline event handlers (onclick="…") with string concatenation; nested quotes break and blank the page. Instead render elements with data-* attributes (data-id, data-status, …) and attach behaviour with addEventListener after inserting the HTML.');
    lines.push('- Keep client-side state field names identical to the API contract (e.g. point_estimate, labels as an array).');
    lines.push('');
  }

  // Requirements
  const iuNodes = canonNodes.filter(n => iu.source_canon_ids.includes(n.canon_id));
  const requirements = iuNodes.filter(n => n.type === 'REQUIREMENT');
  const constraints = iuNodes.filter(n => n.type === 'CONSTRAINT');
  const invariants = iuNodes.filter(n => n.type === 'INVARIANT');
  const definitions = iuNodes.filter(n => n.type === 'DEFINITION');

  if (requirements.length > 0) {
    lines.push('## Requirements');
    for (const r of requirements) {
      lines.push(`- ${lab(r.canon_id)}${r.statement}`);
    }
    lines.push('');
  }

  if (constraints.length > 0) {
    lines.push('## Constraints');
    for (const c of constraints) {
      lines.push(`- ${lab(c.canon_id)}${c.statement}`);
    }
    lines.push('');
  }

  if (invariants.length > 0) {
    lines.push('## Invariants');
    for (const inv of invariants) {
      lines.push(`- ${lab(inv.canon_id)}${inv.statement}`);
    }
    lines.push('');
  }

  if (definitions.length > 0) {
    lines.push('## Definitions');
    for (const d of definitions) {
      lines.push(`- ${d.statement}`);
    }
    lines.push('');
  }

  // Related context: DEFINITION and CONTEXT nodes from the same spec not in this IU
  if (target) {
    const otherNodes = canonNodes.filter(n =>
      !iu.source_canon_ids.includes(n.canon_id) &&
      (n.type === 'DEFINITION' || n.type === 'CONTEXT')
    );
    if (otherNodes.length > 0) {
      lines.push('## Related Context (from other sections of the same spec)');
      for (const n of otherNodes) {
        lines.push(`- [${n.type}] ${n.statement}`);
      }
      lines.push('');
    }
  }

  // Contract
  if (iu.contract.inputs.length > 0) {
    lines.push(`## Inputs: ${iu.contract.inputs.join(', ')}`);
  }
  if (iu.contract.outputs.length > 0) {
    lines.push(`## Outputs: ${iu.contract.outputs.join(', ')}`);
  }
  lines.push(`## Risk Tier: ${iu.risk_tier}`);
  lines.push('');

  // Context: sibling modules with mount paths for architecture mode
  if (siblingModules && siblingModules.length > 0) {
    if (target) {
      lines.push(`## Other API modules (do NOT import them — call their HTTP endpoints from JavaScript):`);
      for (const m of siblingModules) {
        const lowerName = m.toLowerCase();
        const isWebUI = /\b(web|ui|frontend|interface|page|dashboard)\b/.test(lowerName);
        if (isWebUI) continue; // skip other web modules
        const mountPath = '/' + lowerName.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        lines.push(`- "${m}" mounted at ${mountPath} — use fetch('${mountPath}') or fetch('${mountPath}/...') to call it`);
      }
    } else {
      lines.push(`## Other modules in this service (for context, do NOT import them):`);
      for (const m of siblingModules) {
        lines.push(`- ${m}`);
      }
    }
    lines.push('');
  }

  // Provenance annotations — let the model cite which requirement each line implements
  if (labels.length > 0) {
    lines.push('## Provenance annotations (required)');
    lines.push('The requirements/constraints/invariants above are tagged with short labels in [brackets], e.g. [R1], [C1], [I1].');
    lines.push('When a line of code implements one of them, append a marker comment at the END of that line: //phx:<label>');
    lines.push("Example:  router.post('/login', login);  //phx:R1");
    lines.push('Use the single most specific label. Add nothing for lines that map to no requirement. Never put the marker on its own line.');
    lines.push('');
  }

  // Phoenix metadata
  lines.push('## Required metadata export');
  lines.push('Include this exact constant at the end of the module:');
  lines.push('```');
  lines.push(`/** @internal Phoenix VCS traceability — do not remove. */`);
  lines.push(`export const _phoenix = {`);
  lines.push(`  iu_id: '${iu.iu_id}',`);
  lines.push(`  name: '${iu.name}',`);
  lines.push(`  risk_tier: '${iu.risk_tier}',`);
  lines.push(`  canon_ids: [${iu.source_canon_ids.length} as const],`);
  lines.push(`} as const;`);
  lines.push('```');
  lines.push('');

  // Architecture patterns (few-shot examples)
  if (target?.runtime.codeExamples) {
    lines.push(target.runtime.codeExamples);
    lines.push('');
  }

  lines.push('Output the complete TypeScript module now.');

  return lines.join('\n');
}
