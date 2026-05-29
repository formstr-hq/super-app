import { SimplePool } from "nostr-tools";
import type { Filter } from "nostr-tools";

export interface SubscriptionHandle {
  unsub(): void;
}

interface SubscriptionListener {
  id: number;
  onEvent?: (event: import("nostr-tools").Event) => void;
  onEose?: () => void;
}

interface ManagedSubscription {
  hash: string;
  refCount: number;
  subs: { close(): void }[];
  filters: Filter[];
  relays: string[];
  listeners: SubscriptionListener[];
  eoseFired: boolean;
  receivedEvents: import("nostr-tools").Event[];
}

/**
 * Subscription deduplication and reference counting.
 * Based on Calendar's SubscriptionManager.
 *
 * - Hash-based dedup: identical (filters, relays) pairs reuse same sub
 * - Reference counting: auto-closes at 0 refs
 * - Auto-chunking: splits >1000 author filters into chunks
 * - Multiple listeners: concurrent callers each receive events/EOSE
 */
export class SubscriptionManager {
  private pool: SimplePool;
  private subscriptions = new Map<string, ManagedSubscription>();
  private nextListenerId = 0;

  constructor(pool: SimplePool) {
    this.pool = pool;
  }

  subscribe(
    relays: string[],
    filters: Filter[],
    options?: {
      onEvent?: (event: import("nostr-tools").Event) => void;
      onEose?: () => void;
    },
  ): SubscriptionHandle {
    const hash = this.computeHash(relays, filters);
    const listenerId = this.nextListenerId++;

    // Reuse existing subscription — add listener for new caller
    const existing = this.subscriptions.get(hash);
    if (existing) {
      existing.refCount++;
      const listener: SubscriptionListener = {
        id: listenerId,
        onEvent: options?.onEvent,
        onEose: options?.onEose,
      };
      existing.listeners.push(listener);

      // Replay events already received so the new caller doesn't miss them
      for (const event of existing.receivedEvents) {
        listener.onEvent?.(event);
      }
      // If EOSE already fired, notify immediately
      if (existing.eoseFired) {
        listener.onEose?.();
      }

      return {
        unsub: () => this.releaseListener(hash, listenerId),
      };
    }

    // New subscription
    const listeners: SubscriptionListener[] = [
      {
        id: listenerId,
        onEvent: options?.onEvent,
        onEose: options?.onEose,
      },
    ];

    const managed: ManagedSubscription = {
      hash,
      refCount: 1,
      subs: [],
      filters,
      relays,
      listeners,
      eoseFired: false,
      receivedEvents: [],
    };

    // Chunk large author filters and subscribe to each
    const chunkedFilters = this.chunkFilters(filters);

    managed.subs = chunkedFilters.map((filter) =>
      this.pool.subscribeMany(relays, filter, {
        onevent: (event) => {
          managed.receivedEvents.push(event);
          for (const l of managed.listeners) {
            l.onEvent?.(event);
          }
        },
        oneose: () => {
          managed.eoseFired = true;
          for (const l of managed.listeners) {
            l.onEose?.();
          }
        },
      }),
    );

    this.subscriptions.set(hash, managed);

    return {
      unsub: () => this.releaseListener(hash, listenerId),
    };
  }

  private releaseListener(hash: string, listenerId: number): void {
    const managed = this.subscriptions.get(hash);
    if (!managed) return;

    managed.listeners = managed.listeners.filter((l) => l.id !== listenerId);
    managed.refCount--;
    if (managed.refCount <= 0) {
      for (const sub of managed.subs) sub.close();
      this.subscriptions.delete(hash);
    }
  }

  /** Split filters with >1000 authors into 1000-author chunks */
  private chunkFilters(filters: Filter[]): Filter[] {
    const result: Filter[] = [];
    for (const filter of filters) {
      if (filter.authors && filter.authors.length > 1000) {
        for (let i = 0; i < filter.authors.length; i += 1000) {
          result.push({
            ...filter,
            authors: filter.authors.slice(i, i + 1000),
          });
        }
      } else {
        result.push(filter);
      }
    }
    return result;
  }

  private computeHash(relays: string[], filters: Filter[]): string {
    const key = JSON.stringify({ relays: [...relays].sort(), filters });
    // Simple hash
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const chr = key.charCodeAt(i);
      hash = ((hash << 5) - hash + chr) | 0;
    }
    return hash.toString(36);
  }

  get activeCount(): number {
    return this.subscriptions.size;
  }
}
