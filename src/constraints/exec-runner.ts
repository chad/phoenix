/**
 * Executable property runner — the oracle's live path (mutation-gated).
 *
 * Static reduction can PROVE nothing about a cross-entity aggregate ("a dashboard
 * total equals the sum of all account balances"); the only honest verdict is to run
 * the code. This module executes a self-contained generated module in a vm sandbox
 * against randomized inputs and checks the aggregate property — and then EARNS the
 * right to say `conforms` by the mutation gate: it plants known bugs (sum→difference,
 * seeded-init, constant return) into the satisfying code and requires the property
 * eval to catch every one. An eval too weak to notice a planted bug certifies
 * nothing — the result degrades to `indeterminate`, never a false green.
 *
 * Scope, honestly: SELF-CONTAINED modules only (pure functions over data). A module
 * with imports/requires needs its dependencies stood up (in-memory DB, HTTP) — that
 * live harness does not exist yet, so such modules are refused (indeterminate) and
 * tracked as the known-red `oracle.live-app-property-evals-not-yet-run`.
 *
 * Determinism: inputs come from a fixed-seed LCG, so a verdict is reproducible —
 * the same (statement, source) pair always yields the same result.
 */

import ts from 'typescript';
import { createContext, runInContext } from 'node:vm';

export interface ExecPropertyResult {
  status: 'pass' | 'fail' | 'indeterminate';
  /** True only when the pass survived the mutation gate (all planted bugs caught). */
  gated: boolean;
  reason: string;
}

/** A recognized aggregate-equality property: `target must equal the sum of … <field>s`. */
export interface AggregateProperty {
  agg: 'sum';
  /** The summed attribute on each element ("balance"). */
  field: string;
}

/**
 * Reduce a statement to an executable aggregate property, or null. Recognized shape:
 * "… must (equal|be|match) the sum of (all) <entity> <field>s" — the field is the
 * last noun ("account balances" → balance).
 */
export function deriveAggregateProperty(statement: string): AggregateProperty | null {
  const m = statement.toLowerCase().match(
    /\bmust\s+(?:equal|be|match)\b[^.]*?\bsum of\b(?:\s+(?:all|the|its|their))*\s+(?:[a-z-]+\s+)*?([a-z-]+?)s?\s*(?:[.;,]|$)/i,
  );
  if (!m) return null;
  const field = m[1];
  return field && field.length > 2 ? { agg: 'sum', field } : null;
}

/** Fixed-seed LCG — deterministic pseudo-random ints in [-500, 500]. */
function makeRng(seed = 0xC0FFEE): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s % 1001) - 500;
  };
}

/** Top-level function names (declarations and arrow/function consts). */
function topLevelFunctionNames(source: string): string[] {
  const sf = ts.createSourceFile('m.ts', source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) names.push(st.name.text);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer &&
          (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          names.push(d.name.text);
        }
      }
    }
  }
  return names;
}

/** Compile + run a self-contained module in a vm sandbox; return its named functions. */
function loadFunctions(source: string, names: string[]): Map<string, (arg: unknown) => unknown> | null {
  const shim = `${source}\n;globalThis.__phx_fns = { ${names.join(', ')} };`;
  let js: string;
  try {
    js = ts.transpileModule(shim, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  } catch { return null; }
  const ctx: Record<string, unknown> = { exports: {}, module: { exports: {} } };
  try {
    createContext(ctx);
    runInContext(js, ctx, { timeout: 1000 });
  } catch { return null; }
  const fns = ctx.__phx_fns as Record<string, unknown> | undefined;
  if (!fns) return null;
  const out = new Map<string, (arg: unknown) => unknown>();
  for (const [k, v] of Object.entries(fns)) if (typeof v === 'function') out.set(k, v as (arg: unknown) => unknown);
  return out.size > 0 ? out : null;
}

/** Randomized trial inputs: arrays of `{[field]: int}` including empty and negative. */
function makeTrials(field: string, trials = 24): Array<{ input: Array<Record<string, number>>; expected: number }> {
  const rng = makeRng();
  const out: Array<{ input: Array<Record<string, number>>; expected: number }> = [];
  for (let t = 0; t < trials; t++) {
    const len = t === 0 ? 0 : Math.abs(rng()) % 8; // trial 0 is the empty aggregate
    const input = Array.from({ length: len }, () => ({ [field]: rng() }));
    const expected = input.reduce((s, o) => s + o[field], 0);
    out.push({ input, expected });
  }
  return out;
}

/** Whether `fn` computes the aggregate on every trial (deep-copied inputs per call). */
function satisfies(fn: (arg: unknown) => unknown, trials: ReturnType<typeof makeTrials>): boolean {
  for (const { input, expected } of trials) {
    let got: unknown;
    try { got = fn(structuredClone(input)); } catch { return false; }
    if (typeof got !== 'number' || !Number.isFinite(got) || got !== expected) return false;
  }
  return true;
}

/** Planted bugs: each returns a mutated source, or null when not applicable. */
const MUTATIONS: Array<{ name: string; apply: (src: string) => string | null }> = [
  {
    name: 'sum→difference',
    apply: (src) => {
      const m = src.replace(/([\w)\]])\s*\+\s*([\w(.$])/, '$1 - $2');
      return m === src ? null : m;
    },
  },
  {
    name: 'seeded-init (0→1)',
    apply: (src) => {
      const m = src.replace(/,\s*0\s*\)/, ', 1)');
      return m === src ? null : m;
    },
  },
  {
    name: 'constant return',
    apply: (src) => {
      const m = src.replace(/\breturn\s+(?!0\b)[^;\n]+/, 'return 0');
      return m === src ? null : m;
    },
  },
];

/**
 * Execute an aggregate property against a self-contained module, mutation-gated.
 * `pass` + `gated:true` is the ONLY combination that may become `conforms` upstream.
 */
export function runAggregateProperty(prop: AggregateProperty, source: string): ExecPropertyResult {
  // Modules with external dependencies need the live harness (the known red).
  if (/^\s*import\s|\brequire\s*\(/m.test(source)) {
    return { status: 'indeterminate', gated: false, reason: 'module has external dependencies — needs the live app harness' };
  }
  const names = topLevelFunctionNames(source);
  if (names.length === 0) return { status: 'indeterminate', gated: false, reason: 'no executable function found' };
  const fns = loadFunctions(source, names);
  if (!fns) return { status: 'indeterminate', gated: false, reason: 'module did not compile/evaluate in the sandbox' };

  const trials = makeTrials(prop.field);
  const satisfying = [...fns.entries()].filter(([, fn]) => satisfies(fn, trials));

  if (satisfying.length === 0) {
    // Distinguish "wrong" from "not an aggregate function at all": a candidate that
    // consumes the array and returns a number — but the wrong one — VIOLATES.
    const numeric = [...fns.values()].some(fn => {
      try { const g = fn(structuredClone(trials[1].input)); return typeof g === 'number' && Number.isFinite(g); } catch { return false; }
    });
    return numeric
      ? { status: 'fail', gated: false, reason: `executed: no function computes the ${prop.agg} of ${prop.field}s (property violated on randomized inputs)` }
      : { status: 'indeterminate', gated: false, reason: 'no function consumes the aggregate input' };
  }

  // The mutation gate: plant each applicable bug; the property eval must catch ALL.
  const fnName = satisfying[0][0];
  let applicable = 0;
  for (const mu of MUTATIONS) {
    const mutated = mu.apply(source);
    if (mutated === null) continue;
    applicable++;
    const mutFns = loadFunctions(mutated, topLevelFunctionNames(mutated));
    const mutFn = mutFns?.get(fnName);
    const survived = !!mutFn && satisfies(mutFn, trials);
    if (survived) {
      return { status: 'indeterminate', gated: false, reason: `mutation gate too weak: planted bug "${mu.name}" survived the eval` };
    }
  }
  if (applicable < 2) {
    return { status: 'indeterminate', gated: false, reason: `mutation gate too weak: only ${applicable} planted bug(s) applicable` };
  }
  return {
    status: 'pass', gated: true,
    reason: `executed: ${fnName}() computes the ${prop.agg} of ${prop.field}s on ${trials.length} randomized trials; mutation gate killed ${applicable}/${applicable} planted bugs`,
  };
}
