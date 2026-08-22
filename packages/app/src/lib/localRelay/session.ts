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

  const client = new LocalRelayClient(workerChannel(worker), {
    /**
     * Sign the worker's NIP-42 AUTH challenges. Without this a relay that
     * demands AUTH is simply unreachable, and nothing says so.
     *
     * Deliberately the non-blocking accessor: `getSigner()` opens the unlock
     * modal, and this fires from background socket activity the user did not
     * ask for. Refusing while locked is a real answer — the worker marks the
     * relay auth-failed and tries again on a later reconnect, by which time the
     * user has usually unlocked for something they did ask for.
     */
    onSignRequest: async (template: EventTemplate) => {
      const signer = signerManager.getSignerIfAvailable();
      if (!signer) return null;
      try {
        return await signer.signEvent(template);
      } catch {
        return null;
      }
    },
  });

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
