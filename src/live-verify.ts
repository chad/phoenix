/**
 * Live verification wiring — derive live evals from a real project's constraints and
 * run them through the live harness against the ACTUAL generated app.
 *
 * This is the P0.4 seam: `phoenix verify --live` boots the generated project (the real
 * `src/server.ts` under real Hono + better-sqlite3), derives the aggregate / state /
 * temporal evals the STATIC oracle can only abstain on, and drives them through the
 * mutation-gated harness. It records the gated verdicts (method `behavioral-gated`) and
 * cross-references them against the expr constraints that abstained statically — the
 * live oracle "upgrading" an abstention to an earned conforms.
 *
 * Honesty discipline: the harness abstains (indeterminate + reason) whenever it cannot
 * BOOT the app or cannot seed a clean signal (e.g. the write route rejects the naive
 * body because of unmet required fields or foreign keys it can't synthesize). An
 * abstention is reported as such — never silently upgraded to a green. The verifier
 * stays frozen: this consumes constraints read-only and changes no checker.
 */

import type { StructuredConstraint } from './constraints/model.js';
import type { ImplementationUnit } from './models/iu.js';
import {
  runGatedLiveEval, bootApp, type AppHandle, type BootSpec, type LivePlan, type GatedLiveResult, type PrepareResult,
} from './live-harness.js';
import { parseTableSchemas, seedForTarget, type SeedPlanInput, type TableSchema } from './live-seed.js';

/** Slugify an entity/IU name to its mounted route prefix (mirrors scaffold's rule). */
export function routeSlug(name: string): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return '/' + (slug || 'mod');
}

export interface DerivedLiveEval {
  label: string;
  plan: LivePlan;
  /** Repo-relative module file whose guard the mutation gate perturbs. */
  targetFile: string;
  /** The constraint this eval proves (for cross-referencing the static abstention). */
  constraintId: string;
  /** The entity whose create route this eval drives (for FK-aware seeding). */
  entity: string;
  /** The body field the driver sets itself — the seeder must NOT synthesize it. */
  governedField: string;
}

/**
 * Derive live evals from a project's constraints. We build a plan only where the shape
 * is confidently drivable single-entity; multi-entity setups (FK chains) are left for
 * the harness to abstain on rather than guessing a fragile seed. Each plan targets the
 * owning IU's module file for the mutation gate.
 */
export function deriveProjectLivePlans(
  constraints: StructuredConstraint[],
  ius: ImplementationUnit[],
): DerivedLiveEval[] {
  const out: DerivedLiveEval[] = [];
  const iuFor = (entity: string): ImplementationUnit | undefined =>
    ius.find(u => u.name.toLowerCase().replace(/s$/, '') === entity.toLowerCase().replace(/s$/, ''))
    ?? ius.find(u => u.name.toLowerCase().includes(entity.toLowerCase()));

  for (const c of constraints) {
    const iu = iuFor(c.binding.entity);
    const targetFile = iu?.output_files[0];
    if (!targetFile) continue;
    const route = routeSlug(iu.name);

    // Temporal (not-future): POST a future date, expect 400 — no prerequisites needed
    // when the date is the only governed field.
    if (c.assertion.kind === 'temporal' && c.assertion.mode === 'not-future') {
      out.push({
        label: `${c.binding.entity}.${c.binding.attribute} not-future`,
        plan: { kind: 'temporal', writeRoute: route, dateField: c.binding.attribute },
        targetFile, constraintId: c.constraint_id, entity: c.binding.entity, governedField: c.binding.attribute,
      });
    }

    // State non-negativity ("balance must never be negative"): attack the write route
    // with a negative value; expect rejection + preserved read.
    if (c.assertion.kind === 'expr' && /below zero|never (?:be )?negative|not (?:be )?negative/i.test(c.assertion.statement)) {
      out.push({
        label: `${c.binding.entity}.${c.binding.attribute} non-negative`,
        plan: { kind: 'state-nonneg', writeRoute: route, field: c.binding.attribute, readRoute: route, readField: c.binding.attribute },
        targetFile, constraintId: c.constraint_id, entity: c.binding.entity, governedField: c.binding.attribute,
      });
    }

    // Aggregate equality ("total must equal the sum of … balances"): seed the summed
    // field via the write route, read the aggregate route.
    if (c.assertion.kind === 'expr') {
      const m = c.assertion.statement.toLowerCase().match(/sum of\b(?:\s+(?:all|the|its|their))*\s+(?:[a-z-]+\s+)*?([a-z-]+?)s?\s*(?:[.;,]|$)/i);
      const aggMatch = c.assertion.statement.toLowerCase().match(/\b([a-z-]+)\s+(?:total|sum)\b|\b(total|balance)\b\s+must\s+equal/);
      if (m && aggMatch) {
        const field = m[1];
        out.push({
          label: `${c.binding.entity} aggregate = sum of ${field}`,
          plan: { kind: 'aggregate', seedRoute: route, seedField: field, aggregateRoute: route, aggregateField: 'total' },
          targetFile, constraintId: c.constraint_id, entity: c.binding.entity, governedField: field,
        });
      }
    }
  }
  return out;
}

export interface LiveVerifyReport {
  booted: boolean;
  bootReason?: string;
  results: Array<{ label: string; constraintId: string; result: GatedLiveResult }>;
  /** constraintIds whose static abstention the live oracle upgraded to a gated conforms. */
  upgraded: string[];
  checkedAt: string;
}

/**
 * Build a per-eval `prepare` closure from the schema plan: it seeds the target entity's FK
 * parents on the fresh app and returns the synthesized body (minus the governed field). The
 * SAME closure runs on every boot (baseline + each mutant re-boot). Returns undefined when
 * no schema is available or the entity maps to no table, in which case the harness drives
 * the naive body (and abstains if it's rejected) — never a false green.
 */
export function buildSeedPrepare(
  schemaDdl: string | undefined,
  constraints: StructuredConstraint[],
  ius: ImplementationUnit[],
  entity: string,
  governedField: string,
): ((app: AppHandle) => Promise<PrepareResult>) | undefined {
  if (!schemaDdl) return undefined;
  const tables: TableSchema[] = parseTableSchemas(schemaDdl);
  const norm = (s: string) => s.toLowerCase().replace(/s$/, '');
  const tableFor = (ent: string): string | undefined =>
    tables.find(t => norm(t.name) === norm(ent))?.name;
  const targetTable = tableFor(entity);
  if (!targetTable) return undefined;
  const routeFor = (table: string): string | null => {
    const iu = ius.find(u => norm(u.name) === norm(table));
    return iu ? routeSlug(iu.name) : null;
  };
  const input: SeedPlanInput = { tables, constraints, routeFor };
  return async (app: AppHandle): Promise<PrepareResult> => {
    const r = await seedForTarget(app, input, targetTable, governedField);
    return r.ok ? { ok: true, seed: r.seed } : { ok: false, reason: r.reason };
  };
}

/**
 * Boot the real generated project once for a health check, then run each derived eval
 * through the mutation-gated harness (each eval re-boots for isolation). Returns a
 * machine-readable report. A project that will not boot yields `booted:false` and every
 * eval indeterminate — the honest, never-a-false-green outcome.
 *
 * When `schemaDdl` (the schema plan) + `constraints` are supplied, each eval gets a
 * spec-aware `prepare` that seeds its FK prerequisites — turning the multi-entity
 * abstentions of NIGHT-REPORT-4 into real gated verdicts.
 */
export async function runLiveVerification(
  projectRoot: string,
  evals: DerivedLiveEval[],
  opts: { command?: readonly string[]; readyTimeoutMs?: number; schemaDdl?: string; constraints?: StructuredConstraint[]; ius?: ImplementationUnit[] } = {},
): Promise<LiveVerifyReport> {
  const command = opts.command ?? ['npx', 'tsx', 'src/server.ts'];
  const readyTimeoutMs = opts.readyTimeoutMs ?? 20_000;
  const bootSpec = (): BootSpec => ({ projectRoot, command, readyTimeoutMs });

  // Health probe: confirm the real app boots at all before spending mutation rounds.
  try {
    const app = await bootApp(bootSpec());
    await app.stop();
  } catch (e) {
    return {
      booted: false,
      bootReason: (e as Error).message,
      results: evals.map(ev => ({ label: ev.label, constraintId: ev.constraintId,
        result: { status: 'indeterminate', gated: false, method: 'behavioral-gated', reason: `app did not boot: ${(e as Error).message}`, mutantsApplicable: 0, mutantsKilled: 0 } })),
      upgraded: [],
      checkedAt: new Date().toISOString(),
    };
  }

  const results: LiveVerifyReport['results'] = [];
  const upgraded: string[] = [];
  for (const ev of evals) {
    const prepare = buildSeedPrepare(opts.schemaDdl, opts.constraints ?? [], opts.ius ?? [], ev.entity, ev.governedField);
    const result = await runGatedLiveEval({ bootSpec: bootSpec(), plan: ev.plan, targetFile: ev.targetFile, prepare });
    results.push({ label: ev.label, constraintId: ev.constraintId, result });
    if (result.status === 'pass' && result.gated) upgraded.push(ev.constraintId);
  }
  return { booted: true, results, upgraded, checkedAt: new Date().toISOString() };
}
