/**
 * Compile Gate — the assembled system must compile, honestly.
 *
 * The per-IU typecheck during generation runs with incomplete sibling context (an IU
 * is generated before its siblings exist), so cross-module and late-surfacing type
 * errors slip through and ship. In Phoenix's terms a module that does not typecheck is
 * not "regenerable" — it isn't even evaluable. The build itself is the most basic eval,
 * so it must gate the WHOLE assembled project after every IU + scaffold is written, and
 * a failure must be loud and block readiness — never swallowed under a green ✔.
 *
 * The gate runs `tsc` over the project, and if the LLM is available, repairs the
 * offending generated files (feeding tsc's own errors back) for a few rounds. Whatever
 * remains is surfaced as diagnostics and recorded — the truth about the build.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LLMProvider } from './llm/provider.js';
import type { ImplementationUnit } from './models/iu.js';
import { buildFixPrompt, cleanCodeResponse, validateInlineScripts } from './regen.js';
import { getSystemPrompt } from './llm/prompt.js';
import type { ResolvedTarget } from './models/architecture.js';

export interface CompileError {
  file: string;        // project-relative path, as tsc reports it
  line: number;
  col: number;
  code: string;        // e.g. 'TS18048'
  message: string;
  raw: string;         // the original tsc line
}

export interface CompileGateResult {
  ok: boolean;
  rounds: number;
  /** Files rewritten by the repair loop (project-relative). */
  repaired: string[];
  /** Errors still present after the gate gave up. */
  unresolved: CompileError[];
}

const TSC_LINE = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/;

/** Parse `tsc --noEmit` output into structured errors. */
export function parseTscOutput(output: string): CompileError[] {
  const errors: CompileError[] = [];
  for (const line of output.split('\n')) {
    const m = line.match(TSC_LINE);
    if (m) {
      errors.push({ file: m[1].trim(), line: +m[2], col: +m[3], code: m[4], message: m[5].trim(), raw: line.trim() });
    }
  }
  return errors;
}

/** Run `tsc --noEmit` over the whole project. Returns [] when the project compiles. */
export function typecheckProject(projectRoot: string): CompileError[] {
  try {
    execSync('npx tsc --noEmit 2>&1', { cwd: projectRoot, stdio: 'pipe', timeout: 120_000 });
    return [];
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const out = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
    return parseTscOutput(out);
  }
}

/** Only files Phoenix generated are ours to repair; never touch hand-written scaffold. */
function isRepairable(file: string): boolean {
  return file.startsWith('src/generated/') && !file.endsWith('_migrations.ts');
}

export interface CompileGateOptions {
  llm?: LLMProvider;
  target?: ResolvedTarget | null;
  ius?: ImplementationUnit[];
  maxRounds?: number;
  /** Injectable for tests; defaults to the real project typecheck. */
  typecheck?: (projectRoot: string) => CompileError[];
  /** Called when a generated file is rewritten, so callers can refresh manifests/NK. */
  onRepair?: (file: string, iu: ImplementationUnit | undefined) => void;
  /** Called once per round with the current error set, for progress reporting. */
  onRound?: (round: number, errors: CompileError[]) => void;
}

/**
 * Run the compile gate: typecheck the assembled project and, while the LLM is
 * available, repair offending generated files using tsc's own errors as the spec.
 */
export async function runCompileGate(
  projectRoot: string,
  opts: CompileGateOptions = {},
): Promise<CompileGateResult> {
  const typecheck = opts.typecheck ?? typecheckProject;
  const maxRounds = opts.maxRounds ?? 3;
  const repaired = new Set<string>();
  const system = getSystemPrompt(opts.target);
  const iuFor = (file: string): ImplementationUnit | undefined =>
    opts.ius?.find(iu => iu.output_files.includes(file));

  let round = 0;
  let errors = typecheck(projectRoot);

  while (errors.length > 0 && round < maxRounds) {
    opts.onRound?.(round + 1, errors);

    // Group this round's errors by the file that owns them; only repair our files.
    const byFile = new Map<string, CompileError[]>();
    for (const e of errors) {
      if (!isRepairable(e.file)) continue;
      (byFile.get(e.file) ?? byFile.set(e.file, []).get(e.file)!).push(e);
    }

    // If every remaining error is in a file we won't touch, we cannot make progress.
    if (byFile.size === 0 || !opts.llm) break;

    let madeEdit = false;
    for (const [file, errs] of byFile) {
      const full = join(projectRoot, file);
      if (!existsSync(full)) continue;
      const code = readFileSync(full, 'utf8');
      const fixPrompt = buildFixPrompt(code, errs.map(e => e.raw).join('\n'));
      let fixed: string;
      try {
        fixed = cleanCodeResponse(await opts.llm.generate(fixPrompt, { system, temperature: 0.1, maxTokens: 16384 }));
      } catch {
        continue; // transient LLM failure — leave the file, try next round
      }
      if (!fixed.trim() || fixed === code) continue;
      writeFileSync(full, fixed, 'utf8');
      repaired.add(file);
      madeEdit = true;
      opts.onRepair?.(file, iuFor(file));
    }

    if (!madeEdit) break;   // nothing changed — re-checking would loop forever
    round++;
    errors = typecheck(projectRoot);
  }

  // Inline-script validation is part of "does the system actually work" — fold any
  // browser-JS syntax errors in repaired/generated UI files into the unresolved set.
  const inlineErrors = collectInlineScriptErrors(projectRoot, opts.ius);

  const unresolved = [...errors, ...inlineErrors];
  return { ok: unresolved.length === 0, rounds: round, repaired: [...repaired], unresolved };
}

/** Browser-JS syntax errors that tsc cannot see (inside c.html template literals). */
function collectInlineScriptErrors(projectRoot: string, ius?: ImplementationUnit[]): CompileError[] {
  const out: CompileError[] = [];
  for (const iu of ius ?? []) {
    for (const file of iu.output_files) {
      const full = join(projectRoot, file);
      if (!existsSync(full)) continue;
      const err = validateInlineScripts(readFileSync(full, 'utf8'));
      if (err) {
        out.push({ file, line: 0, col: 0, code: 'INLINE_JS', message: err.split('.')[0], raw: `${file}: ${err.split('.')[0]}` });
      }
    }
  }
  return out;
}
