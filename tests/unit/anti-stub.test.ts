/**
 * Anti-stub gate (MG3) — catches code that advertises networking it doesn't perform.
 * Pins the exact freeqworld lie and guards against false positives.
 */

import { describe, it, expect } from 'vitest';
import { detectStubs } from '../../src/anti-stub.js';

describe('detectStubs', () => {
  it('flags the exact freeqworld lie: a WebSocket transport with no WebSocket', () => {
    const source = `
export function createWebSocketMovementTransport(): MovementTransport {
  const queue: MovementSyncEvent[] = [];
  return { status: 'open', queue, send(event) { queue.push(event); } };
}`;
    const f = detectStubs([{ file: 'client-movement.ts', source }]);
    expect(f).toHaveLength(1);
    expect(f[0].advertises).toMatch(/Transport/);
    expect(f[0].message).toMatch(/plausible stub/);
  });

  it('does NOT flag a real transport that actually opens a socket', () => {
    const source = `
export function createWebSocketTransport(url: string): Transport {
  const ws = new WebSocket(url);
  return { send(e) { ws.send(JSON.stringify(e)); } };
}`;
    expect(detectStubs([{ file: 'real.ts', source }])).toHaveLength(0);
  });

  it('does NOT flag pure domain code that never claims to do networking', () => {
    const source = `
export interface Habit { id: string; name: string; }
export function validateHabit(h: Habit): boolean { return h.name.length > 0; }`;
    expect(detectStubs([{ file: 'habit.ts', source }])).toHaveLength(0);
  });

  it('flags a fake ChannelSubscription that only reads hardcoded data', () => {
    const source = `
export function createChannelSubscription(name: string): ChannelSubscription {
  const seeded = ['hello', 'world'];
  return { messages: seeded, onMessage() {} };
}`;
    const f = detectStubs([{ file: 'channel.ts', source }]);
    expect(f).toHaveLength(1);
    expect(f[0].advertises).toMatch(/Subscription/);
  });

  it('a file that uses fetch() is real even if named like a client', () => {
    const source = `export async function loadClient() { const r = await fetch('/x'); return r.json(); }`;
    expect(detectStubs([{ file: 'x.ts', source }])).toHaveLength(0);
  });
});
