/**
 * Integration evaluations (MG1) — the surface that measures "does the app FUNCTION?".
 *
 * Phoenix's structural gates (typecheck, constraints, composition) can all pass on
 * behaviorally-inert code. This is the missing eval kind: boot the app's service
 * binding against the in-memory fixture broker, run a scenario (a client subscribes, a
 * peer publishes), and assert the message actually round-trips. An app that hardcodes
 * data or never calls the client FAILS; an app that genuinely subscribes/publishes
 * PASSES. Without this, "works" is unmeasurable — and generation optimizes to whatever
 * IS measured, which is why it produced a diorama.
 *
 * Pure, deterministic, hermetic (no network). The app under test is expressed as a
 * `ServiceBinder`: exactly the contract a generated module implements to wire itself to
 * the service (MG2). Same binder runs here (fixture) and in production (real transport).
 */

import type { ServiceClient, ServiceMessage } from './service-client.js';
import { InMemoryBroker } from './service-client.js';

/** What a generated module exports to wire itself to the service. */
export type ServiceBinder = (client: ServiceClient) => void;

export interface IntegrationScenario {
  name: string;
  /** Channel the peer publishes on. */
  channel: string;
  /** Message body the peer publishes. */
  message: unknown;
}

export interface IntegrationResult {
  scenario: string;
  passed: boolean;
  detail: string;
}

/**
 * Run one integration scenario. Two clients share a broker; the app binder runs on the
 * "app" client (it should subscribe + record). A peer client publishes the scenario
 * message. Pass iff the app actually received it through the service.
 */
export function runIntegrationEval(bind: ServiceBinder, scenario: IntegrationScenario): IntegrationResult {
  const broker = new InMemoryBroker();
  const received: ServiceMessage[] = [];

  // The app client: the binder wires it. We wrap subscribe to observe what the app
  // actually receives via the service (not what it fabricates internally).
  const raw = broker.connect('app');
  const appClient: ServiceClient = {
    id: raw.id,
    subscribe(channel, handler) {
      raw.subscribe(channel, (m) => { received.push(m); handler(m); });
    },
    publish: raw.publish.bind(raw),
  };
  try {
    bind(appClient);
  } catch (e) {
    return { scenario: scenario.name, passed: false, detail: `binder threw: ${(e as Error).message}` };
  }

  const peer = broker.connect('peer');
  peer.publish(scenario.channel, scenario.message);

  const got = received.find(m => m.channel === scenario.channel);
  if (!got) {
    return {
      scenario: scenario.name, passed: false,
      detail: `the app never received a message on "${scenario.channel}" — it did not subscribe to the service (inert: hardcoded data or no binding).`,
    };
  }
  return { scenario: scenario.name, passed: true, detail: `round-trip confirmed on "${scenario.channel}" via the service.` };
}

/** Run a suite of scenarios against one binder. */
export function runIntegrationEvals(bind: ServiceBinder, scenarios: IntegrationScenario[]): IntegrationResult[] {
  return scenarios.map(s => runIntegrationEval(bind, s));
}
