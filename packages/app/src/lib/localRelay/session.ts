import { signerManager } from "@formstr/core";
import { DataLayer, LocalRelayClient, workerChannel } from "@formstr/local-relay";
import type { EventTemplate } from "nostr-tools";

import { installRuntime } from "./install";

export interface LocalRelaySession {
  dataLayer: DataLayer;
  /** Drops interests, restores the default runtime, terminates the worker. */
  close(): void;
}

/**
 * Spawn the worker for one account and put the app on it.
 *
 * Untested in jsdom, which has no `Worker` — everything with behaviour worth
 * asserting lives in `installRuntime`, which this only wires up. Keep it thin.
 */
export function startLocalRelaySession(pubkey: string): LocalRelaySession {
  const worker = new Worker(new URL("./relay.worker.ts", import.meta.url), {
    type: "module",
    // Read inside the worker as the IndexedDB namespace.
    name: pubkey,
  });
  const client = new LocalRelayClient(workerChannel(worker));

  const dataLayer = new DataLayer({
    client,
    // Resolved per call, like every other module: the signer may be locked when
    // the session starts, and this must not capture a stale one.
    sign: async (template: EventTemplate) => (await signerManager.getSigner()).signEvent(template),
  });

  const uninstall = installRuntime(dataLayer, pubkey);

  return {
    dataLayer,
    close: () => {
      uninstall();
      worker.terminate();
    },
  };
}
