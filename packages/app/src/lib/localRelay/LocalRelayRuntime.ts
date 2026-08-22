import type { NostrRuntimeContract, SubscribeOptions, SubscriptionHandle } from "@formstr/core";
import type { DataLayer } from "@formstr/local-relay";
import type { Event, Filter } from "nostr-tools";

export interface LocalRelayRuntimeOptions {
  /** Hard cap on a one-shot read, so it can never hang. */
  timeoutMs?: number;
  /** Settle once this long passes with no new event. */
  quietMs?: number;
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
    this.warmGraceMs = options.warmGraceMs ?? 150;
    this.isWarm = options.isWarm ?? (() => false);
  }

  querySync(relays: string[], filter: Filter, timeoutMs?: number): Promise<Event[]> {
    return new Promise((resolve) => {
      const collected = new Map<string, Event>();
      const warm = this.isWarm(filter);
      const quiet = warm ? this.warmGraceMs : this.quietMs;
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

      // Arm the settle timer up front for a warm scope, instead of waiting for a
      // first event that may never come. On a scope the worker keeps current,
      // "there is nothing here" is an answer, not a slow start — and the reads
      // most often empty are the ones paired with every fetch, like the deletion
      // query beside a card read. Left to the hard cap those cost seconds each
      // and set the floor for the whole operation.
      if (warm) quietTimer = setTimeout(finish, quiet);
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
      // Same reasoning as `querySync`: on a scope the worker keeps current, a
      // miss is known quickly and need not wait out the hard cap.
      if (this.isWarm(filter)) setTimeout(() => finish(null), this.warmGraceMs);
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
   * Resolves once the worker owns the event — not once relays have acknowledged
   * it.
   *
   * The worker stores the event and fans it out to live interests on receipt of
   * the publish frame, *before* it reaches for a socket, and any relay that does
   * not accept becomes durable outbox debt retried on reconnect. So by the time
   * this returns, the event is in the store, on its way to every target, and
   * owed to the ones that miss it. Waiting for the acknowledgements on top of
   * that buys no guarantee and costs the caller the slowest relay in the set:
   * one dead relay in a module's list used to freeze a "Saving…" dialog for
   * seconds, which is worse than the fire-and-forget this replaced.
   *
   * Ordering still holds for a read that follows a write. `publishEvent` posts
   * its frame synchronously, and the worker channel is FIFO, so an `observe`
   * issued after this returns is processed after the event is stored.
   */
  publish(relays: string[], event: Event): Promise<void> {
    void this.dataLayer
      .publishEvent(event, relays.length > 0 ? { relays } : undefined)
      .catch(() => {
        // Delivery is the outbox's business, and it never reports failure to the
        // app. Swallowing here only stops an unhandled rejection; a caller that
        // treated this as an error would republish an event the worker holds.
      });
    return Promise.resolve();
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
