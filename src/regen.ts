/**
 * Regeneration Engine — generates code for each IU.
 *
 * Two modes:
 * - Stub mode (no LLM): produces typed skeletons with throw stubs.
 * - LLM mode: sends IU contract + canonical requirements to an LLM
 *   and produces real, working implementations.
 *
 * The LLM provider is pluggable (Anthropic, OpenAI, etc.)
 * and auto-detected from env vars.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ImplementationUnit } from './models/iu.js';
import type { CanonicalNode } from './models/canonical.js';
import type { IUManifest, RegenMetadata, FileManifestEntry } from './models/manifest.js';
import type { LLMProvider } from './llm/provider.js';
import { buildPrompt, getSystemPrompt } from './llm/prompt.js';
import type { Architecture } from './models/architecture.js';
import { sha256 } from './semhash.js';

const TOOLCHAIN_VERSION = 'phoenix-regen/0.1.0';

export interface RegenResult {
  iu_id: string;
  files: Map<string, string>;    // path → content
  manifest: IUManifest;
}

export interface RegenContext {
  /** LLM provider for real code generation. Omit for stub mode. */
  llm?: LLMProvider;
  /** All canonical nodes (needed for LLM prompt context). */
  canonNodes?: CanonicalNode[];
  /** All IUs (for sibling module context). */
  allIUs?: ImplementationUnit[];
  /** Project root directory (for typecheck-and-retry). */
  projectRoot?: string;
  /** Architecture target (e.g., sqlite-web-api). */
  architecture?: Architecture | null;
  /** Callback for progress reporting. */
  onProgress?: (iu: ImplementationUnit, status: 'start' | 'done' | 'error', message?: string) => void;
}

/**
 * Generate code for a single IU.
 * Uses LLM if provided in context, otherwise falls back to stubs.
 */
export async function generateIU(iu: ImplementationUnit, ctx?: RegenContext): Promise<RegenResult> {
  const files = new Map<string, string>();
  const modelId = ctx?.llm ? `${ctx.llm.name}/${ctx.llm.model}` : 'stub-generator/1.0';

  for (const outputPath of iu.output_files) {
    let content: string;

    if (ctx?.llm && ctx.canonNodes) {
      ctx.onProgress?.(iu, 'start', `Generating ${iu.name} via ${ctx.llm.name}…`);
      try {
        content = await generateWithLLM(iu, ctx.llm, ctx.canonNodes, ctx.allIUs, ctx.projectRoot, ctx.architecture);
        ctx.onProgress?.(iu, 'done');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.onProgress?.(iu, 'error', msg);
        // Fall back to stub on LLM failure
        content = ctx.architecture ? generateArchStub(iu) : generateModule(iu);
      }
    } else {
      content = ctx?.architecture ? generateArchStub(iu) : generateModule(iu);
    }

    files.set(outputPath, content);
  }

  // Build manifest entries
  const fileEntries: Record<string, FileManifestEntry> = {};
  for (const [path, content] of files) {
    fileEntries[path] = {
      path,
      content_hash: sha256(content),
      size: content.length,
    };
  }

  const now = new Date().toISOString();
  const promptpackHash = sha256(JSON.stringify(iu.contract));

  const metadata: RegenMetadata = {
    model_id: modelId,
    promptpack_hash: promptpackHash,
    toolchain_version: TOOLCHAIN_VERSION,
    generated_at: now,
  };

  return {
    iu_id: iu.iu_id,
    files,
    manifest: {
      iu_id: iu.iu_id,
      iu_name: iu.name,
      files: fileEntries,
      regen_metadata: metadata,
    },
  };
}

/**
 * Generate code for all IUs. Runs sequentially to respect LLM rate limits.
 */
export async function generateAll(ius: ImplementationUnit[], ctx?: RegenContext): Promise<RegenResult[]> {
  const results: RegenResult[] = [];
  for (const iu of ius) {
    results.push(await generateIU(iu, ctx));
  }
  return results;
}

// ─── LLM Generation ─────────────────────────────────────────────────────────

const MAX_RETRIES = 2;

/**
 * Generate code for an IU using an LLM provider.
 * Includes typecheck-and-retry: if the generated code has TS errors,
 * feed them back to the LLM for a fix attempt.
 */
async function generateWithLLM(
  iu: ImplementationUnit,
  llm: LLMProvider,
  canonNodes: CanonicalNode[],
  allIUs?: ImplementationUnit[],
  projectRoot?: string,
  arch?: Architecture | null,
): Promise<string> {
  // Find sibling modules in the same service
  const iuDir = iu.output_files[0]?.split('/').slice(0, -1).join('/');
  const siblings = allIUs
    ?.filter(other => other.iu_id !== iu.iu_id && other.output_files[0]?.startsWith(iuDir || ''))
    .map(other => other.name) ?? [];

  const systemPrompt = getSystemPrompt(arch);
  const prompt = buildPrompt(iu, canonNodes, siblings, arch);

  let code = cleanCodeResponse(await llm.generate(prompt, {
    system: systemPrompt,
    temperature: 0.2,
    maxTokens: 8192,
  }));

  // Typecheck-and-retry loop
  if (projectRoot && iu.output_files[0]) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const errors = typecheckFile(projectRoot, iu.output_files[0], code);
      if (!errors) break; // clean!

      // Feed errors back to LLM
      const fixPrompt = buildFixPrompt(code, errors);
      code = cleanCodeResponse(await llm.generate(fixPrompt, {
        system: systemPrompt,
        temperature: 0.1,
        maxTokens: 8192,
      }));
    }
  }

  return code;
}

const MINIMAL_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'Node16',
    moduleResolution: 'Node16',
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    outDir: 'dist',
    rootDir: 'src',
  },
  include: ['src'],
}, null, 2);

/**
 * Typecheck a single file by writing it to disk and running tsc.
 * Returns error output or null if clean.
 */
function typecheckFile(projectRoot: string, filePath: string, content: string): string | null {
  const fullPath = join(projectRoot, filePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');

  // Ensure tsconfig.json exists for tsc
  const tsconfigPath = join(projectRoot, 'tsconfig.json');
  const hadTsconfig = existsSync(tsconfigPath);
  if (!hadTsconfig) {
    writeFileSync(tsconfigPath, MINIMAL_TSCONFIG, 'utf8');
  }

  try {
    execSync('npx tsc --noEmit 2>&1', {
      cwd: projectRoot,
      timeout: 30000,
      stdio: 'pipe',
    });
    return null; // clean
  } catch (err: unknown) {
    const execErr = err as { stdout?: Buffer; stderr?: Buffer };
    const output = (execErr.stdout?.toString() || '') + (execErr.stderr?.toString() || '');
    // Filter to only errors from this file
    const fileErrors = output
      .split('\n')
      .filter(line => line.includes(filePath))
      .join('\n')
      .trim();
    return fileErrors || output.trim();
  }
}

/**
 * Build a prompt asking the LLM to fix typecheck errors.
 */
function buildFixPrompt(code: string, errors: string): string {
  return `The following TypeScript module has compilation errors. Fix them.

## Current code:
\`\`\`typescript
${code}
\`\`\`

## TypeScript errors:
${errors}

## Rules:
- Output ONLY the fixed TypeScript module. No markdown fences, no explanation.
- Do NOT import external packages. Use only Node.js built-in modules.
- For WebSocket features, use node:http — do NOT import 'ws'.
- For DOM/browser code, use string HTML templates — no DOM APIs.
- The code must compile under strict mode.
- Keep all existing exports and the _phoenix metadata constant.

Output the complete fixed TypeScript module now.`;
}

/**
 * Strip markdown code fences from LLM response.
 */
function cleanCodeResponse(raw: string): string {
  let code = raw.trim();

  // Remove ```typescript ... ``` or ```ts ... ``` or ``` ... ```
  const fenceMatch = code.match(/^```(?:typescript|ts)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) {
    code = fenceMatch[1];
  }

  // Also handle case where there's text before/after the fence
  const innerMatch = code.match(/```(?:typescript|ts)?\s*\n([\s\S]*?)\n```/);
  if (innerMatch && innerMatch[1].includes('export')) {
    code = innerMatch[1];
  }

  return code;
}

// ─── Module Generation ───────────────────────────────────────────────────────

/**
 * Generate a minimal Hono router stub for architecture mode.
 * Ensures fallback code still produces a valid default-export router.
 */
function generateArchStub(iu: ImplementationUnit): string {
  return `import { Hono } from 'hono';

const router = new Hono();

router.get('/', (c) => c.json({ stub: true, module: '${iu.name}', message: 'Not yet implemented' }));

export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '${iu.iu_id}',
  name: '${iu.name}',
  risk_tier: '${iu.risk_tier}',
  canon_ids: [${iu.source_canon_ids.length} as const],
} as const;
`;
}

/**
 * Generate a natural TypeScript module from an IU contract.
 */
function generateModule(iu: ImplementationUnit): string {
  const lines: string[] = [];
  const moduleName = toPascalCase(iu.name);
  const configName = `${moduleName}Config`;

  // Header
  lines.push(`/**`);
  lines.push(` * ${iu.name}`);
  lines.push(` *`);
  lines.push(` * AUTO-GENERATED by Phoenix VCS — DO NOT EDIT DIRECTLY`);
  lines.push(` * Risk Tier: ${iu.risk_tier}`);
  lines.push(` */`);
  lines.push('');

  // Config interface from constraints/invariants
  if (iu.contract.invariants.length > 0) {
    const fields = iu.contract.invariants
      .map(inv => ({ inv, field: constraintToConfigField(inv) }))
      .filter((x): x is { inv: string; field: { name: string; type: string } } => x.field !== null);

    if (fields.length > 0) {
      lines.push(`/**`);
      lines.push(` * Configuration and constraints for ${iu.name}.`);
      lines.push(` */`);
      lines.push(`export interface ${configName} {`);
      for (const { inv, field } of fields) {
        lines.push(`  /** ${inv} */`);
        lines.push(`  ${field.name}: ${field.type};`);
      }
      lines.push('}');
      lines.push('');
    }
  }

  // Input/output interfaces
  const inputTypeName = `${moduleName}Input`;
  const outputTypeName = `${moduleName}Result`;

  if (iu.contract.inputs.length > 0) {
    lines.push(`export interface ${inputTypeName} {`);
    for (const inp of iu.contract.inputs) {
      lines.push(`  ${inp}: unknown;`);
    }
    lines.push('}');
    lines.push('');
  }

  if (iu.contract.outputs.length > 0) {
    lines.push(`export interface ${outputTypeName} {`);
    for (const out of iu.contract.outputs) {
      lines.push(`  ${out}: unknown;`);
    }
    lines.push('}');
    lines.push('');
  }

  // Extract distinct operations from requirement statements
  const operations = extractOperations(iu);

  // Collect and emit placeholder types referenced by operations
  if (operations.length > 0) {
    const builtinTypes = new Set(['unknown', 'void', 'boolean', 'string', 'number', 'object',
      inputTypeName, outputTypeName, configName]);
    const placeholders = new Set<string>();
    for (const op of operations) {
      for (const t of extractTypeRefs(op.params, op.returnType)) {
        if (!builtinTypes.has(t)) placeholders.add(t);
      }
    }
    if (placeholders.size > 0) {
      for (const t of placeholders) {
        lines.push(`/** Placeholder type — replace with your domain model. */`);
        lines.push(`export type ${t} = Record<string, unknown>;`);
        lines.push('');
      }
    }
  }

  if (operations.length > 0) {
    for (const op of operations) {
      lines.push(`/**`);
      lines.push(` * ${op.description}`);
      lines.push(` */`);
      lines.push(`export function ${op.name}(${op.params}): ${op.returnType} {`);
      lines.push(`  // TODO: implement`);
      lines.push(`  throw new Error('Not implemented: ${op.name}');`);
      lines.push('}');
      lines.push('');
    }
  } else {
    // Fallback: single entry-point function
    const funcName = toCamelCase(iu.name);
    const params = iu.contract.inputs.length > 0
      ? `input: ${inputTypeName}`
      : '';
    const ret = iu.contract.outputs.length > 0 ? outputTypeName : 'void';
    lines.push(`/**`);
    lines.push(` * ${iu.contract.description.split('.')[0] || iu.name}.`);
    lines.push(` */`);
    lines.push(`export function ${funcName}(${params}): ${ret} {`);
    lines.push(`  // TODO: implement`);
    lines.push(`  throw new Error('Not implemented: ${funcName}');`);
    lines.push('}');
    lines.push('');
  }

  // Phoenix metadata (compact)
  lines.push(`/** @internal Phoenix VCS traceability — do not remove. */`);
  lines.push(`export const _phoenix = {`);
  lines.push(`  iu_id: '${iu.iu_id}',`);
  lines.push(`  name: '${iu.name}',`);
  lines.push(`  risk_tier: '${iu.risk_tier}',`);
  lines.push(`  canon_ids: [${iu.source_canon_ids.length} as const],`);
  lines.push('} as const;');
  lines.push('');

  return lines.join('\n');
}

// ─── Operation Extraction ────────────────────────────────────────────────────

interface Operation {
  name: string;
  description: string;
  params: string;
  returnType: string;
}

/**
 * Extract distinct function operations from an IU's canonical requirements.
 * Looks for verb patterns in requirement statements and deduplicates.
 */
function extractOperations(iu: ImplementationUnit): Operation[] {
  const ops: Operation[] = [];
  const seenNames = new Set<string>();

  // Parse requirements for action verbs
  const patterns: { pattern: RegExp; verb: string }[] = [
    { pattern: /\bmust (?:support |handle )?creat(?:e|ing)\b/i, verb: 'create' },
    { pattern: /\bmust (?:support |handle )?validat(?:e|ing)\b/i, verb: 'validate' },
    { pattern: /\bmust (?:support |handle )?verif(?:y|ying)\b/i, verb: 'verify' },
    { pattern: /\bmust (?:support |handle )?authenticat(?:e|ing)\b/i, verb: 'authenticate' },
    { pattern: /\bmust (?:support |handle )?delet(?:e|ing)\b/i, verb: 'delete' },
    { pattern: /\bmust (?:support |handle )?updat(?:e|ing)\b/i, verb: 'update' },
    { pattern: /\bmust (?:support |handle )?search(?:ing)?\b/i, verb: 'search' },
    { pattern: /\bmust (?:support |handle )?send(?:ing)?\b/i, verb: 'send' },
    { pattern: /\bmust (?:support |handle )?deliver(?:y|ing)?\b/i, verb: 'deliver' },
    { pattern: /\bmust (?:support |handle )?publish(?:ing)?\b/i, verb: 'publish' },
    { pattern: /\bmust (?:support |handle )?rout(?:e|ing)\b/i, verb: 'route' },
    { pattern: /\bmust (?:support |handle )?log(?:ging)?\b/i, verb: 'log' },
    { pattern: /\bmust (?:support |handle )?reject(?:ed|ing)?\b/i, verb: 'reject' },
    { pattern: /\bmust (?:be )?rate.?limit(?:ed|ing)?\b/i, verb: 'rateLimit' },
    { pattern: /\bmust (?:support |handle )?retr(?:y|ying|ied)\b/i, verb: 'retry' },
    { pattern: /\bmust (?:support |handle )?configur(?:e|ing|able)\b/i, verb: 'configure' },
    { pattern: /\bmust (?:support |handle )?expos(?:e|ing)\b/i, verb: 'expose' },
    { pattern: /\bmust (?:support |handle )?implement(?:ing)?\b/i, verb: 'handle' },
    { pattern: /\bmust (?:support |handle )?inject(?:ing)?\b/i, verb: 'inject' },
    { pattern: /\bmust (?:support |handle )?stor(?:e|ing)\b/i, verb: 'store' },
    { pattern: /\bmust (?:support |handle )?archiv(?:e|ing)\b/i, verb: 'archive' },
    { pattern: /\bmust (?:support |handle )?mark(?:ing)?\b/i, verb: 'mark' },
    { pattern: /\bmust (?:support |handle )?process(?:ing|ed)?\b/i, verb: 'process' },
  ];

  // Group requirements by detected verb
  const verbGroups = new Map<string, string[]>();
  const moduleName = toPascalCase(iu.name);

  for (const statement of iu.contract.description.split('. ').filter(Boolean)) {
    for (const { pattern, verb } of patterns) {
      if (pattern.test(statement)) {
        const list = verbGroups.get(verb) ?? [];
        list.push(statement);
        verbGroups.set(verb, list);
        break; // one verb per statement
      }
    }
  }

  // Generate one function per unique verb
  for (const [verb, statements] of verbGroups) {
    if (seenNames.has(verb)) continue;
    seenNames.add(verb);

    // Derive params from the object being acted on
    const subject = extractSubject(statements[0], verb);
    const paramName = subject ? toCamelCase(subject) : 'input';
    const paramType = subject ? toPascalCase(subject) : 'unknown';

    ops.push({
      name: verb,
      description: statements[0],
      params: `${paramName}: ${paramType}`,
      returnType: verb === 'validate' || verb === 'verify'
        ? 'boolean'
        : verb === 'search'
          ? `${paramType}[]`
          : verb === 'delete' || verb === 'log' || verb === 'archive' || verb === 'mark'
            ? 'void'
            : paramType,
    });
  }

  // Limit to reasonable number
  return ops.slice(0, 8);
}

/**
 * Try to extract the object/subject from a requirement statement.
 * "the service must validate JWT tokens" → "token"
 * "the gateway must reject expired tokens" → "token"
 */
function extractSubject(statement: string, verb: string): string | null {
  // Pattern: "must <verb> <object>"
  const regex = new RegExp(`must\\s+(?:support\\s+|handle\\s+)?${verb}\\w*\\s+(.+?)(?:\\s+(?:with|from|to|for|on|in|at|by|using|via|when|after|before)\\b|[.;,]|$)`, 'i');
  const match = statement.match(regex);
  if (match) {
    const raw = match[1]
      .replace(/^(?:a|an|the|all|each|every|new)\s+/i, '')
      .replace(/\s*\(.*?\)/g, '')
      .trim();
    // Take the core noun — typically 1-2 meaningful words
    const words = raw.split(/\s+/)
      .filter(w => w.length > 1)
      .slice(0, 2);
    if (words.length > 0) {
      // Singularize simple plurals
      const noun = words[words.length - 1].replace(/s$/, '');
      words[words.length - 1] = noun;
      return words.join(' ');
    }
  }
  return null;
}

/**
 * Convert a constraint statement to a config field.
 * Returns null for constraints that are better expressed as code logic
 * rather than configuration.
 */
function constraintToConfigField(constraint: string): { name: string; type: string } | null {
  // Numeric limits: "rate limited to 5 per minute", "limited to 100 characters"
  const numMatch = constraint.match(/(\d+)\s*(per\s+\w+|characters|bytes|kb|mb|seconds?|minutes?|hours?|days?|retries|attempts)/i);
  if (numMatch) {
    const unit = numMatch[2].replace(/\s+/g, '').toLowerCase();
    const subject = extractConstraintSubject(constraint);
    if (/rate.?limit/i.test(constraint)) {
      return { name: `${subject}RateLimitPer${capitalize(unit)}`, type: 'number' };
    }
    if (/expir|ttl|window/i.test(constraint)) {
      return { name: `${subject}Ttl${capitalize(unit)}`, type: 'number' };
    }
    return { name: `${subject}Max${capitalize(unit)}`, type: 'number' };
  }

  // Configurable things: "CORS headers must be configurable per route"
  if (/\bconfigurable\b/i.test(constraint)) {
    const subject = extractConstraintSubject(constraint);
    return { name: `${subject}Config`, type: 'Record<string, unknown>' };
  }

  // Skip vague "must not" / "never" constraints — they're invariants, not config
  return null;
}

/**
 * Extract a short subject identifier from a constraint.
 * "the service must not send more than 10 emails" → "email"
 */
function extractConstraintSubject(statement: string): string {
  // Find the most specific noun near the numbers/keywords
  const words = statement
    .toLowerCase()
    .replace(/\b(?:the|a|an|must|be|is|are|not|no|shall|never|always|service|gateway|system)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2);

  // Pick the most meaningful word (skip common verbs)
  const skip = new Set(['send', 'store', 'access', 'more', 'than', 'per', 'with', 'for', 'from', 'limited', 'exceed', 'larger']);
  const meaningful = words.filter(w => !skip.has(w));
  return toCamelCase(meaningful.slice(0, 2).join(' ')) || 'value';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Extract type references from param and return type strings.
 * "jwtToken: JwtToken" → ["JwtToken"]
 * "User[]" → ["User"]
 */
function extractTypeRefs(params: string, returnType: string): string[] {
  const types: string[] = [];
  // From params: "name: Type" patterns
  const paramMatches = params.matchAll(/:\s*([A-Z][A-Za-z0-9]*)/g);
  for (const m of paramMatches) types.push(m[1]);
  // From return type
  const retMatch = returnType.replace(/\[\]$/, '');
  if (/^[A-Z]/.test(retMatch)) types.push(retMatch);
  return types;
}

// ─── Naming Utilities ────────────────────────────────────────────────────────

function toCamelCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}
