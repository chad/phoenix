/**
 * E2E: Fault-Injection Meta-Evaluation of `phoenix status` (Phase 7).
 *
 * The PRD's whole bet: "If phoenix status is trusted, Phoenix becomes the
 * coordination substrate. If status is noisy or wrong, the system dies."
 *
 * This is the definition of "non-failing" — not that the code has no bugs, but
 * that the trust surface PROVABLY tells the truth. We seed known faults into a
 * clean project and assert status reports EXACTLY those faults: every injected
 * fault is detected (recall), and a clean baseline raises none of them (no false
 * positives → precision). Precision and recall are computed and gated, so any
 * regression that would erode trust fails CI before it ships.
 *
 * Method: bootstrap one "golden" project (stub mode, deterministic), then clone
 * it per scenario, inject one fault, and check the rendered status.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(__dirname, '../../');
const CLI = join(ROOT, 'dist', 'cli.js');

function phoenix(cwd: string, args: string[]): string {
  try {
    return execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, PHOENIX_NO_LLM: '1' } });
  } catch (e: any) {
    // status may exit non-zero on errors; we still want its stdout.
    return (e.stdout ?? '') + (e.stderr ?? '');
  }
}
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

const SPEC = `# Shop

## Products

- The system must allow users to create, update, and delete products
- A product name must not be empty

## Orders

- The system must allow users to place and cancel orders
- An order total must never be negative
`;

interface Scenario {
  name: string;
  /** Inject the fault into a cloned project. */
  inject: (dir: string) => void;
  /** Signature the status output MUST contain after injection (recall). */
  signature: RegExp;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'drift — manual edit to generated code',
    inject: (dir) => {
      const f = firstGeneratedFile(dir);
      writeFileSync(join(dir, f), readFileSync(join(dir, f), 'utf8') + '\n// manual edit\n', 'utf8');
    },
    signature: /Working tree differs from generated manifest/,
  },
  {
    name: 'missing — deleted generated file',
    inject: (dir) => {
      rmSync(join(dir, firstGeneratedFile(dir)));
    },
    signature: /Generated file is missing/,
  },
  {
    name: 'forbidden package — boundary policy violated',
    inject: (dir) => {
      // Forbid a package the generated code actually imports (the sqlite-web-api
      // modules import 'hono' and 'zod'); status must flag the violation.
      const iusPath = join(dir, '.phoenix', 'graphs', 'ius.json');
      const ius = JSON.parse(readFileSync(iusPath, 'utf8'));
      for (const iu of ius) iu.boundary_policy.code.forbidden_packages = ['hono', 'zod'];
      writeFileSync(iusPath, JSON.stringify(ius, null, 2), 'utf8');
    },
    signature: /is forbidden by boundary policy/,
  },
  {
    name: 'spec change — meaning-level edit invalidates an IU',
    inject: (dir) => {
      const specPath = join(dir, 'spec', 'shop.md');
      writeFileSync(specPath, readFileSync(specPath, 'utf8').replace(
        'place and cancel orders', 'place, cancel, and refund orders'), 'utf8');
      phoenix(dir, ['ingest']); // classify + invalidate
    },
    signature: /Invalidation:.*stale|Stale — requirements changed/,
  },
];

/** A manifest-TRACKED generated file (drift only applies to tracked files). */
function firstGeneratedFile(dir: string): string {
  const manifest = JSON.parse(readFileSync(join(dir, '.phoenix', 'manifests', 'generated_manifest.json'), 'utf8'));
  for (const iu of Object.values(manifest.iu_manifests) as any[]) {
    const files = Object.keys(iu.files);
    if (files.length > 0) return files.sort()[0];
  }
  throw new Error('no tracked generated file found');
}

describe('e2e: status fault-injection meta-eval', () => {
  let golden: string;

  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'ignore' });
    golden = mkdtempSync(join(tmpdir(), 'phoenix-golden-'));
    mkdirSync(join(golden, 'spec'), { recursive: true });
    writeFileSync(join(golden, 'spec', 'shop.md'), SPEC, 'utf8');
    phoenix(golden, ['init', '--arch=sqlite-web-api']);
    phoenix(golden, ['bootstrap']);
  }, 120_000);

  function clone(): string {
    const dir = mkdtempSync(join(tmpdir(), 'phoenix-fault-'));
    cpSync(golden, dir, { recursive: true });
    return dir;
  }

  it('clean baseline raises no fault signatures (precision: no false positives)', () => {
    const out = strip(phoenix(golden, ['status']));
    for (const s of SCENARIOS) {
      expect(out, `baseline should NOT match ${s.name}`).not.toMatch(s.signature);
    }
    // A clean bootstrap should have no ERROR-level drift/boundary noise.
    expect(out).not.toMatch(/Working tree differs|is forbidden by boundary policy|Generated file is missing/);
  });

  // Per-scenario recall: the injected fault is reported.
  const results: { name: string; detected: boolean; falsePositives: number }[] = [];
  for (const scenario of SCENARIOS) {
    it(`detects: ${scenario.name} (recall)`, () => {
      const dir = clone();
      scenario.inject(dir);
      const out = strip(phoenix(dir, ['status']));
      const detected = scenario.signature.test(out);

      // Precision within this scenario: no OTHER fault's signature should fire
      // (injecting drift must not spuriously report a forbidden package, etc.).
      // Related faults are allowed to co-occur (a deleted file is also "missing");
      // we count only clearly-unrelated signatures as false positives.
      const unrelated = SCENARIOS.filter(s => s.name !== scenario.name && !sharesFamily(s, scenario));
      const falsePositives = unrelated.filter(s => s.signature.test(out)).length;

      results.push({ name: scenario.name, detected, falsePositives });
      expect(detected, `status should report: ${scenario.name}`).toBe(true);
      rmSync(dir, { recursive: true, force: true });
    });
  }

  it('overall precision and recall are 100% (the bet holds)', () => {
    const recall = results.filter(r => r.detected).length / results.length;
    const totalFalse = results.reduce((n, r) => n + r.falsePositives, 0);
    const totalReports = results.filter(r => r.detected).length + totalFalse;
    const precision = totalReports === 0 ? 1 : results.filter(r => r.detected).length / totalReports;
    console.log(`  Status meta-eval — recall: ${(recall * 100).toFixed(0)}%, precision: ${(precision * 100).toFixed(0)}% over ${results.length} injected faults`);
    expect(recall).toBe(1);
    expect(precision).toBe(1);
  });
});

/** Drift and missing are the same family (both touch generated files on disk). */
function sharesFamily(a: Scenario, b: Scenario): boolean {
  const fam = (s: Scenario) => /drift|missing/.test(s.name) ? 'file' : s.name;
  return fam(a) === fam(b);
}
