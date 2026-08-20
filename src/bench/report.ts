/**
 * Bench reporting — the terminal table and the published page.
 *
 * The report adds no measurement of its own. It reads the append-only results, pools the
 * citable entries by (case, fixture digest, arm, model), and prints every rate beside the
 * interval that produced it. The only comparison it makes is whether two intervals
 * overlap; there are no p-values, no pass/fail badges and no league table, because a
 * harness that ranks its own tool has stopped being an instrument.
 */

import {
  aggregate, flagsOf, isCitable, modelLabel, RESOLUTION_QUESTION,
  type Aggregate, type BenchEntry,
} from './results.js';
import { compareSentence, formatInterval } from './stats.js';

const DISCLOSURES: readonly string[] = [
  'The phoenix arm gets the pipeline\'s internal retries (typecheck-and-retry, repair loop). '
  + 'The baseline and intent arms get one call and no retry. That asymmetry is real, is recorded '
  + 'on every entry, and is not corrected for — "the pipeline minus its retry loop" is not a thing anyone can run.',
  'The intent arm is told the runtime contract but not the routes, so a check that fails because it '
  + 'invented a different URL is a true finding about one sentence of intent, not a scoring accident.',
  'Every arm is judged by the same oracle: boot the produced app, drive it over HTTP, assert. '
  + 'The oracle imports nothing from the pipeline and is not told which arm produced the code.',
  'Overlapping intervals mean these runs do not distinguish these rates. They never mean the rates are equal, '
  + 'and they never mean one arm is better.',
];

// ─── Terminal ────────────────────────────────────────────────────────────────

export function renderTerminal(entries: readonly BenchEntry[]): string {
  const out: string[] = [];
  const aggs = aggregate(entries);

  if (aggs.length === 0) {
    out.push('No citable runs yet.');
    out.push('');
    out.push('A run is citable when the tree was clean and the resolution was declared (coarse or fine).');
  }

  const groups = new Map<string, Aggregate[]>();
  for (const a of aggs) {
    const k = `${a.case}\u0000${a.fixture_digest}\u0000${a.model}`;
    const g = groups.get(k);
    if (g) g.push(a); else groups.set(k, [a]);
  }

  for (const [k, rows] of groups) {
    const [caseId, digest, model] = k.split('\u0000');
    out.push('');
    out.push(`${caseId} · ${model} · fixture ${digest}`);
    out.push('');
    out.push(`  ${'arm'.padEnd(9)} ${'works (booted + every assertion held)'.padEnd(38)} ${'checks passed'.padEnd(26)} ${'samples'.padEnd(8)} outcomes`);
    for (const r of rows) {
      const outcomes = `${r.working} working · ${r.disagreed} disagreed · ${r.broke} broke`
        + (r.unreachable ? ` · ${r.unreachable} unreachable (excluded)` : '');
      out.push(`  ${r.arm.padEnd(9)} ${formatInterval(r.works).padEnd(38)} ${formatInterval(r.checks).padEnd(26)} ${String(r.eligible).padEnd(8)} ${outcomes}`);
    }
    out.push('');
    const phoenix = rows.find(r => r.arm === 'phoenix');
    for (const other of rows.filter(r => r.arm !== 'phoenix')) {
      if (phoenix) out.push(`  ${compareSentence('phoenix', phoenix.works, other.arm, other.works)}`);
    }
  }

  const notCitable = entries.filter(e => !isCitable(e));
  if (notCitable.length > 0) {
    out.push('');
    out.push(`Shown, never counted (${notCitable.length} entr${notCitable.length === 1 ? 'y' : 'ies'}):`);
    for (const e of notCitable.slice(-10)) {
      out.push(`  ${e.at.slice(0, 16).replace('T', ' ')}  ${e.case} · ${e.arm} · ${modelLabel(e)}  n=${e.samples}  [${flagsOf(e).join(', ')}]`);
    }
  }

  out.push('');
  out.push('Disclosures');
  for (const d of DISCLOSURES) out.push(wrap(`  • ${d}`, 96));
  out.push('');
  return out.join('\n');
}

function wrap(s: string, width: number): string {
  const words = s.split(' ');
  const lines: string[] = [];
  let line = '';
  const indent = /^\s*• /.test(s) ? '    ' : '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > width) { lines.push(line); line = indent + w; }
    else line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

// ─── The published page ──────────────────────────────────────────────────────

/**
 * A self-contained HTML page: the entries are inlined, so it renders from `file://`,
 * from GitHub Pages, or from anywhere else without a server or a build step.
 */
export function renderHtml(entries: readonly BenchEntry[], meta: { generatedAt: string; commit: string }): string {
  const aggs = aggregate(entries);
  const data = JSON.stringify({ entries, aggs, meta }).replace(/</g, '\\u003c');

  const aggRows = aggs.map(a => `
      <tr>
        <td>${esc(a.case)}</td><td class="mono">${esc(a.model)}</td>
        <td><span class="arm arm-${a.arm}">${a.arm}</span></td>
        <td class="num">${fmt(a)}</td>
        <td class="num">${esc(formatInterval(a.checks))}</td>
        <td class="num">${a.eligible}</td>
        <td class="small">${a.working} working · ${a.disagreed} disagreed · ${a.broke} broke${a.unreachable ? ` · ${a.unreachable} unreachable (excluded)` : ''}</td>
        <td class="mono small">${esc(a.fixture_digest)}</td>
      </tr>`).join('');

  const runRows = [...entries].reverse().map(e => {
    const flags = flagsOf(e);
    return `
      <tr class="${flags.length ? 'notcitable' : ''}">
        <td class="mono small">${esc(e.at.slice(0, 16).replace('T', ' '))}</td>
        <td>${esc(e.case)}</td>
        <td class="mono small">${esc(modelLabel(e))}</td>
        <td><span class="arm arm-${e.arm}">${e.arm}</span></td>
        <td class="small">${esc(e.resolution)}</td>
        <td class="num">${e.samples}</td>
        <td class="num">${e.working}/${e.working + e.disagreed + e.broke}</td>
        <td class="small">${e.disagreed} disagreed · ${e.broke} broke${e.unreachable ? ` · ${e.unreachable} unreachable` : ''}</td>
        <td class="mono small">${esc(e.commit)}</td>
        <td class="small">${flags.length ? flags.map(f => `<span class="flag">${f}</span>`).join(' ') : '<span class="ok">citable</span>'}</td>
      </tr>`;
  }).join('');

  const comparisons: string[] = [];
  const byKey = new Map<string, Aggregate[]>();
  for (const a of aggs) {
    const k = `${a.case}\u0000${a.fixture_digest}\u0000${a.model}`;
    const g = byKey.get(k); if (g) g.push(a); else byKey.set(k, [a]);
  }
  for (const [k, rows] of byKey) {
    const [caseId, , model] = k.split('\u0000');
    const phoenix = rows.find(r => r.arm === 'phoenix');
    if (!phoenix) continue;
    for (const other of rows.filter(r => r.arm !== 'phoenix')) {
      comparisons.push(`<li><strong>${esc(caseId)}</strong> <span class="mono small">${esc(model)}</span><br>${esc(compareSentence('phoenix', phoenix.works, other.arm, other.works))}</li>`);
    }
  }

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Phoenix — bench results</title>
<style>
:root { --ink:#16181d; --dim:#666; --line:#e4e6ea; --accent:#c0392b; --bg:#fff; }
* { box-sizing: border-box; }
body { margin:0; font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif; color:var(--ink); background:var(--bg); }
.wrap { max-width: 1000px; margin: 0 auto; padding: 0 24px; }
header { border-bottom:1px solid var(--line); padding:48px 0 32px; margin-bottom:32px; }
.eyebrow { text-transform:uppercase; letter-spacing:.12em; font-size:12px; color:var(--accent); margin:0 0 8px; }
h1 { margin:0 0 12px; font-size:34px; letter-spacing:-.02em; }
h2 { margin:40px 0 12px; font-size:22px; letter-spacing:-.01em; }
h3 { margin:24px 0 8px; font-size:16px; }
.lede { color:var(--dim); max-width:70ch; margin:0; }
.built { color:var(--dim); font-size:13px; margin-top:16px; }
table { border-collapse:collapse; width:100%; font-size:14px; margin:12px 0 8px; }
th,td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
th { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); font-weight:600; }
.num { font-variant-numeric: tabular-nums; white-space:nowrap; }
.mono { font-family: ui-monospace,SFMono-Regular,Menlo,monospace; }
.small { font-size:12.5px; color:var(--dim); }
.arm { font-size:12px; padding:2px 7px; border-radius:10px; border:1px solid var(--line); }
.arm-phoenix { background:#fdecea; border-color:#f5c6c0; }
.arm-baseline { background:#eef3fb; border-color:#cbd9ee; }
.arm-intent { background:#f4f4f5; }
.flag { font-size:11px; padding:1px 6px; border-radius:8px; background:#fff6e0; border:1px solid #f0dca8; }
.ok { font-size:11px; color:#2b7a3d; }
tr.notcitable td { opacity:.62; }
.callout { border-left:3px solid var(--accent); padding:2px 0 2px 16px; margin:20px 0; color:var(--ink); }
ul { max-width:74ch; } li { margin-bottom:10px; }
dl { max-width:74ch; } dt { font-weight:600; margin-top:14px; } dd { margin:2px 0 0; color:var(--dim); }
footer { border-top:1px solid var(--line); margin-top:56px; padding:24px 0 64px; color:var(--dim); font-size:13px; }
code { font-family: ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; background:#f5f5f7; padding:1px 4px; border-radius:3px; }
</style></head>
<body>
<header><div class="wrap">
  <p class="eyebrow">Phoenix</p>
  <h1>Bench results</h1>
  <p class="lede">Every run the bench has recorded, read straight from the append-only results files.
  This page adds no measurement of its own — it shows what each run stored, and states plainly what those
  numbers can and cannot support.</p>
  <p class="built">Built ${esc(meta.generatedAt)} from commit <span class="mono">${esc(meta.commit)}</span> · ${entries.length} recorded run(s), ${aggs.length} citable group(s)</p>
</div></header>

<main class="wrap">

<h2>What is being measured</h2>
<p>Phoenix compiles a specification into a working application. The question a bench case asks is
whether the application <em>works</em> — booted for real and driven over HTTP — and whether the pipeline
is why. So the tooling is taken away in two steps, and the same oracle judges all three results.</p>

<dl>
  <dt><span class="arm arm-phoenix">phoenix</span></dt>
  <dd>The full pipeline as shipped: spec → clauses → canonical graph → implementation units → generated code,
  with the architecture target and the pipeline's own internal retries. Driven through the compiled CLI, exactly as a user would.</dd>
  <dt><span class="arm arm-baseline">baseline</span></dt>
  <dd>The same specification text, the same model, one call, no pipeline. Not "a model without tooling" —
  a model handed a precise specification.</dd>
  <dt><span class="arm arm-intent">intent</span></dt>
  <dd>One sentence and the runtime contract. No requirement list, no routes. What a sentence alone produces.</dd>
</dl>

<div class="callout">
<p><strong>How to read a rate here.</strong> <code>28/30 [0.78, 0.98]</code> is one number, not two. The bracket is a
95% Wilson score interval: the range of true rates consistent with what was actually drawn. A perfect score at
five samples is consistent with a true rate of 57%, which is why the fraction never appears without the interval.
When two intervals overlap, the honest statement is <em>these runs do not distinguish these rates</em> — never that
one arm is better.</p>
</div>

<h2>Citable runs, pooled</h2>
<p class="small">Pooled by case, fixture digest, arm and model. Never across models and never across digests —
two runs with different digests were not asked the same question.</p>
<table>
  <thead><tr><th>Case</th><th>Model</th><th>Arm</th><th>Works</th><th>Checks passed</th><th>n</th><th>Outcomes</th><th>Fixture</th></tr></thead>
  <tbody>${aggRows || '<tr><td colspan="8" class="small">No citable runs yet.</td></tr>'}</tbody>
</table>

<h2>What the comparisons support</h2>
<ul>${comparisons.join('') || '<li class="small">Nothing yet — a comparison needs a citable run on two arms of the same case and model.</li>'}</ul>

<h2>Every recorded run</h2>
<p class="small">Smoke, dirty and unstated runs stay visible — they are honest records of what happened — and are
excluded from every aggregate and every comparison above.</p>
<table>
  <thead><tr><th>When</th><th>Case</th><th>Model</th><th>Arm</th><th>Res</th><th>n</th><th>Works</th><th>Other outcomes</th><th>Commit</th><th>Flags</th></tr></thead>
  <tbody>${runRows || '<tr><td colspan="10" class="small">No runs recorded.</td></tr>'}</tbody>
</table>

<h2>Glossary</h2>
<dl>
  <dt>working · disagreed · broke</dt>
  <dd>Kept apart rather than reduced to one rate. <em>Working</em>: it booted and every assertion held.
  <em>Disagreed</em>: it booted, answered, and failed at least one assertion. <em>Broke</em>: a phase died — nothing
  runnable was produced, or it never booted. A generator that emits nothing and one that emits something subtly
  wrong are different findings with different fixes.</dd>
  <dt>unreachable</dt>
  <dd>The call never reached the model. Excluded from every denominator, because an unreachable endpoint is not a
  producer that chose badly — and the count is always shown beside the rate that excluded it.</dd>
  <dt>resolution</dt>
  <dd>The question a sample size was drawn for: ${Object.entries(RESOLUTION_QUESTION).map(([k, v]) => `<code>${k}</code> — ${esc(v)}`).join('; ')}.</dd>
  <dt>fixture digest</dt>
  <dd>A hash of the case: its spec, its checks and its runtime contract. Every fixture is vendored in the
  repository, so the commit pins the question and the code — everything except the model's sampling.</dd>
  <dt>budget</dt>
  <dd>Model calls and retries an arm was allowed. Recorded per entry, never averaged away.</dd>
</dl>

<h2>Disclosures</h2>
<ul>${DISCLOSURES.map(d => `<li>${esc(d)}</li>`).join('')}</ul>

<h2>What this page cannot show</h2>
<p>It cannot show <em>why</em> a sample worked. The oracle asserts against HTTP behaviour, so a pipeline that
produced the right responses for the wrong reasons scores the same as one that understood the spec. Phoenix's own
provenance claims — selective invalidation, drift, the trust surface — are not measured here at all; they are
measured by <code>phoenix selftest</code>, which is a different instrument answering a different question.</p>
<p>It also cannot show a rate that would be constant by construction. The intent arm is given no file list, so an
"authorized paths" rate on that arm would be 1.00 forever; a perfect score that cannot be anything else ends a
question instead of inviting one, so it is not drawn.</p>

</main>
<footer><div class="wrap">
  Read directly from <code>bench/results/*.jsonl</code>. Results are append-only observations and are never edited;
  this page only reads them. Regenerate with <code>phoenix bench report --html</code>.
  <br>The measurement discipline here — arms as a ladder, intervals over point estimates, smoke/dirty runs shown but
  never counted — is modelled on the <a href="https://livecodelife.github.io/sedum/">Sedum eval harness</a>.
</div></footer>
<script id="bench-data" type="application/json">${data}</script>
</body></html>
`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(a: Aggregate): string {
  return esc(formatInterval(a.works));
}
