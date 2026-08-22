import { defaultNostrRuntime } from "@formstr/core";

/** Relay URL → connected. A relay the backend has never touched is absent. */
export type RelayStatusMap = Map<string, boolean>;

type RelayHealthReader = () => Promise<RelayStatusMap>;

let reader: RelayHealthReader | null = null;

/**
 * Install the health source for whichever backend is running.
 *
 * The header's relay indicator asks the network layer which relays are up. On
 * the SimplePool backend that is the pool's own connection map, but under the
 * local relay the pool never connects to anything — the worker owns every
 * socket — so reading the pool there would report every relay idle forever.
 *
 * Kept out of `NostrRuntimeContract` deliberately: health is a diagnostic, not
 * one of the five ways the app reaches the network, and only one component asks.
 */
export function setRelayHealthReader(next: RelayHealthReader | null): void {
  reader = next;
}

/** Current connection status, from the installed backend. */
export async function readRelayHealth(): Promise<RelayStatusMap> {
  if (reader) {
    try {
      return await reader();
    } catch {
      // The worker answers over a message channel that can be torn down between
      // the poll firing and the reply — during an account switch, say. Fall
      // through rather than leaving the indicator stuck on its last paint.
    }
  }
  return new Map(defaultNostrRuntime.pool.listConnectionStatus());
}
