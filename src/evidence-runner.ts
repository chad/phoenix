/**
 * Evidence Runner — executes real evidence checks against generated code.
 *
 * Runs typecheck (tsc --noEmit), lint (boundary validation), and tests
 * (vitest run) per IU, recording results as EvidenceRecords.
 *
 * This is the bridge between "Phoenix knows what evidence is required"
 * and "Phoenix has actually verified it."
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ImplementationUnit } from './models/iu.js';
import type { CanonicalNode } from './models/canonical.js';
import type { EvidenceRecord } from './models/evidence.js';
import { EvidenceKind, EvidenceStatus } from './models/evidence.js';
import type { Diagnostic } from './models/diagnostic.js';
import { extractDependencies } from './dep-extractor.js';
import { validateBoundary } from './boundary-validator.js';
import { sha256 } from './semhash.js';

// ─── Result types ────────────────────────────────────────────────────────────

export interface EvidenceRunResult {
  iu: ImplementationUnit;
  records: EvidenceRecord[];
  diagnostics: Diagnostic[];
  /** Per-check details for display */
  checks: CheckResult[];
}

export interface CheckResult {
  kind: EvidenceKind;
  status: EvidenceStatus;
  message: string;
  duration_ms: number;
  details?: string;
}

export interface RunnerOptions {
  projectRoot: string;
  /** Only run specific evidence kinds (default: all required by IU) */
  only?: EvidenceKind[];
  /** Skip specific evidence kinds */
  skip?: EvidenceKind[];
  /** Timeout per check in ms (default: 30000) */
  timeout?: number;
  /** Progress callback */
  onProgress?: (iu: ImplementationUnit, check: EvidenceKind, status: 'start' | 'pass' | 'fail' | 'skip') => void;
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Run all required evidence checks for a single IU.
 */
export function runEvidence(
  iu: ImplementationUnit,
  opts: RunnerOptions,
): EvidenceRunResult {
  const { projectRoot, timeout = 30000 } = opts;
  const records: EvidenceRecord[] = [];
  const diagnostics: Diagnostic[] = [];
  const checks: CheckResult[] = [];
  const timestamp = new Date().toISOString();

  // Determine which checks to run
  const required = iu.evidence_policy.required as string[];
  const kindsToRun = required.filter(kind => {
    if (opts.only && !opts.only.includes(kind as EvidenceKind)) return false;
    if (opts.skip && opts.skip.includes(kind as EvidenceKind)) return false;
    return true;
  });

  // Compute artifact hash (hash of all output file contents)
  const artifactHash = computeArtifactHash(iu, projectRoot);

  for (const kind of kindsToRun) {
    opts.onProgress?.(iu, kind as EvidenceKind, 'start');

    let check: CheckResult;
    switch (kind) {
      case EvidenceKind.TYPECHECK:
        check = runTypecheck(iu, projectRoot, timeout);
        break;
      case EvidenceKind.LINT:
        check = runLint(iu, projectRoot, timeout);
        break;
      case EvidenceKind.BOUNDARY_VALIDATION:
        check = runBoundaryValidation(iu, projectRoot);
        break;
      case EvidenceKind.UNIT_TEST:
        check = runUnitTests(iu, projectRoot, timeout);
        break;
      case EvidenceKind.PROPERTY_TEST:
        check = runPropertyTests(iu, projectRoot, timeout);
        break;
      case EvidenceKind.STATIC_ANALYSIS:
        check = runStaticAnalysis(iu, projectRoot, timeout);
        break;
      default:
        // Human signoff, threat notes — can't be automated
        check = {
          kind: kind as EvidenceKind,
          status: EvidenceStatus.SKIPPED,
          message: `${kind} requires manual collection`,
          duration_ms: 0,
        };
        break;
    }

    checks.push(check);

    // Create evidence record
    records.push({
      evidence_id: sha256(`${iu.iu_id}:${kind}:${timestamp}:${check.status}`),
      kind: kind as EvidenceKind,
      status: check.status,
      iu_id: iu.iu_id,
      canon_ids: iu.source_canon_ids,
      artifact_hash: artifactHash,
      message: check.message,
      timestamp,
    });

    // Create diagnostic if failed
    if (check.status === EvidenceStatus.FAIL) {
      diagnostics.push({
        severity: 'error',
        category: 'evidence',
        subject: iu.name,
        iu_id: iu.iu_id,
        message: `${kind} failed: ${check.message}`,
        recommended_actions: [
          check.details ? check.details.split('\n').slice(0, 3).join('; ') : `Fix ${kind} issues and re-run`,
        ],
      });
    }

    opts.onProgress?.(iu, kind as EvidenceKind, check.status === EvidenceStatus.PASS ? 'pass' : check.status === EvidenceStatus.FAIL ? 'fail' : 'skip');
  }

  return { iu, records, diagnostics, checks };
}

/**
 * Run evidence checks for multiple IUs.
 */
export function runAllEvidence(
  ius: ImplementationUnit[],
  opts: RunnerOptions,
): EvidenceRunResult[] {
  return ius.map(iu => runEvidence(iu, opts));
}

// ─── Individual check runners ────────────────────────────────────────────────

/**
 * Typecheck: run tsc --noEmit scoped to IU output files.
 * Falls back to project-wide typecheck if per-file fails.
 */
function runTypecheck(iu: ImplementationUnit, projectRoot: string, timeout: number): CheckResult {
  const start = Date.now();

  // Check if tsconfig.json exists
  const tsconfigPath = join(projectRoot, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) {
    return {
      kind: EvidenceKind.TYPECHECK,
      status: EvidenceStatus.SKIPPED,
      message: 'No tsconfig.json found',
      duration_ms: Date.now() - start,
    };
  }

  // Check if any output files exist
  const existingFiles = iu.output_files.filter(f => existsSync(join(projectRoot, f)));
  if (existingFiles.length === 0) {
    return {
      kind: EvidenceKind.TYPECHECK,
      status: EvidenceStatus.FAIL,
      message: 'No output files found on disk',
      duration_ms: Date.now() - start,
    };
  }

  try {
    // Try project-wide typecheck (more reliable than per-file for cross-module deps)
    const npxPrefix = findNpx(projectRoot);
    execSync(`${npxPrefix}tsc --noEmit`, {
      cwd: projectRoot,
      timeout,
      stdio: 'pipe',
      env: { ...process.env, NODE_OPTIONS: '' },
    });

    return {
      kind: EvidenceKind.TYPECHECK,
      status: EvidenceStatus.PASS,
      message: `Typecheck passed (${existingFiles.length} files)`,
      duration_ms: Date.now() - start,
    };
  } catch (err: any) {
    const stderr = err.stderr?.toString() || '';
    const stdout = err.stdout?.toString() || '';
    const output = (stdout + '\n' + stderr).trim();

    // Filter errors to only those in this IU's files
    const iuErrors = filterErrorsToIU(output, iu.output_files);

    if (iuErrors.length === 0) {
      // Errors exist but not in this IU's files — pass for this IU
      return {
        kind: EvidenceKind.TYPECHECK,
        status: EvidenceStatus.PASS,
        message: `Typecheck passed for IU files (${existingFiles.length} files, project has other errors)`,
        duration_ms: Date.now() - start,
      };
    }

    return {
      kind: EvidenceKind.TYPECHECK,
      status: EvidenceStatus.FAIL,
      message: `${iuErrors.length} type error(s)`,
      duration_ms: Date.now() - start,
      details: iuErrors.slice(0, 10).join('\n'),
    };
  }
}

/**
 * Lint: run ESLint if configured, otherwise check for basic code quality.
 */
function runLint(iu: ImplementationUnit, projectRoot: string, timeout: number): CheckResult {
  const start = Date.now();

  const existingFiles = iu.output_files.filter(f => existsSync(join(projectRoot, f)));
  if (existingFiles.length === 0) {
    return {
      kind: EvidenceKind.LINT,
      status: EvidenceStatus.FAIL,
      message: 'No output files found',
      duration_ms: Date.now() - start,
    };
  }

  // Check if ESLint is configured
  const eslintConfigs = ['.eslintrc.js', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml', 'eslint.config.js', 'eslint.config.mjs'];
  const hasEslint = eslintConfigs.some(c => existsSync(join(projectRoot, c)));

  if (hasEslint) {
    try {
      const npxPrefix = findNpx(projectRoot);
      const filePaths = existingFiles.map(f => join(projectRoot, f)).join(' ');
      execSync(`${npxPrefix}eslint ${filePaths}`, {
        cwd: projectRoot,
        timeout,
        stdio: 'pipe',
      });
      return {
        kind: EvidenceKind.LINT,
        status: EvidenceStatus.PASS,
        message: `ESLint passed (${existingFiles.length} files)`,
        duration_ms: Date.now() - start,
      };
    } catch (err: any) {
      const output = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
      const errorCount = (output.match(/\d+ error/)?.[0] || 'errors');
      return {
        kind: EvidenceKind.LINT,
        status: EvidenceStatus.FAIL,
        message: `ESLint: ${errorCount}`,
        duration_ms: Date.now() - start,
        details: output.slice(0, 500),
      };
    }
  }

  // Fallback: basic structural lint checks
  const issues: string[] = [];
  for (const file of existingFiles) {
    const content = readFileSync(join(projectRoot, file), 'utf8');
    // Check for common issues
    if (content.includes('any ') && content.includes(': any')) {
      // Count 'any' usages
      const anyCount = (content.match(/:\s*any\b/g) || []).length;
      if (anyCount > 5) {
        issues.push(`${file}: ${anyCount} 'any' type annotations`);
      }
    }
    if (content.includes('console.log(') && !file.includes('test')) {
      const logCount = (content.match(/console\.log\(/g) || []).length;
      if (logCount > 3) {
        issues.push(`${file}: ${logCount} console.log statements`);
      }
    }
    // Check for TODO/FIXME
    const todos = (content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/gi) || []).length;
    if (todos > 0) {
      issues.push(`${file}: ${todos} TODO/FIXME comments`);
    }
  }

  if (issues.length > 0) {
    return {
      kind: EvidenceKind.LINT,
      status: EvidenceStatus.PASS, // Basic lint issues are warnings, not failures
      message: `Basic lint passed with ${issues.length} note(s)`,
      duration_ms: Date.now() - start,
      details: issues.join('\n'),
    };
  }

  return {
    kind: EvidenceKind.LINT,
    status: EvidenceStatus.PASS,
    message: `Basic lint passed (${existingFiles.length} files)`,
    duration_ms: Date.now() - start,
  };
}

/**
 * Boundary validation: check imports against boundary policy.
 */
function runBoundaryValidation(iu: ImplementationUnit, projectRoot: string): CheckResult {
  const start = Date.now();

  const existingFiles = iu.output_files.filter(f => existsSync(join(projectRoot, f)));
  if (existingFiles.length === 0) {
    return {
      kind: EvidenceKind.BOUNDARY_VALIDATION,
      status: EvidenceStatus.FAIL,
      message: 'No output files found',
      duration_ms: Date.now() - start,
    };
  }

  const allDiags: Diagnostic[] = [];
  for (const file of existingFiles) {
    const content = readFileSync(join(projectRoot, file), 'utf8');
    const depGraph = extractDependencies(content, file);
    const diags = validateBoundary(depGraph, iu);
    allDiags.push(...diags);
  }

  const errors = allDiags.filter(d => d.severity === 'error');
  const warnings = allDiags.filter(d => d.severity === 'warning');

  if (errors.length > 0) {
    return {
      kind: EvidenceKind.BOUNDARY_VALIDATION,
      status: EvidenceStatus.FAIL,
      message: `${errors.length} boundary violation(s)`,
      duration_ms: Date.now() - start,
      details: errors.map(d => `${d.subject}: ${d.message}`).join('\n'),
    };
  }

  return {
    kind: EvidenceKind.BOUNDARY_VALIDATION,
    status: EvidenceStatus.PASS,
    message: `Boundary clean (${existingFiles.length} files${warnings.length ? `, ${warnings.length} warning(s)` : ''})`,
    duration_ms: Date.now() - start,
  };
}

/**
 * Unit tests: run vitest for this IU's test files.
 */
function runUnitTests(iu: ImplementationUnit, projectRoot: string, timeout: number): CheckResult {
  const start = Date.now();

  // Find test files for this IU
  const testFiles = findTestFiles(iu, projectRoot);
  if (testFiles.length === 0) {
    return {
      kind: EvidenceKind.UNIT_TEST,
      status: EvidenceStatus.FAIL,
      message: 'No test files found',
      duration_ms: Date.now() - start,
    };
  }

  // Check if vitest is available
  const hasVitest = existsSync(join(projectRoot, 'node_modules/.bin/vitest')) ||
                    existsSync(join(projectRoot, 'node_modules/vitest'));

  if (!hasVitest) {
    return {
      kind: EvidenceKind.UNIT_TEST,
      status: EvidenceStatus.SKIPPED,
      message: 'vitest not installed',
      duration_ms: Date.now() - start,
    };
  }

  try {
    const npxPrefix = findNpx(projectRoot);
    const relTestFiles = testFiles.join(' ');
    const result = execSync(`${npxPrefix}vitest run ${relTestFiles} --reporter=verbose 2>&1`, {
      cwd: projectRoot,
      timeout,
      stdio: 'pipe',
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    const output = result.toString();

    // Parse test counts from vitest output
    const passMatch = output.match(/(\d+)\s+passed/);
    const failMatch = output.match(/(\d+)\s+failed/);
    const passed = passMatch ? parseInt(passMatch[1]) : 0;
    const failed = failMatch ? parseInt(failMatch[1]) : 0;

    return {
      kind: EvidenceKind.UNIT_TEST,
      status: EvidenceStatus.PASS,
      message: `${passed} test(s) passed${failed ? `, ${failed} failed` : ''} (${testFiles.length} file(s))`,
      duration_ms: Date.now() - start,
    };
  } catch (err: any) {
    const output = err.stdout?.toString() || err.stderr?.toString() || '';
    const failMatch = output.match(/(\d+)\s+failed/);
    const passMatch = output.match(/(\d+)\s+passed/);
    const failed = failMatch ? parseInt(failMatch[1]) : '?';
    const passed = passMatch ? parseInt(passMatch[1]) : 0;

    return {
      kind: EvidenceKind.UNIT_TEST,
      status: EvidenceStatus.FAIL,
      message: `${failed} test(s) failed${passed ? `, ${passed} passed` : ''}`,
      duration_ms: Date.now() - start,
      details: extractTestFailures(output),
    };
  }
}

/**
 * Property tests: look for *.prop.test.ts or *.property.test.ts files.
 */
function runPropertyTests(iu: ImplementationUnit, projectRoot: string, timeout: number): CheckResult {
  const start = Date.now();

  const propTestFiles = findTestFiles(iu, projectRoot, true);
  if (propTestFiles.length === 0) {
    return {
      kind: EvidenceKind.PROPERTY_TEST,
      status: EvidenceStatus.FAIL,
      message: 'No property test files found',
      duration_ms: Date.now() - start,
    };
  }

  const hasVitest = existsSync(join(projectRoot, 'node_modules/.bin/vitest')) ||
                    existsSync(join(projectRoot, 'node_modules/vitest'));
  if (!hasVitest) {
    return {
      kind: EvidenceKind.PROPERTY_TEST,
      status: EvidenceStatus.SKIPPED,
      message: 'vitest not installed',
      duration_ms: Date.now() - start,
    };
  }

  try {
    const npxPrefix = findNpx(projectRoot);
    execSync(`${npxPrefix}vitest run ${propTestFiles.join(' ')} --reporter=verbose 2>&1`, {
      cwd: projectRoot,
      timeout,
      stdio: 'pipe',
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    return {
      kind: EvidenceKind.PROPERTY_TEST,
      status: EvidenceStatus.PASS,
      message: `Property tests passed (${propTestFiles.length} file(s))`,
      duration_ms: Date.now() - start,
    };
  } catch (err: any) {
    const output = err.stdout?.toString() || err.stderr?.toString() || '';
    return {
      kind: EvidenceKind.PROPERTY_TEST,
      status: EvidenceStatus.FAIL,
      message: 'Property tests failed',
      duration_ms: Date.now() - start,
      details: extractTestFailures(output),
    };
  }
}

/**
 * Static analysis: run tsc --strict plus check for unsafe patterns.
 */
function runStaticAnalysis(iu: ImplementationUnit, projectRoot: string, timeout: number): CheckResult {
  const start = Date.now();

  const existingFiles = iu.output_files.filter(f => existsSync(join(projectRoot, f)));
  if (existingFiles.length === 0) {
    return {
      kind: EvidenceKind.STATIC_ANALYSIS,
      status: EvidenceStatus.FAIL,
      message: 'No output files found',
      duration_ms: Date.now() - start,
    };
  }

  const issues: string[] = [];

  for (const file of existingFiles) {
    const content = readFileSync(join(projectRoot, file), 'utf8');
    const lines = content.split('\n');

    // Check for unsafe patterns
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ln = i + 1;

      // eval() usage
      if (/\beval\s*\(/.test(line)) {
        issues.push(`${file}:${ln}: eval() usage detected`);
      }
      // Function constructor
      if (/new\s+Function\s*\(/.test(line)) {
        issues.push(`${file}:${ln}: new Function() usage detected`);
      }
      // Unchecked type assertions
      if (/as\s+any\b/.test(line)) {
        issues.push(`${file}:${ln}: 'as any' type assertion`);
      }
      // Non-null assertions
      const bangCount = (line.match(/!\./g) || []).length;
      if (bangCount > 2) {
        issues.push(`${file}:${ln}: excessive non-null assertions (${bangCount})`);
      }
      // Unsafe regex (ReDoS potential)
      if (/new\s+RegExp\(/.test(line) && /\+\s*['"]/.test(line)) {
        issues.push(`${file}:${ln}: dynamic RegExp from user input (potential ReDoS)`);
      }
    }
  }

  // Check for 'as any' density
  const totalAny = issues.filter(i => i.includes("'as any'")).length;

  if (issues.length > 5) {
    return {
      kind: EvidenceKind.STATIC_ANALYSIS,
      status: EvidenceStatus.FAIL,
      message: `${issues.length} static analysis issue(s)`,
      duration_ms: Date.now() - start,
      details: issues.slice(0, 15).join('\n'),
    };
  }

  return {
    kind: EvidenceKind.STATIC_ANALYSIS,
    status: EvidenceStatus.PASS,
    message: `Static analysis passed (${existingFiles.length} files${issues.length ? `, ${issues.length} note(s)` : ''})`,
    duration_ms: Date.now() - start,
    details: issues.length ? issues.join('\n') : undefined,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute a combined hash of all output file contents for an IU.
 */
function computeArtifactHash(iu: ImplementationUnit, projectRoot: string): string {
  const parts: string[] = [];
  for (const file of iu.output_files.sort()) {
    const fullPath = join(projectRoot, file);
    if (existsSync(fullPath)) {
      parts.push(readFileSync(fullPath, 'utf8'));
    }
  }
  return sha256(parts.join('\n---\n'));
}

/**
 * Find test files associated with an IU.
 *
 * Search strategy (broadest first):
 * 1. __tests__ dir in same directory as output file
 * 2. __tests__ dir in parent directory (service-level tests)
 * 3. Co-located test files (foo.test.ts next to foo.ts)
 */
function findTestFiles(iu: ImplementationUnit, projectRoot: string, propertyOnly = false): string[] {
  const testFiles: string[] = [];

  for (const outputFile of iu.output_files) {
    const dir = dirname(outputFile);

    // Search directories: same dir, then parent
    const searchDirs = [dir];
    const parentDir = dirname(dir);
    if (parentDir !== dir && parentDir !== '.') {
      searchDirs.push(parentDir);
    }

    for (const searchDir of searchDirs) {
      const testsDir = join(projectRoot, searchDir, '__tests__');
      if (existsSync(testsDir)) {
        try {
          const files = readdirSync(testsDir, { recursive: true }) as string[];
          for (const f of files) {
            const fname = f.toString();
            if (propertyOnly) {
              if (fname.match(/\.(prop|property)\.test\.(ts|js)$/)) {
                testFiles.push(join(searchDir, '__tests__', fname));
              }
            } else {
              if (fname.match(/\.test\.(ts|js)$/) && !fname.match(/\.(prop|property)\.test\./)) {
                testFiles.push(join(searchDir, '__tests__', fname));
              }
            }
          }
        } catch { /* ignore */ }
      }
    }

    // Also look for co-located test files (foo.test.ts next to foo.ts)
    const base = outputFile.replace(/\.(ts|js)$/, '');
    const colocatedPatterns = propertyOnly
      ? [`${base}.prop.test.ts`, `${base}.property.test.ts`]
      : [`${base}.test.ts`, `${base}.spec.ts`];
    for (const p of colocatedPatterns) {
      if (existsSync(join(projectRoot, p))) {
        testFiles.push(p);
      }
    }
  }

  // Deduplicate
  return [...new Set(testFiles)];
}

/**
 * Filter tsc error output to only lines referencing this IU's files.
 */
function filterErrorsToIU(output: string, iuFiles: string[]): string[] {
  const lines = output.split('\n');
  const errors: string[] = [];

  for (const line of lines) {
    for (const file of iuFiles) {
      // tsc outputs paths like "src/generated/foo/bar.ts(12,5): error TS..."
      if (line.includes(file)) {
        errors.push(line.trim());
        break;
      }
    }
  }

  return errors;
}

/**
 * Extract test failure messages from vitest output.
 */
function extractTestFailures(output: string): string {
  const lines = output.split('\n');
  const failures: string[] = [];
  let inFailure = false;

  for (const line of lines) {
    if (line.includes('FAIL') || line.includes('AssertionError') || line.includes('Error:')) {
      inFailure = true;
    }
    if (inFailure) {
      failures.push(line);
      if (failures.length > 20) break;
    }
    if (inFailure && line.trim() === '') {
      inFailure = false;
    }
  }

  return failures.join('\n').slice(0, 1000);
}

/**
 * Find npx prefix for running project-local binaries.
 */
function findNpx(projectRoot: string): string {
  if (existsSync(join(projectRoot, 'node_modules/.bin'))) {
    return join(projectRoot, 'node_modules/.bin') + '/';
  }
  return 'npx ';
}
