/**
 * Behavioral coverage (MG5) — the honest label: does an app that must talk to a
 * service actually bind to it? Stops "compiles + composes" reading as "functions".
 */
import { describe, it, expect } from 'vitest';
import { assessBehavioralCoverage } from '../../src/behavioral-coverage.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import { CanonicalType } from '../../src/models/canonical.js';

let s = 0;
const node = (stmt: string): CanonicalNode =>
  ({ canon_id: 'n' + s++, type: CanonicalType.REQUIREMENT, statement: stmt, tags: [], source_clause_ids: [], linked_canon_ids: [] } as unknown as CanonicalNode);
const demandsLive = [node('the server must broadcast live position updates in real-time via websocket')];
const noDemand = [node('a task must have a unique title')];

describe('assessBehavioralCoverage', () => {
  it('UNPROVEN: demands live integration but nothing binds (the freeqworld diorama)', () => {
    const r = assessBehavioralCoverage(demandsLive, [{ file: 'x.ts', source: 'export const seeded = ["hi"];' }]);
    expect(r.verdict).toBe('unproven');
    expect(r.message).toMatch(/NOT to FUNCTION/);
  });

  it('BOUND: demands live integration and a module actually binds, no stubs', () => {
    const r = assessBehavioralCoverage(demandsLive, [
      { file: 'chat.ts', source: "registerServiceBinding('chat', (c) => c.subscribe('general', () => {}));" },
    ]);
    expect(r.verdict).toBe('bound');
  });

  it('STUB-RISK: binds but also ships a plausible stub', () => {
    const r = assessBehavioralCoverage(demandsLive, [
      { file: 'chat.ts', source: "registerServiceBinding('chat', (c) => c.subscribe('x', () => {}));" },
      { file: 'fake.ts', source: 'export function createWebSocketTransport() { return { send() {} }; }' },
    ]);
    expect(r.verdict).toBe('stub-risk');
    expect(r.plausibleStubs).toBe(1);
  });

  it('N/A: an app with no live-integration demand is not judged on it', () => {
    expect(assessBehavioralCoverage(noDemand, [{ file: 'x.ts', source: 'export const x = 1;' }]).verdict).toBe('n/a');
  });
});
