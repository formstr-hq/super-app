import { NostrRuntime } from "@formstr/core";
import type { NostrRuntimeContract } from "@formstr/core";
// Aliased: the `use*` name otherwise trips eslint's react-hooks rule.
import { useWebSocketImplementation as setWebSocketImplementation } from "nostr-tools/pool";
import WebSocket from "ws";

export interface NodeRuntime {
  runtime: NostrRuntimeContract;
  /** Live relay connection status for the admin dashboard. */
  relayStatus: () => Record<string, boolean>;
}

/**
 * A NostrRuntime wired for Node. nostr-tools' SimplePool has no WebSocket in
 * Node, so we install `ws` both at the module level and on the instance (some
 * bundles bind a different module-level ref) — same approach as @formstr/mcp.
 */
export function createNodeRuntime(): NodeRuntime {
  setWebSocketImplementation(WebSocket);
  const runtime = new NostrRuntime();
  (runtime.pool as unknown as { _WebSocket: unknown })._WebSocket = WebSocket;

  const relayStatus = () => {
    try {
      const status = runtime.pool.listConnectionStatus() as Map<string, boolean>;
      return Object.fromEntries(status);
    } catch {
      return {};
    }
  };

  return { runtime, relayStatus };
}
