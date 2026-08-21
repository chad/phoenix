/**
 * Declared-interface resolution — the spec's HTTP surface is a CONTRACT, not a hint.
 *
 * The bench found this (bench/FINDINGS.md, 2026-08-20). A spec said, in as many words:
 *
 *     - `POST /tasks` — creates a task from a JSON body; returns 201 and the created task
 *     - `GET /stats`  — returns 200 and { "total": n, "completed": n, … }
 *
 * …and Phoenix generated a server that mounted `/task` and `/task-summary`, because the
 * mount path was slugified from the IMPLEMENTATION UNIT'S NAME. The units were named by
 * the planner from the requirement cluster, so an internal naming decision silently
 * overrode the one part of the system the spec had pinned down exactly. It typechecked,
 * it booted, `phoenix status` was green, and every request the spec described 404'd.
 *
 * That inversion is the bug this module closes. In the project's own vocabulary: the
 * interface is a CONSERVATION LAYER — the thing other systems depend on and the thing
 * that must survive regeneration — and it had been treated as an artifact derived from a
 * disposable interior. Interiors are derived from interfaces, never the reverse.
 *
 * How the prefix is decided, in order:
 *
 *   1. STRUCTURAL. The spec declares a surface (`/tasks` with `POST /`, `GET /`, `GET
 *      /:id`, `PATCH /:id`, `DELETE /:id`); the generated module declares route shapes of
 *      its own. Match them. This needs no naming convention, no synonym table, and no
 *      agreement about English plurals — a module that implements the declared shapes IS
 *      the module the declaration was about.
 *   2. NOMINAL, as a tie-break only. `/tasks` and a unit called `task` are the same word.
 *   3. ABSTAIN. No confident match → the existing slug rule stands, and the run says so
 *      out loud. A wrong mount asserted confidently is worse than a slug plus a warning.
 *
 * The resolution is reported, journaled, and never silent: a spec that declares an
 * interface Phoenix could not place is a finding about the spec or the plan, and it is
 * printed either way.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Paths the shared application shell owns. A spec is free to declare them — it should —
 * but they are not mountable module prefixes, and claiming them would shadow the health
 * route the harness (and every uptime checker) depends on.
 */
export const RESERVED_PREFIXES: ReadonlySet<string> = new Set(['health', 'healthz', 'favicon.ico', 'metrics', 'ready', 'readyz']);

export interface DeclaredRoute {
  readonly method: HttpMethod;
  /** Absolute path exactly as declared, e.g. `/tasks/:id`. */
  readonly path: string;
}

/** One mountable surface: a first path segment and the route shapes declared beneath it. */
export interface DeclaredSurface {
  /** First path segment, without the slash: `tasks`. */
  readonly prefix: string;
  /** Normalised shapes relative to the prefix: `GET /`, `GET /:x`. */
  readonly shapes: readonly string[];
}

/** What a generated module actually implements. */
export interface ModuleSurface {
  /** Stable key — the module's output file path. */
  readonly key: string;
  /** The IU's name. */
  readonly name: string;
  /** Normalised shapes the module registers on its own router. */
  readonly shapes: readonly string[];
  /** Nouns the module itself works with — the tables it reads and writes. */
  readonly entities?: readonly string[];
}

export interface MountDecision {
  readonly key: string;
  /** The prefix to mount at, WITH the leading slash. */
  readonly prefix: string;
  readonly basis: 'structural' | 'nominal';
  /** Human-readable evidence, printed and journaled. */
  readonly why: string;
}

export interface MountPlan {
  /** module key → decision. Absent key = no confident match; the slug rule stands. */
  readonly decisions: ReadonlyMap<string, MountDecision>;
  /** Declared surfaces nothing could be matched to — a finding, never swallowed. */
  readonly unplaced: readonly DeclaredSurface[];
}

// ─── Reading the declaration out of the spec ─────────────────────────────────

/** `:id`, `{id}`, `<id>` and `[id]` are the same parameter as far as a shape is concerned. */
function normalisePath(path: string): string {
  const cleaned = path
    .replace(/[{<[]([^}>\]]+)[}>\]]/g, ':x')
    .replace(/:[A-Za-z_][\w-]*/g, ':x')
    .replace(/\/+$/, '');
  return cleaned === '' ? '/' : cleaned;
}

/**
 * Pull `METHOD /path` declarations out of canonical statements or raw clause text.
 *
 * Deliberately conservative: the method must be adjacent to the path, so prose that
 * merely mentions "/tasks" declares nothing. Markdown backticks, bold and list markers
 * are stripped; case is not significant (the canonicalizer lowercases statements).
 */
export function extractDeclaredRoutes(statements: readonly string[]): DeclaredRoute[] {
  const out: DeclaredRoute[] = [];
  const seen = new Set<string>();
  // `deletes /tasks/:id` is the canonicalizer's rewrite of `DELETE /tasks/:id`, and it is
  // still a declaration — the verb is adjacent to the path, which is the whole test.
  const re = new RegExp(`\\b(${METHODS.join('|')})(?:S|ES)?\\b\\s+\`?(/[A-Za-z0-9_\\-/:{}<>\\[\\]]*)`, 'gi');
  for (const raw of statements) {
    const text = raw.replace(/[*_`]/g, ' ');
    for (const m of text.matchAll(re)) {
      const method = m[1].toUpperCase() as HttpMethod;
      const path = m[2].replace(/[.,;:)]+$/, '');
      const key = `${method} ${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ method, path });
    }
  }
  return out;
}

/** Group declared routes into mountable surfaces, dropping the shell's reserved paths. */
export function declaredSurfaces(routes: readonly DeclaredRoute[]): DeclaredSurface[] {
  const byPrefix = new Map<string, Set<string>>();
  for (const r of routes) {
    const segments = normalisePath(r.path).split('/').filter(Boolean);
    if (segments.length === 0) continue;               // `/` is the shell's, not a module's
    const prefix = segments[0].toLowerCase();
    if (RESERVED_PREFIXES.has(prefix)) continue;
    if (prefix.startsWith(':')) continue;              // a parameter cannot be a mount point
    const rest = '/' + segments.slice(1).join('/');
    const shapes = byPrefix.get(prefix) ?? new Set<string>();
    shapes.add(`${r.method} ${rest === '/' ? '/' : rest}`);
    byPrefix.set(prefix, shapes);
  }
  return [...byPrefix]
    .map(([prefix, shapes]) => ({ prefix, shapes: [...shapes].sort() }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
}

/**
 * The nouns a module actually works with: the tables it reads and writes.
 *
 * This is nominal evidence that does not depend on what anyone NAMED anything. A module
 * running `SELECT … FROM tasks` is about tasks whether its implementation unit ended up
 * called `task`, `taskService` or `widget`.
 */
export function moduleEntities(source: string): string[] {
  const out = new Set<string>();
  const re = /\b(?:from|into|update|join|table(?:\s+if\s+not\s+exists)?)\s+["'`]?([a-z_][a-z0-9_]*)/gi;
  for (const m of source.matchAll(re)) out.add(m[1].toLowerCase());
  return [...out].sort();
}

/** Read the route shapes a generated module registers on its own router. */
export function moduleShapes(source: string): string[] {
  const shapes = new Set<string>();
  const re = /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]*)['"`]/g;
  for (const m of source.matchAll(re)) {
    shapes.add(`${m[1].toUpperCase()} ${normalisePath(m[2])}`);
  }
  return [...shapes].sort();
}

// ─── Matching ────────────────────────────────────────────────────────────────

/** Crude singular/plural fold — used ONLY to break a structural tie, never to decide one. */
function fold(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses') || w.endsWith('shes') || w.endsWith('ches')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function tokensMatch(target: string, source: string): boolean {
  return source.split(/[^A-Za-z0-9]+/).filter(Boolean).some(tok => fold(tok) === target);
}

interface Scored {
  key: string;
  coverage: number;
  matched: number;
  /** The unit is NAMED for this prefix. The strongest nominal evidence there is. */
  named: boolean;
  /** The module reads or writes a table named for this prefix. Weaker: a loans module
   *  joins `books` to compute availability, which makes it look book-ish and is not. */
  handles: boolean;
}

function score(surface: DeclaredSurface, mod: ModuleSurface): Scored {
  const have = new Set(mod.shapes);
  const matched = surface.shapes.filter(s => have.has(s)).length;
  const target = fold(surface.prefix);
  return {
    key: mod.key,
    coverage: surface.shapes.length === 0 ? 0 : matched / surface.shapes.length,
    matched,
    named: tokensMatch(target, mod.name),
    handles: (mod.entities ?? []).some(e => tokensMatch(target, e)),
  };
}

/**
 * Decide where each module mounts.
 *
 * **Structure qualifies; the noun decides.** Shape matching alone cannot tell `/tasks`
 * from `/projects` — two CRUD resources register exactly the same five shapes — so a
 * candidate must first implement at least half the declared surface, and then the noun
 * picks between the qualifiers.
 *
 * Nominal evidence comes in two strengths, and conflating them was a real bug: a `loans`
 * module reads the `books` table to compute availability, so "mentions the noun" made it a
 * candidate for `/books` alongside the `book` module, the two tied on structure, and
 * `/books` was abstained on — the app served `/book`. So the unit's NAME is tried first,
 * and only if nothing is named for the prefix do the tables it touches get a vote:
 *
 *   1. a unit named for the prefix        (`book` ← `/books`)
 *   2. failing that, one that handles it   (the only module touching a `stats` table)
 *   3. failing that, structure alone, and only when there is exactly ONE candidate
 *      and therefore nothing to confuse it with
 *
 * Everything else is left UNDECIDED. Guessing which of two modules owns `/tasks` is
 * precisely the confident wrongness this module exists to remove; an abstention keeps the
 * old slug and prints the reason, which is recoverable, while a wrong mount is silent.
 * Each module and each prefix is claimed at most once.
 */
export function planMounts(
  surfaces: readonly DeclaredSurface[],
  modules: readonly ModuleSurface[],
): MountPlan {
  const decisions = new Map<string, MountDecision>();
  const unplaced: DeclaredSurface[] = [];
  const takenModules = new Set<string>();

  // Strongest evidence first, so a confident surface claims its module before a weak one.
  const ordered = [...surfaces].sort((a, b) => b.shapes.length - a.shapes.length || a.prefix.localeCompare(b.prefix));

  for (const surface of ordered) {
    const qualifying = modules
      .filter(m => !takenModules.has(m.key))
      .map(m => score(surface, m))
      .filter(s => s.matched > 0 && (s.coverage >= 0.5 || s.named || s.handles))
      .sort((a, b) =>
        b.coverage - a.coverage
        || Number(b.named) - Number(a.named)
        || Number(b.handles) - Number(a.handles)
        || a.key.localeCompare(b.key));

    if (qualifying.length === 0) { unplaced.push(surface); continue; }

    const named = qualifying.filter(s => s.named);
    const handlers = qualifying.filter(s => !s.named && s.handles);
    const tier = named.length > 0 ? named : handlers.length > 0 ? handlers : qualifying;

    let best: Scored;
    if (tier === qualifying && qualifying.length > 1) {
      // Nobody carries the noun at all. One qualifying module is an identification; two is
      // a coin flip between `/tasks` and `/projects`, which look identical from here.
      unplaced.push(surface);
      continue;
    }
    if (tier.length > 1 && tier[0].coverage === tier[1].coverage) {
      // Two units with equal claim at the same strength of evidence. Not our call.
      unplaced.push(surface);
      continue;
    }
    best = tier[0];

    takenModules.add(best.key);
    const pct = Math.round(best.coverage * 100);
    decisions.set(best.key, {
      key: best.key,
      prefix: '/' + surface.prefix,
      basis: best.coverage >= 0.5 ? 'structural' : 'nominal',
      why: best.coverage >= 0.5
        ? `implements ${best.matched}/${surface.shapes.length} declared route shapes (${pct}%)`
        : `name matches the declared prefix, and ${best.matched} declared shape(s) line up`,
    });
  }

  return { decisions, unplaced };
}

/** One-line report per decision, for the console and the journal. */
export function describeMountPlan(plan: MountPlan, nameOf: (key: string) => string): string[] {
  const lines: string[] = [];
  for (const d of plan.decisions.values()) {
    lines.push(`${d.prefix} ← ${nameOf(d.key)} (declared in spec; ${d.why})`);
  }
  for (const s of plan.unplaced) {
    lines.push(`/${s.prefix} declared in spec but not placed — no module implements it unambiguously (${s.shapes.join(', ')})`);
  }
  return lines;
}
