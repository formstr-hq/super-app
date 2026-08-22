import type { Event, Filter } from "nostr-tools";

import type { NostrRuntimeContract, SubscribeOptions } from "./contract";
import { defaultNostrRuntime } from "./NostrRuntime";
import type { SubscriptionHandle } from "./SubscriptionManager";

let installed: NostrRuntimeContract = defaultNostrRuntime;

/**
 * Install the runtime every module reads and writes through.
 *
 * The browser app installs a local-relay-backed implementation at boot; MCP
 * installs nothing, because Node has no Worker, and keeps the SimplePool
 * default. Nothing else in the codebase knows which one it got.
 */
export function setNostrRuntime(runtime: NostrRuntimeContract): void {
  installed = runtime;
}

export function getNostrRuntime(): NostrRuntimeContract {
  return installed;
}

/** Restore the SimplePool default. For tests and logout. */
export function resetNostrRuntime(): void {
  installed = defaultNostrRuntime;
}

/**
 * The app-wide runtime.
 *
 * A delegating object rather than a direct reference, because agent services
 * import this at module load — long before the app decides which backend to
 * install. Every call resolves the current implementation, so a reference
 * captured at import time still follows the swap.
 */
export const nostrRuntime: NostrRuntimeContract = {
  subscribe: (
    relays: string[],
    filters: Filter[],
    options?: SubscribeOptions,
  ): SubscriptionHandle => installed.subscribe(relays, filters, options),
  fetchOne: (relays: string[], filter: Filter, timeoutMs?: number): Promise<Event | null> =>
    installed.fetchOne(relays, filter, timeoutMs),
  querySync: (relays: string[], filter: Filter, timeoutMs?: number): Promise<Event[]> =>
    installed.querySync(relays, filter, timeoutMs),
  publish: (relays: string[], event: Event, timeoutMs?: number): Promise<void> =>
    installed.publish(relays, event, timeoutMs),
  dispose: (): void => installed.dispose(),
};
