/**
 * Anti-stub gate (MG3) — reject code that ADVERTISES a capability it does not perform.
 *
 * The freeqworld lie, exactly: `createWebSocketMovementTransport()` returns
 * `{ status:'open', send(e){ queue.push(e) } }` — it is named a WebSocket transport and
 * contains no `new WebSocket`. Structural gates (typecheck, constraints, composition)
 * all pass; the code is behaviorally a fake. This gate is where "plausible" gets
 * caught: a file whose symbols advertise networking but whose body performs no network
 * operation is flagged. Relocating rigor from human reading into a machine check.
 *
 * Deterministic, source-level, language-agnostic-ish (TS/JS shapes). File-scoped: it
 * flags when a file NAMES a networking capability but the whole file contains zero
 * network primitives — robust, low false-positive (a real transport has the primitive
 * somewhere in the same file).
 */

export interface StubFinding {
  file: string;
  /** The advertised capability symbol (e.g. 'WebSocketMovementTransport'). */
  advertises: string;
  message: string;
}

// A symbol whose NAME strongly promises live/network behavior (matches the core token
// even embedded in camelCase, e.g. createWebSocketMovementTransport). Deliberately
// STRONG signals only — not generic 'Client'/'Channel' (those are domain objects) — to
// keep false positives near zero.
const ADVERTISE_RE = /(WebSocket|WebTransport|Transport|Socket|Connection|Subscription|Realtime|EventStream|EventSource)/;
// An actual network operation — the thing a real implementation must contain somewhere.
const PRIMITIVE_RE = /\bnew\s+WebSocket\b|\bnew\s+EventSource\b|\bnew\s+XMLHttpRequest\b|\bWebTransport\b|\bfetch\s*\(|\.connect\s*\(|\.subscribe\s*\(|\.publish\s*\(|\bhttps?:\/\/|\bwss?:\/\//;
// IMPLEMENTATION declarations only (function/const/class) — a bare interface/type that
// names 'Transport' declares a shape, it doesn't promise to DO anything.
const DECL_RE = /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g;

/**
 * Scan generated sources. A file is a plausible-stub when an IMPLEMENTATION symbol
 * advertises networking (by name) yet the file contains NO network primitive.
 */
export function detectStubs(files: Array<{ file: string; source: string }>): StubFinding[] {
  const findings: StubFinding[] = [];
  for (const { file, source } of files) {
    if (PRIMITIVE_RE.test(source)) continue;        // has a real network op somewhere — not a stub
    // Find the first IMPLEMENTATION whose NAME advertises a networking capability.
    let advertised: string | null = null;
    for (const m of source.matchAll(DECL_RE)) {
      if (ADVERTISE_RE.test(m[1])) { advertised = m[1]; break; }
    }
    if (!advertised) continue;
    findings.push({
      file,
      advertises: advertised,
      message: `"${advertised}" advertises a live/network capability but the module performs no network operation (no new WebSocket / fetch / connect / subscribe). It is a plausible stub — structurally valid, behaviorally inert.`,
    });
  }
  return findings;
}
