/**
 * Integration evals (MG1) — the surface that measures whether an app FUNCTIONS.
 *
 * The whole point: a functional binding (genuinely subscribes to the service) PASSES;
 * an inert one (hardcoded data / never touches the client — the freeqworld failure)
 * FAILS. This is what was missing when a diorama passed every structural gate.
 */

import { describe, it, expect } from 'vitest';
import { runIntegrationEval, runIntegrationEvals, type ServiceBinder } from '../../src/integration-eval.js';
import { InMemoryBroker } from '../../src/service-client.js';

const scenario = { name: 'chat round-trip', channel: 'general', message: { text: 'hello' } };

describe('runIntegrationEval', () => {
  it('PASSES a functional binder that actually subscribes to the service', () => {
    const bind: ServiceBinder = (client) => {
      const inbox: unknown[] = [];
      client.subscribe('general', (m) => inbox.push(m.body));
    };
    const r = runIntegrationEval(bind, scenario);
    expect(r.passed).toBe(true);
    expect(r.detail).toMatch(/round-trip confirmed/);
  });

  it('FAILS an inert binder that hardcodes data and never touches the client (the freeqworld bug)', () => {
    const bind: ServiceBinder = (_client) => {
      const messages = ['seeded hello', 'seeded world']; // hardcoded — never subscribes
      void messages;
    };
    const r = runIntegrationEval(bind, scenario);
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/never received|did not subscribe|inert/);
  });

  it('FAILS a binder that subscribes to the WRONG channel', () => {
    const bind: ServiceBinder = (client) => client.subscribe('lobby', () => {});
    expect(runIntegrationEval(bind, scenario).passed).toBe(false);
  });

  it('a thrown binder fails with a clear detail, not a crash', () => {
    const bind: ServiceBinder = () => { throw new Error('boom'); };
    const r = runIntegrationEval(bind, scenario);
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/binder threw: boom/);
  });

  it('runIntegrationEvals scores a suite', () => {
    const bind: ServiceBinder = (c) => c.subscribe('general', () => {});
    const results = runIntegrationEvals(bind, [scenario, { name: 'other', channel: 'dev', message: 1 }]);
    expect(results.map(r => r.passed)).toEqual([true, false]);
  });
});

describe('InMemoryBroker (the fixture service)', () => {
  it('routes a publish to other subscribers, not the sender', () => {
    const broker = new InMemoryBroker();
    const a = broker.connect('a'), b = broker.connect('b');
    const aGot: unknown[] = [], bGot: unknown[] = [];
    a.subscribe('c', (m) => aGot.push(m.body));
    b.subscribe('c', (m) => bGot.push(m.body));
    a.publish('c', 'hi');
    expect(bGot).toEqual(['hi']);   // peer receives
    expect(aGot).toEqual([]);        // sender does not
  });
});
