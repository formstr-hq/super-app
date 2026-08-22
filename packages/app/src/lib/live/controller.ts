import { refetchFor } from "./bindings";
import { LiveSync } from "./liveSync";
import { scopesFor } from "./scopes";
import { singleFlight } from "./singleFlight";

let live: LiveSync | null = null;
let watching: string | null = null;

/**
 * Point live sync at one account, or shut it down.
 *
 * Called from the same place that retargets the local-relay session, but
 * deliberately outside its kill switch: reactivity is built on the runtime
 * contract, which both backends implement, so it works whether or not the app is
 * running on the local relay. The substrate makes the refetches fast; it is not
 * what makes them possible.
 */
export function retargetLiveSync(pubkey: string | null): void {
  if (pubkey === watching) return;

  live?.closeAll();
  live = null;
  watching = null;
  if (!pubkey) return;

  live = new LiveSync();
  watching = pubkey;

  for (const scope of scopesFor(pubkey)) {
    if (!scope.watch) continue;
    const refetch = refetchFor(scope.module);
    if (!refetch) continue;

    // A store's refetch is idempotent, so overlapping invalidations collapse
    // into one re-run rather than stacking concurrent reads of the same scope.
    const run = singleFlight(refetch);
    live.open({
      key: scope.module,
      filters: scope.filters,
      relays: scope.relays,
      onChange: () => void run(),
    });
  }
}

/** The live sync in force, for stores that own a view scope. */
export function currentLiveSync(): LiveSync | null {
  return live;
}
