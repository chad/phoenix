/**
 * Prompt Builder — constructs LLM prompts from IU contracts.
 *
 * Turns the structured IU (requirements, constraints, invariants,
 * inputs, outputs) into a prompt that produces working TypeScript.
 */

import type { ImplementationUnit } from '../models/iu.js';
import type { CanonicalNode } from '../models/canonical.js';
import type { Architecture } from '../models/architecture.js';

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
export function getSystemPrompt(arch?: Architecture | null): string {
  if (!arch) return SYSTEM_PROMPT;

  const allowedPkgs = Object.keys(arch.packages).map(p => `'${p}'`).join(', ');

  // Build a fresh system prompt for architecture mode — don't try to patch the generic one
  return `You are a senior TypeScript engineer generating production-quality module implementations.

Rules:
- Output ONLY the TypeScript module code. No markdown fences, no explanation.
- The module must be a valid ES module (.ts) that compiles under strict mode.
- Export all public functions and types.
- Use descriptive types (not \`any\` or \`unknown\` where a real type is appropriate).
- Implement the actual logic described in the requirements — not stubs or TODOs.
- Keep the code clean, readable, and minimal. No over-engineering.
- Include the _phoenix metadata constant exactly as specified.
- You MUST import from these packages: ${allowedPkgs}. Use them as shown in the architecture examples below.
- You may also use Node.js built-in modules (node:crypto, node:path, etc.).
- Do NOT import any other packages. Do NOT re-implement functionality that the allowed packages provide.
- Do NOT define your own Hono, Database, or Zod types — import them from the packages.
- The code must compile under TypeScript strict mode (strict: true, no implicit any).
- If the requirements describe validation rules, use Zod schemas.
${arch.systemPromptExtension}`;
}

/**
 * Build the user prompt for generating an IU implementation.
 */
export function buildPrompt(
  iu: ImplementationUnit,
  canonNodes: CanonicalNode[],
  siblingModules?: string[],
  arch?: Architecture | null,
): string {
  const lines: string[] = [];

  lines.push(`Generate a TypeScript module implementing "${iu.name}".`);
  lines.push('');

  // For architecture mode, inject the mandatory imports at the top of the prompt
  if (arch) {
    lines.push('## MANDATORY: Your module MUST start with these exact imports');
    lines.push('```');
    lines.push(`import { Hono } from 'hono';`);
    lines.push(`import { db, registerMigration } from '../../db.js';`);
    lines.push(`import { z } from 'zod';`);
    lines.push('```');
    lines.push('Do NOT import Database from better-sqlite3. Do NOT create new Database(). Use the db import above.');
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
      lines.push(`- ${r.statement}`);
    }
    lines.push('');
  }

  if (constraints.length > 0) {
    lines.push('## Constraints');
    for (const c of constraints) {
      lines.push(`- ${c.statement}`);
    }
    lines.push('');
  }

  if (invariants.length > 0) {
    lines.push('## Invariants');
    for (const inv of invariants) {
      lines.push(`- ${inv.statement}`);
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
  if (arch) {
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
    if (arch) {
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
  if (arch?.codeExamples) {
    lines.push(arch.codeExamples);
    lines.push('');
  }

  lines.push('Output the complete TypeScript module now.');

  return lines.join('\n');
}
