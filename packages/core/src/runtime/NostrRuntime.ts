import { SimplePool } from "nostr-tools";
import type { Event, Filter } from "nostr-tools";
import { EventStore } from "./EventStore";
import { SubscriptionManager, type SubscriptionHandle } from "./SubscriptionManager";

/**
 * NostrRuntime — shared pool + EventStore + SubscriptionManager.
 * Based on Calendar's NostrRuntime — the most sophisticated implementation
 * with subscription deduplication, batching, and multi-indexed caching.
 */
export class NostrRuntime {
  readonly pool: SimplePool;
  readonly eventStore: EventStore;
  readonly subscriptionManager: SubscriptionManager;

  private batchQueue = new Map<
    string,
    {
      relays: string[];
      resolve: (event: Event | null) => void;
    }
  >();
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.pool = new SimplePool();
    this.eventStore = new EventStore();
    this.subscriptionManager = new SubscriptionManager(this.pool);
  }

  /** Sync cache lookup — returns events matching filter from EventStore */
  query(filter: Filter): Event[] {
    return this.eventStore.query(filter);
  }

  /** Get single event by ID from cache */
  get(id: string): Event | undefined {
    return this.eventStore.get(id);
  }

  /**
   * Network subscription — stores events in EventStore,
   * deduplicates via SubscriptionManager.
   */
  subscribe(
    relays: string[],
    filters: Filter[],
    options?: {
      onEvent?: (event: Event) => void;
      onEose?: () => void;
    },
  ): SubscriptionHandle {
    return this.subscriptionManager.subscribe(relays, filters, {
      onEvent: (event) => {
        this.eventStore.store(event);
        // Always forward — callers handle their own dedup (fetchOne
        // uses a settled flag, querySync uses a seenIds set).
        options?.onEvent?.(event);
      },
      onEose: options?.onEose,
    });
  }

  /** One-shot fetch — returns first matching event, then closes */
  async fetchOne(relays: string[], filter: Filter, timeoutMs = 10000): Promise<Event | null> {
    // Check cache first
    const cached = this.eventStore.query(filter);
    if (cached.length > 0) return cached[0];

    return new Promise<Event | null>((resolve) => {
      let settled = false;
      const settle = (result: Event | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        handle.unsub();
        resolve(result);
      };

      const handle = this.subscribe(relays, [filter], {
        onEvent: (event) => settle(event),
        onEose: () => settle(null),
      });

      const timer = setTimeout(() => settle(null), timeoutMs);
    });
  }

  /** Subscribe until EOSE, return all received events (with timeout) */
  async querySync(relays: string[], filter: Filter, timeoutMs = 10000): Promise<Event[]> {
    // Check cache first
    const cached = this.eventStore.query(filter);

    return new Promise<Event[]>((resolve) => {
      const events: Event[] = [...cached];
      const seenIds = new Set(cached.map((e) => e.id));
      let settled = false;

      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        handle.unsub();
        resolve(events);
      };

      const handle = this.subscribe(relays, [filter], {
        onEvent: (event) => {
          if (!seenIds.has(event.id)) {
            seenIds.add(event.id);
            events.push(event);
          }
        },
        onEose: () => settle(),
      });

      const timer = setTimeout(() => settle(), timeoutMs);
    });
  }

  /**
   * Batches individual ID lookups within 50ms window into a single subscription.
   * Reduces relay round-trips when fetching many individual events.
   */
  fetchBatched(relays: string[], id: string): Promise<Event | null> {
    // Check cache first
    const cached = this.eventStore.get(id);
    if (cached) return Promise.resolve(cached);

    return new Promise<Event | null>((resolve) => {
      this.batchQueue.set(id, { relays, resolve });

      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.flushBatch(), 50);
      }
    });
  }

  /** Publish event to relays */
  async publish(relays: string[], event: Event): Promise<void> {
    await Promise.allSettled(this.pool.publish(relays, event));
    this.eventStore.store(event);
  }

  // ── Internal ──────────────────────────────────────────

  private flushBatch(): void {
    this.batchTimer = null;
    const pending = new Map(this.batchQueue);
    this.batchQueue.clear();

    if (pending.size === 0) return;

    // Group by relay set
    const byRelays = new Map<string, { ids: string[]; entries: typeof pending }>();
    for (const [id, entry] of pending) {
      const key = entry.relays.sort().join(",");
      if (!byRelays.has(key)) {
        byRelays.set(key, { ids: [], entries: new Map() });
      }
      const group = byRelays.get(key)!;
      group.ids.push(id);
      group.entries.set(id, entry);
    }

    for (const [, group] of byRelays) {
      const relays = group.entries.values().next().value!.relays;
      const filter: Filter = { ids: group.ids };
      const resolved = new Set<string>();

      const handle = this.subscribe(relays, [filter], {
        onEvent: (event) => {
          const entry = group.entries.get(event.id);
          if (entry) {
            resolved.add(event.id);
            entry.resolve(event);
          }
        },
        onEose: () => {
          handle.unsub();
          // Resolve unfound events as null
          for (const [id, entry] of group.entries) {
            if (!resolved.has(id)) {
              entry.resolve(null);
            }
          }
        },
      });
    }
  }
}

/** Singleton runtime instance */
export const nostrRuntime = new NostrRuntime();
