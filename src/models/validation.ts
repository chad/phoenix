/**
 * ValidationResult — the unified check-outcome record (SHACL-spine, Phase A seed).
 *
 * Patterned on SHACL's sh:ValidationResult (focus node, result path, value, source
 * component, severity, message) but deliberately divergent: SHACL results only ever
 * denote non-conformance and surface conformance as a report-level boolean; we carry
 * conforms/violates/absent/indeterminate in one record so the trust surface can be a
 * TOTAL function over (method × result) — see verdictOf. Phoenix validates SPEC↔CODE,
 * so `focus`/`path` name a schema element, not an RDF data triple.
 *
 * Scope note (first slice): only the `static` and `manual` rows of the assurance
 * table are reachable as OK; property/behavioral OK is gated on a per-eval mutation
 * harness that does not exist yet, so it degrades to INCOMPLETE. `Operational` is
 * quarantined — it is not a shape and does not feed this verdict.
 */

export type CheckResult = 'conforms' | 'violates' | 'absent' | 'indeterminate';
export type CheckMethod = 'static' | 'property' | 'behavioral' | 'live' | 'manual';

/** A reference into the canonical/IU graph — the thing being validated. */
export interface Ref {
  label: string;            // human-readable ("habit.name")
  entity?: string;
  attribute?: string;
  iu_id?: string;
}

export interface ValidationResult {
  focus: Ref;                       // sh:focusNode — the node/artifact
  path?: string;                    // sh:resultPath — which property of it (kept separate from focus)
  value?: unknown;                  // sh:value — the offending value, when applicable
  source_component: string;         // e.g. 'bound', 'bound-binding'
  result: CheckResult;
  method: CheckMethod;
  message: string;
  recommended_actions: string[];    // preserved from Diagnostic — the surface must still say what to do
  provenance?: { source_doc?: string; line?: number };
}

export type Verdict = 'ok' | 'error' | 'incomplete';

/**
 * The total function over (method × result). `ok` is an explicitly enumerated, rare
 * cell — never a default. Notes:
 *  - `absent` here means "target-selected, statically-lowerable, but no enforcement
 *    artifact found" (the §1 max-80 cell). A shape that did not select the focus must
 *    emit NO result at all — do not pass not-applicable through this function.
 *  - property/behavioral `conforms` is NOT ok yet (no per-eval mutation gate); it
 *    degrades to `incomplete`.
 *  - `Operational`/`live` is quarantined and must not be routed here.
 */
export function verdictOf(method: CheckMethod, result: CheckResult): Verdict {
  switch (result) {
    case 'violates':
      return 'error';
    case 'indeterminate':
      return 'incomplete';
    case 'absent':
      return method === 'static' ? 'error' : 'incomplete';
    case 'conforms':
      // Only static and (signed, unexpired) manual conformance is trustworthy today.
      return method === 'static' || method === 'manual' ? 'ok' : 'incomplete';
  }
}

/** Map a verdict to a diagnostic severity, or null when nothing should be surfaced. */
export function verdictSeverity(v: Verdict): 'error' | 'warning' | null {
  return v === 'error' ? 'error' : v === 'incomplete' ? 'warning' : null;
}
