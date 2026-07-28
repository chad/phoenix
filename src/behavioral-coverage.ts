/**
 * Behavioral coverage (MG5) — the honest label that stops "compiles + composes" from
 * reading as "functions".
 *
 * An app whose value is talking to a service (demands realtime-presence) but whose
 * generated modules never bind to the service is a diorama, however green its
 * structural gates. This measures that gap and surfaces it in `status` and the
 * bootstrap completion, so the trust surface never overstates what was verified.
 *
 * Deterministic over (canon demands, generated sources). Pairs with the anti-stub gate
 * (MG3) and integration evals (MG1): demand detected here, bindings counted here,
 * stubs from MG3, round-trips proven by MG1.
 */

import type { CanonicalNode } from './models/canonical.js';
import { detectCapabilityDemands } from './architecture-fit.js';
import { detectStubs } from './anti-stub.js';

export type BehavioralVerdict = 'n/a' | 'unproven' | 'stub-risk' | 'bound';

export interface BehavioralCoverage {
  /** Does the spec demand live external integration (realtime-presence)? */
  demandsIntegration: boolean;
  /** Modules that actually wire themselves to the service. */
  serviceBindings: number;
  /** Plausible-stub modules (advertise networking, perform none). */
  plausibleStubs: number;
  verdict: BehavioralVerdict;
  message: string;
}

export function assessBehavioralCoverage(
  canonNodes: CanonicalNode[],
  generated: Array<{ file: string; source: string }>,
): BehavioralCoverage {
  const demandsIntegration = detectCapabilityDemands(canonNodes).some(d => d.capability === 'realtime-presence');
  const serviceBindings = generated.filter(g => /registerServiceBinding\s*\(/.test(g.source)).length;
  const plausibleStubs = detectStubs(generated).length;

  let verdict: BehavioralVerdict;
  let message: string;
  if (!demandsIntegration) {
    verdict = 'n/a';
    message = 'no live-integration demand — behavioral coverage not applicable';
  } else if (serviceBindings === 0) {
    verdict = 'unproven';
    message = `spec demands live integration but 0 modules bind to the service — verified to COMPILE and COMPOSE, NOT to FUNCTION. Generate service bindings + integration evals.`;
  } else if (plausibleStubs > 0) {
    verdict = 'stub-risk';
    message = `${serviceBindings} service binding(s), but ${plausibleStubs} plausible stub(s) advertise networking they don't perform — function is not trustworthy until those are real or removed.`;
  } else {
    verdict = 'bound';
    message = `${serviceBindings} module(s) bind to the service and no plausible stubs — run integration evals to confirm round-trips.`;
  }
  return { demandsIntegration, serviceBindings, plausibleStubs, verdict, message };
}
