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

/** One standing interest's scope, and the moment it was declared. */
interface WarmEntry {
  filters: Filter[];
  declaredAt: number;
}

/**
 * Holds the app's standing interests for one account.
 *
 * Nothing in the UI owns these: they are declared once at login and dropped at
 * logout, so mounting or unmounting a view never opens or closes a socket. The
 * registry also answers whether a given read is backed by one of them, which is
 * what the runtime consults before settling a read early.
 *
 * It answers for interests it did not declare, too. A module that opens its own
 * live scope — the board on screen, whose cards no boot-time interest covers —
 * registers it here through `track`, because a read is warm when *some* standing
 * interest keeps it fresh, not only when this class opened it.
 */
export class WarmupRegistry {
  private handles: Array<{ unobserve: () => void }> = [];
  private entries: WarmEntry[] = [];

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
      this.entries.push({ filters: scope.filters, declaredAt: Date.now() });
    }
  }

  /**
   * Count an interest this registry does not own as warm, until the returned
   * function is called.
   *
   * The subscription is the caller's — this only records that the scope is being
   * kept current, so reads over it can settle on the short grace. Without it a
   * live-watched scope reads as cold and pays the full quiet window on every
   * refetch, which is the slowest part of writing to an open board.
   */
  track(filters: Filter[]): () => void {
    const entry: WarmEntry = { filters, declaredAt: Date.now() };
    this.entries.push(entry);
    return () => {
      const at = this.entries.indexOf(entry);
      if (at >= 0) this.entries.splice(at, 1);
    };
  }

  stop(): void {
    for (const handle of this.handles) handle.unobserve();
    this.handles = [];
    this.entries = [];
  }

  /** Is this read backed by a standing interest that has had time to sync? */
  covers(filter: Filter): boolean {
    const now = Date.now();
    return this.entries.some(
      (entry) =>
        now - entry.declaredAt >= this.syncWindowMs &&
        entry.filters.some((declared) => isCoveredBy(filter, declared)),
    );
  }
}

/**
 * The registry the app is currently running on, or null when it is signed out or
 * on the SimplePool backend.
 *
 * A module-level handle because the two sides never meet otherwise: the registry
 * is built during the local-relay install, while the live scopes that want to
 * register with it are opened later, per view, from stores that know nothing
 * about the network backend.
 */
let current: WarmupRegistry | null = null;

export function currentWarmup(): WarmupRegistry | null {
  return current;
}

export function setCurrentWarmup(registry: WarmupRegistry | null): void {
  current = registry;
}
