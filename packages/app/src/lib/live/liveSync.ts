import { nostrRuntime } from "@formstr/core";
import type { Filter } from "nostr-tools";

/** Something worth watching, and what to do when it changes. */
export interface LiveScope {
  /** Identity of the scope. Opening the same key again replaces it. */
  key: string;
  filters: Filter[];
  /** Relay targets on SimplePool, routing hints under the local relay. */
  relays: string[];
  onChange: () => void;
}

/** Wait this long for a burst to finish before invalidating. */
const COALESCE_MS = 250;

interface OpenScope {
  unsub: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Turns relay traffic into "this is stale, read it again".
 *
 * The stores stay the state container: nothing here decodes an event or touches
 * store state, it only says which slice is out of date. That is what lets the
 * whole thing reuse each store's existing fetch, and what keeps it working on
 * both network backends — it is built on `nostrRuntime.subscribe`, which the
 * SimplePool and local-relay runtimes both implement.
 */
export class LiveSync {
  private readonly open_ = new Map<string, OpenScope>();

  constructor(private readonly coalesceMs = COALESCE_MS) {}

  /** Declare a scope. Returns its closer; opening the same key also closes it. */
  open(scope: LiveScope): () => void {
    this.close(scope.key);

    // Under the local relay, `observe` replays the entire cache before firing
    // EOSE. Those are events the store is loading anyway, so treating them as
    // news would fire a refetch storm at login for data already on its way.
    // After EOSE every event is a genuine change. SimplePool reads the same way:
    // stored events, then EOSE, then the live tail.
    let live = false;

    const handle = nostrRuntime.subscribe(scope.relays, scope.filters, {
      onEose: () => {
        live = true;
      },
      onEvent: () => {
        if (!live) return;
        const entry = this.open_.get(scope.key);
        if (!entry) return;
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          entry.timer = undefined;
          scope.onChange();
        }, this.coalesceMs);
      },
    });

    this.open_.set(scope.key, { unsub: () => handle.unsub() });
    return () => this.close(scope.key);
  }

  /** Drop one scope. A debounce already ticking is cancelled, not flushed. */
  close(key: string): void {
    const entry = this.open_.get(key);
    if (!entry) return;
    this.open_.delete(key);
    clearTimeout(entry.timer);
    entry.unsub();
  }

  closeAll(): void {
    for (const key of [...this.open_.keys()]) this.close(key);
  }
}
