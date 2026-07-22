/**
 * ServiceClient — the general seam between a generated app and its external service.
 *
 * The freeqworld failure was that generated code never talked to Freeq. The general
 * fix is a protocol-agnostic pub/sub client interface that BOTH the real transport
 * (a hand-authored WebSocket scaffold — MG2) and the integration-eval fixture (an
 * in-memory broker — below) implement. The app binds to this interface, so the SAME
 * app code is exercised in tests (against the fixture) and in production (against the
 * real service). Covers the broad class: chat, collaboration, live dashboards,
 * multiplayer, any app whose value is talking to a service.
 *
 * The specific protocol (Freeq, MQTT, whatever) is an ADAPTER over this interface,
 * supplied by the app — never baked into Phoenix.
 */

export interface ServiceMessage {
  channel: string;
  from: string;
  body: unknown;
}

export interface ServiceClient {
  readonly id: string;
  subscribe(channel: string, handler: (m: ServiceMessage) => void): void;
  publish(channel: string, body: unknown): void;
}

/**
 * In-memory broker — the integration-eval fixture. Stands in for the real external
 * service: routes each publish to every OTHER client subscribed to that channel
 * (sender doesn't receive its own publish, mirroring typical pub/sub). Deterministic,
 * synchronous, hermetic — no sockets, no ports.
 */
export class InMemoryBroker {
  private subs = new Map<string, Array<{ id: string; handler: (m: ServiceMessage) => void }>>();
  readonly delivered: ServiceMessage[] = [];

  connect(id: string): ServiceClient {
    const broker = this;
    return {
      id,
      subscribe(channel, handler) {
        const list = broker.subs.get(channel) ?? broker.subs.set(channel, []).get(channel)!;
        list.push({ id, handler });
      },
      publish(channel, body) {
        const msg: ServiceMessage = { channel, from: id, body };
        broker.delivered.push(msg);
        for (const s of broker.subs.get(channel) ?? []) {
          if (s.id !== id) s.handler(msg);
        }
      },
    };
  }
}
