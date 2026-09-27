import { FrameType } from "./frame";
import { Session, newSessionId } from "./session";
import type { Allowlist, Listener, NostrDuplex, TransportOptions } from "./types";
import { Wire } from "./wire";

/**
 * Edge side: open a duplex to a home node identified by its pubkey.
 *
 * The returned {@link NostrDuplex} is all the consumer touches. On the edge
 * (e.g. browser) it just carries bytes; nothing here knows those bytes are ACP.
 */
export async function connect(
  opts: TransportOptions,
  target: { to: string },
): Promise<NostrDuplex> {
  const wire = new Wire(opts);
  const sessionId = newSessionId();
  const session = new Session({
    peer: target.to,
    role: "initiator",
    sessionId,
    send: (frame) => {
      void wire.send(target.to, frame).catch(() => {});
    },
  });
  const unsubscribe = wire.subscribe((sender, frame) => {
    if (sender !== target.to || frame.session !== sessionId) return;
    session.deliver(frame);
  });
  void session.duplex.closed.finally(unsubscribe);
  await session.start();
  return session.duplex;
}

/**
 * Home-node side: accept inbound sessions from allowlisted peers.
 *
 * `allow` is the npub whitelist — every inbound frame carries a signature-
 * verified sender, checked here before a session is created. The receiving
 * consumer (see onConnection) pipes the duplex into the harness's ACP stdio;
 * the transport stays ACP-agnostic.
 */
export function listen(opts: TransportOptions, allow: Allowlist): Listener {
  const wire = new Wire(opts);
  const sessions = new Map<string, Session>(); // key: `${sender}:${sessionId}`
  const handlers: Array<(d: NostrDuplex) => void> = [];

  const unsubscribe = wire.subscribe(async (sender, frame) => {
    if (!(await allow(sender))) return; // reject non-whitelisted peers silently
    const key = `${sender}:${frame.session}`;
    let session = sessions.get(key);
    if (!session) {
      if (frame.type !== FrameType.Syn) return; // ignore stray frames for unknown sessions
      session = new Session({
        peer: sender,
        role: "responder",
        sessionId: frame.session,
        send: (f) => {
          void wire.send(sender, f).catch(() => {});
        },
      });
      sessions.set(key, session);
      void session.duplex.closed.finally(() => sessions.delete(key));
      for (const h of handlers) h(session.duplex);
    }
    session.deliver(frame);
  });

  return {
    onConnection(handler) {
      handlers.push(handler);
    },
    async close() {
      unsubscribe();
      await Promise.all([...sessions.values()].map((s) => s.close().catch(() => {})));
      sessions.clear();
    },
  };
}
