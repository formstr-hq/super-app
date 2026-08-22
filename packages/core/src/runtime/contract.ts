import type { Event, Filter } from "nostr-tools";

import type { SubscriptionHandle } from "./SubscriptionManager";

export interface SubscribeOptions {
  onEvent?: (event: Event) => void;
  onEose?: () => void;
}

/**
 * Every way the app reaches the network.
 *
 * Deliberately five methods: those are the only ones anything outside core
 * calls. `query`, `get` and `fetchBatched` stay on `NostrRuntime` as internals —
 * they answer synchronously from an in-memory store, which a worker-backed
 * backend cannot do, and no caller needs them.
 *
 * `relays` are read/write TARGETS for the SimplePool implementation and HINTS
 * for a local-relay one, where the worker owns connection decisions and folds
 * them into its own routing.
 */
export interface NostrRuntimeContract {
  subscribe(relays: string[], filters: Filter[], options?: SubscribeOptions): SubscriptionHandle;
  fetchOne(relays: string[], filter: Filter, timeoutMs?: number): Promise<Event | null>;
  querySync(relays: string[], filter: Filter, timeoutMs?: number): Promise<Event[]>;
  publish(relays: string[], event: Event, timeoutMs?: number): Promise<void>;
  dispose(): void;
}
