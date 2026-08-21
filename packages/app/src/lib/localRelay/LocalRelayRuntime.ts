import type { NostrRuntimeContract, SubscribeOptions, SubscriptionHandle } from "@formstr/core";
import type { DataLayer } from "@formstr/local-relay";
import type { Event, Filter } from "nostr-tools";

export interface LocalRelayRuntimeOptions {
  /** Hard cap on a one-shot read, so it can never hang. */
  timeoutMs?: number;
  /** Settle once this long passes with no new event. */
  quietMs?: number;
  /** Hard cap on awaiting a publish's per-relay outcome. */
  publishTimeoutMs?: number;
  /** Quiet period for a read whose scope a standing interest keeps fresh. */
  warmGraceMs?: number;
  /**
   * Is this scope backed by a standing interest?
   *
   * Supplied by the warm-up registry. A read it vouches for reads a store the
   * worker is actively updating, so it settles on `warmGraceMs` instead of
   * waiting out `quietMs`. That is the whole instant-load win: without it every
   * read pays the cold-cache latency even when the data is already there.
   */
  isWarm?: (filter: Filter) => boolean;
}

/**
 * Core's runtime contract, served by the local relay.
 *
 * The two models disagree about what a read is. Core's runtime fetches: it asks
 * relays and resolves on EOSE. The data layer only lets an app declare interest,
 * and fires EOSE after replaying the LOCAL store — which on a cold cache is
 * empty while the upstream fetch is still streaming. So a one-shot read here
 * opens a temporary interest and settles on a quiet period instead, with a hard
 * cap so a silent relay cannot hang a caller.
 *
 * `relays` stay meaningful: they are hints the worker folds into its routing for
 * this read, and real targets on publish, which is what keeps per-module relay
 * sets (and the interop that depends on them) intact.
 */
export class LocalRelayRuntime implements NostrRuntimeContract {
  private readonly timeoutMs: number;
  private readonly quietMs: number;
  private readonly publishTimeoutMs: number;
  private readonly warmGraceMs: number;
  private readonly isWarm: (filter: Filter) => boolean;
  /** Interests opened by `subscribe`, so `dispose` can drop them. */
  private readonly standing = new Set<{ unobserve: () => void }>();

  constructor(
    private readonly dataLayer: DataLayer,
    options: LocalRelayRuntimeOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.quietMs = options.quietMs ?? 700;
    this.publishTimeoutMs = options.publishTimeoutMs ?? 10_000;
    this.warmGraceMs = options.warmGraceMs ?? 150;
    this.isWarm = options.isWarm ?? (() => false);
  }

  querySync(relays: string[], filter: Filter, timeoutMs?: number): Promise<Event[]> {
    return new Promise((resolve) => {
      const collected = new Map<string, Event>();
      const quiet = this.isWarm(filter) ? this.warmGraceMs : this.quietMs;
      let settled = false;
      let quietTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        if (quietTimer) clearTimeout(quietTimer);
        handle.unobserve();
        resolve([...collected.values()]);
      };

      const hardTimer = setTimeout(finish, timeoutMs ?? this.timeoutMs);

      const handle = this.dataLayer.observe(
        [filter],
        {
          // Deliberately no onEose: local EOSE is not completion, see above.
          onEvent: (event) => {
            collected.set(event.id, event);
            if (quietTimer) clearTimeout(quietTimer);
            quietTimer = setTimeout(finish, quiet);
          },
        },
        relays.length > 0 ? { relays } : undefined,
      );
    });
  }

  /** Same temporary interest as `querySync`, resolved by the first match. */
  fetchOne(relays: string[], filter: Filter, timeoutMs?: number): Promise<Event | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (event: Event | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        handle.unobserve();
        resolve(event);
      };

      const hardTimer = setTimeout(() => finish(null), timeoutMs ?? this.timeoutMs);
      const handle = this.dataLayer.observe(
        [filter],
        { onEvent: (event) => finish(event) },
        relays.length > 0 ? { relays } : undefined,
      );
    });
  }

  subscribe(
    relays: string[],
    filters: Filter[],
    options: SubscribeOptions = {},
  ): SubscriptionHandle {
    const handle = this.dataLayer.observe(
      filters,
      { onEvent: (event) => options.onEvent?.(event), onEose: options.onEose },
      relays.length > 0 ? { relays } : undefined,
    );
    this.standing.add(handle);
    return {
      unsub: () => {
        this.standing.delete(handle);
        handle.unobserve();
      },
    };
  }

  /**
   * Never throws, and never reports failure.
   *
   * The worker keeps a durable outbox: a relay that does not accept still owes
   * delivery and is retried on reconnect. So zero acceptances means "queued",
   * not "lost", and a caller that treated it as an error would republish an
   * event the worker is already holding.
   */
  async publish(relays: string[], event: Event, timeoutMs?: number): Promise<void> {
    const delivered = this.dataLayer.publishEvent(
      event,
      relays.length > 0 ? { relays } : undefined,
    );
    // Capped like the SimplePool runtime it replaces: a relay that never answers
    // must not hold a caller open. The event is already stored locally and owed
    // to that relay, so returning early loses nothing.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs ?? this.publishTimeoutMs);
    });
    await Promise.race([delivered, cap]);
    clearTimeout(timer);
  }

  /**
   * Drops the interests this runtime opened. The worker and the data layer
   * outlive it — boot spawned them and boot tears them down — but a standing
   * interest left behind would keep a socket open for a runtime nobody holds.
   */
  dispose(): void {
    for (const handle of this.standing) handle.unobserve();
    this.standing.clear();
  }
}
