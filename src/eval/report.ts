/**
 * Scorecard rendering — the human-facing capability map (`phoenix eval`).
 */

import type { Scorecard, CaseResult } from './harness.js';

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', magenta: '\x1b[35m',
};

function bar(green: number, total: number, width = 16): string {
  const filled = total === 0 ? 0 : Math.round((green / total) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** Render the scorecard for a terminal. */
export function renderScorecard(sc: Scorecard, opts: { color?: boolean } = {}): string {
  const color = opts.color ?? true;
  const c = (code: string, s: string) => (color ? `${code}${s}${C.reset}` : s);
  const lines: string[] = [];

  lines.push('');
  lines.push(c(C.bold, '📊 Phoenix Capability Eval') + c(C.dim, '  — Red/Green TDD for the system itself'));
  lines.push('');

  // Per-capability bars.
  const caps = Object.keys(sc.byCapability).sort();
  const nameW = Math.max(...caps.map(x => x.length), 10);
  for (const cap of caps) {
    const b = sc.byCapability[cap];
    const frac = `${b.green}/${b.total}`;
    const col = b.green === b.total ? C.green : b.green === 0 ? C.red : C.yellow;
    const redTag = b.red > 0 ? c(C.dim, ` (${b.red} known-red)`) : '';
    lines.push(`  ${cap.padEnd(nameW)}  ${c(col, bar(b.green, b.total))} ${c(col, frac)}${redTag}`);
  }
  lines.push('');

  // The three lists that matter: regressions (alarm), promotions (celebrate), known-reds (backlog).
  if (sc.regressions.length > 0) {
    lines.push(c(C.red, c(C.bold, `  ✖ ${sc.regressions.length} REGRESSION(S) — a green capability broke:`)));
    for (const r of sc.regressions) lines.push(`      ${c(C.red, '✖')} ${r.case.id} ${c(C.dim, '— ' + r.detail)}`);
    lines.push('');
  }
  if (sc.promotions.length > 0) {
    lines.push(c(C.magenta, c(C.bold, `  ⭐ ${sc.promotions.length} PROMOTION(S) — a known-red now passes; flip it to green:`)));
    for (const r of sc.promotions) lines.push(`      ${c(C.magenta, '⭐')} ${r.case.id} ${c(C.dim, '— ' + r.detail)}`);
    lines.push('');
  }

  const reds = sc.results.filter(r => r.classification === 'known-red');
  if (reds.length > 0) {
    lines.push(c(C.bold, `  ▸ Known-red backlog (${reds.length}) — documented gaps, expected to fail:`));
    // Group reds by capability for readability.
    const byCap = new Map<string, CaseResult[]>();
    for (const r of reds) (byCap.get(r.case.capability) ?? byCap.set(r.case.capability, []).get(r.case.capability)!).push(r);
    for (const [cap, rs] of [...byCap.entries()].sort()) {
      lines.push(`    ${c(C.cyan, cap)}`);
      for (const r of rs) {
        lines.push(`      ${c(C.yellow, '○')} ${r.case.id}`);
        lines.push(`        ${c(C.dim, r.case.redReason ?? '')}`);
      }
    }
    lines.push('');
  }

  // Summary line.
  const healthPct = (sc.greenHealth * 100).toFixed(0);
  const passPct = (sc.passRate * 100).toFixed(0);
  const healthCol = sc.greenHealth === 1 ? C.green : C.red;
  lines.push(c(C.bold, '  ─── Summary ───'));
  lines.push(`  ${c(C.dim, 'Green health:')} ${c(healthCol, healthPct + '%')} ${c(C.dim, `(kept promises: ${sc.green}/${sc.green + sc.regressions.length} green-expected passing)`)}`);
  lines.push(`  ${c(C.dim, 'Overall pass rate:')} ${passPct}% ${c(C.dim, `(${sc.results.filter(r => r.passed).length}/${sc.total} cases)`)}`);
  lines.push(`  ${c(C.dim, 'Known-red backlog:')} ${sc.knownRed}  ${c(C.dim, '·')}  ${c(C.dim, 'Regressions:')} ${sc.regressions.length > 0 ? c(C.red, String(sc.regressions.length)) : '0'}  ${c(C.dim, '·')}  ${c(C.dim, 'Promotions:')} ${sc.promotions.length > 0 ? c(C.magenta, String(sc.promotions.length)) : '0'}`);
  lines.push('');
  if (sc.regressions.length === 0) {
    lines.push(c(C.green, '  ✔ No regressions — every green capability still holds.'));
  } else {
    lines.push(c(C.red, `  ✖ ${sc.regressions.length} regression(s) — a capability that was proven has broken.`));
  }
  lines.push('');
  return lines.join('\n');
}

/** A compact JSON artifact for diffing the scorecard over time. */
export function scorecardArtifact(sc: Scorecard): unknown {
  return {
    generated_at: sc.generatedAt,
    green_health: sc.greenHealth,
    pass_rate: sc.passRate,
    totals: { total: sc.total, green: sc.green, known_red: sc.knownRed, regressions: sc.regressions.length, promotions: sc.promotions.length },
    by_capability: sc.byCapability,
    cases: sc.results.map(r => ({ id: r.case.id, capability: r.case.capability, expect: r.case.expect, passed: r.passed, classification: r.classification, detail: r.detail, red_reason: r.case.redReason })),
  };
}
