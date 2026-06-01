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
 * The gate compiles the project via the TARGET's compiler (tsc, go build, pyright…),
 * and if the LLM is available, repairs the offending generated files (feeding the
 * compiler's own errors back) for a few rounds. Whatever remains is surfaced and
 * recorded — the truth about the build. All language specifics live in the target.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LLMProvider } from './llm/provider.js';
import type { ImplementationUnit } from './models/iu.js';
import { buildFixPrompt, cleanCodeResponse } from './codegen-util.js';
import { getSystemPrompt } from './llm/prompt.js';
import type { ResolvedTarget, CompileError } from './models/architecture.js';

export type { CompileError };

export interface CompileGateResult {
  ok: boolean;
  rounds: number;
  /** Files rewritten by the repair loop (project-relative). */
  repaired: string[];
  /** Errors still present after the gate gave up. */
  unresolved: CompileError[];
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
  const rt = opts.target?.runtime ?? null;
  // Compile via the target's compiler (or an injected one in tests). No target +
  // no injected check → nothing to compile, treat as clean.
  const typecheck = opts.typecheck ?? (rt ? (root: string) => rt.compile(root) : () => []);
  const owns = (file: string): boolean =>
    rt ? rt.ownsGeneratedFile(file) : file.startsWith('src/generated/');
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
      if (!owns(e.file)) continue;
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

  // The target's extra source gate (e.g. inline-<script> validation) is part of "does
  // the system actually work" — fold its findings into the unresolved set.
  const inlineErrors = rt?.validateSource ? collectSourceGateErrors(projectRoot, rt.validateSource, opts.ius) : [];

  const unresolved = [...errors, ...inlineErrors];
  return { ok: unresolved.length === 0, rounds: round, repaired: [...repaired], unresolved };
}

/** Run the target's optional extra source gate over every generated file. */
function collectSourceGateErrors(
  projectRoot: string,
  validate: (code: string) => string | null,
  ius?: ImplementationUnit[],
): CompileError[] {
  const out: CompileError[] = [];
  for (const iu of ius ?? []) {
    for (const file of iu.output_files) {
      const full = join(projectRoot, file);
      if (!existsSync(full)) continue;
      const err = validate(readFileSync(full, 'utf8'));
      if (err) {
        out.push({ file, line: 0, col: 0, code: 'SOURCE_GATE', message: err.split('.')[0], raw: `${file}: ${err.split('.')[0]}` });
      }
    }
  }
  return out;
}
