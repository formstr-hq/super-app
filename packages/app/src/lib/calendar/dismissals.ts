import { nostrRuntime } from "@formstr/core";
import type { Event, Filter } from "nostr-tools";

/** The wraps and event coordinates the user has dismissed, by NIP-09 deletion. */
export interface DismissalIndex {
  /** Gift-wrap ids, from `e` rows. */
  ids: Set<string>;
  /** Event coordinates, from `a` rows — covers a re-sent wrap with a new id. */
  coordinates: Set<string>;
}

/**
 * The user's own invitation dismissals.
 *
 * `sdk.fetchInvitations()` applies these internally, but the live subscription
 * hands over raw wraps and knows nothing about them — and a relay replays its
 * whole backlog on subscribe, so without this every dismissed invitation
 * returns the moment the inbox opens. Self-authored deletions only: a kind-5
 * from anyone else says nothing about what this user wants to see.
 */
export async function fetchDismissals(pubkey: string, relays: string[]): Promise<DismissalIndex> {
  const index: DismissalIndex = { ids: new Set(), coordinates: new Set() };
  let events: Event[] = [];
  try {
    events = (await nostrRuntime.querySync(relays, {
      kinds: [5],
      authors: [pubkey],
    } as Filter)) as Event[];
  } catch {
    return index; // Unreachable relays must not block the inbox.
  }
  for (const event of events) {
    for (const tag of event.tags) {
      if (tag[0] === "e" && tag[1]) index.ids.add(tag[1]);
      if (tag[0] === "a" && tag[1]) index.coordinates.add(tag[1]);
    }
  }
  return index;
}
