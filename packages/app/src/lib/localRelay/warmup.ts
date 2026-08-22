import type { Filter } from "nostr-tools";

import { scopesFor } from "../live/scopes";

import { isCoveredBy } from "./coverage";

/** What the data layer needs to be, for a registry to declare interests on it. */
interface Declarable {
  observe(
    filters: Filter[],
    handlers: { onEvent: (event: never) => void },
    options?: { relays?: string[] },
  ): { unobserve: () => void };
}

/**
 * Holds the app's standing interests for one account.
 *
 * Nothing in the UI owns these: they are declared once at login and dropped at
 * logout, so mounting or unmounting a view never opens or closes a socket. The
 * registry also answers whether a given read is backed by one of them, which is
 * what the runtime consults before settling a read early.
 */
export class WarmupRegistry {
  private handles: Array<{ unobserve: () => void }> = [];
  private declared: Filter[] = [];
  private declaredAt = 0;

  constructor(
    private readonly dataLayer: Declarable,
    /**
     * How long a fresh interest is given to catch up before reads are allowed to
     * settle against it.
     *
     * A cache restored from IndexedDB holds whatever was true when the tab last
     * closed. The interest fixes that within a round trip, but a read served in
     * between would show the stale copy — and nothing re-renders it, because the
     * stores are not reactive yet. So for the first moments after sign-in every
     * read behaves as it does today, waiting for the network.
     */
    private readonly syncWindowMs = 3000,
  ) {}

  /** Declare every scope for `pubkey`, replacing any previous account's. */
  start(pubkey: string): void {
    this.stop();
    for (const scope of scopesFor(pubkey)) {
      this.handles.push(
        this.dataLayer.observe(
          scope.filters,
          // The interest exists to keep the store warm; readers read the store.
          { onEvent: () => {} },
          scope.relays.length > 0 ? { relays: scope.relays } : undefined,
        ),
      );
      this.declared.push(...scope.filters);
    }
    this.declaredAt = Date.now();
  }

  stop(): void {
    for (const handle of this.handles) handle.unobserve();
    this.handles = [];
    this.declared = [];
  }

  /** Is this read backed by a standing interest that has had time to sync? */
  covers(filter: Filter): boolean {
    if (this.declared.length === 0) return false;
    if (Date.now() - this.declaredAt < this.syncWindowMs) return false;
    return this.declared.some((declared) => isCoveredBy(filter, declared));
  }
}
