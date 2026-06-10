import {
  SimplePool,
  useWebSocketImplementation as setWebSocketImplementation,
} from "nostr-tools/pool";
import WebSocket from "ws";

/**
 * A `SimplePool` wired for Node. `@formstr/signer`'s NIP-46 calls default to
 * `new SimplePool()` with no WebSocket impl, which has none in Node — so every
 * NIP-46 call (login + boot resume) MUST get a pool from here.
 *
 * Single-file CJS bundles bind a different module-level `_WebSocket` than
 * `useWebSocketImplementation` writes to, so we also patch the instance directly.
 */
export function createPatchedPool(): SimplePool {
  setWebSocketImplementation(WebSocket);
  const pool = new SimplePool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pool as any)._WebSocket = WebSocket;
  return pool;
}
