import { coordinate, type CalendarEvent, type CalendarList } from "@formstr/calendar-sdk";
import { signerManager, nostrRuntime } from "@formstr/core";
import type { Event, Filter } from "nostr-tools";

import { calendarRelays, getAnonymousCalendarSdk, getCalendarSdk } from "./sdk";

export interface DiscoveryOptions {
  /** Pre-fetched calendar lists, whose refs carry the view keys. */
  calendars?: readonly CalendarList[];
  /** Defaults to the signed-in user. */
  authors?: string[];
  since?: number;
  until?: number;
}

async function selfPubkey(): Promise<string | undefined> {
  try {
    return await (await signerManager.getSigner()).getPublicKey();
  } catch {
    return undefined; // anonymous — public browse only
  }
}

/**
 * NIP-09 deletion index. Maps a deleted addressable coordinate to the newest
 * deletion's `created_at` — an addressable event is only hidden when its own
 * `created_at` is at or below that, so a legitimate republish after a delete
 * survives — plus `${author}:${eventId}` keys for non-replaceable events.
 *
 * The SDK's own `fetchDeletions`/`isDeleted` are deliberately not used here:
 * that index is per-author, timestamp-free and keyed on the bare id, so
 * merging several authors' indexes lets any author's `a` row hide any other
 * author's event, and a republish stays hidden forever. See
 * docs/sdk/calendar-sdk-followups.md item 1.
 */
interface DeletionIndex {
  coordTimes: Map<string, number>;
  ids: Set<string>;
}

/** One kind-5 query for every collected author, with the same-author rule applied. */
async function fetchDeletions(authors: string[]): Promise<DeletionIndex> {
  const coordTimes = new Map<string, number>();
  const ids = new Set<string>();
  if (authors.length === 0) return { coordTimes, ids };

  const events = await nostrRuntime.querySync(calendarRelays(), {
    kinds: [5],
    authors,
  } as Filter);

  for (const event of events as Event[]) {
    for (const tag of event.tags) {
      if (tag[0] === "a" && tag[1]) {
        // A deletion only binds a coordinate its own author owns; without this
        // anyone can tombstone anyone's event.
        if (tag[1].split(":")[1] !== event.pubkey) continue;
        const prev = coordTimes.get(tag[1]) ?? 0;
        if (event.created_at > prev) coordTimes.set(tag[1], event.created_at);
      } else if (tag[0] === "e" && tag[1]) {
        ids.add(`${event.pubkey}:${tag[1]}`);
      }
    }
  }
  return { coordTimes, ids };
}

function surviving(events: CalendarEvent[], index: DeletionIndex): CalendarEvent[] {
  return events.filter((event) => {
    if (event.eventId && index.ids.has(`${event.user}:${event.eventId}`)) return false;
    const deletedAt = index.coordTimes.get(coordinate(event.kind, event.user, event.id));
    return deletedAt === undefined || event.createdAt > deletedAt;
  });
}

/**
 * Every calendar event the user should see: the ones their calendar lists
 * reference (via the SDK, which also decrypts private members through the
 * ref's view key) plus a direct public query by author, minus anything the
 * author deleted.
 *
 * The two things this composer adds over `sdk.fetchEvents()`:
 *  1. A direct-by-author public-event query, so an authored event that was
 *     never linked into any calendar list is still discoverable — the SDK's
 *     only read path otherwise is through list refs.
 *  2. A NIP-09 deletion sweep: no SDK read path filters these, so a deleted
 *     event would otherwise resurface on every refresh.
 *
 * Author defaulting: with no `since`/`until` window and no explicit
 * `authors`, this defaults to the signed-in user's own events. With a window
 * and no explicit `authors`, it browses public events broadly instead —
 * mirroring the old `fetchCalendarEventsForUser`, whose "browse a window of
 * all-public-events" mode only worked because it did NOT default to self
 * once a window was given.
 *
 * There is no direct private-event query: a private event's view key lives
 * only in-memory at creation time, in a calendar list's `eventRefs`, or in a
 * gift-wrapped invitation — never recoverable from relays on its own — so an
 * unlinked private event is unreachable by any client, not just this one.
 * Private events already linked into `options.calendars` arrive correctly
 * decrypted through `sdk.fetchEventsFromCalendars`.
 *
 * Replaces the agent's former `fetchCalendarEventsForUser`. Candidate to move
 * into the SDK — see docs/sdk/calendar-sdk-followups.md item 1.
 */
export async function fetchEventsForUser(options: DiscoveryOptions = {}): Promise<CalendarEvent[]> {
  const calendars = options.calendars ?? [];
  // A window (even since:0, the epoch) means "browse public events broadly" —
  // only default to self when neither bound was given.
  const windowed = options.since !== undefined || options.until !== undefined;

  // Public browsing must work logged out. `getCalendarSdk()` resolves a signer,
  // which in the app routes to the login modal — a promise that never rejects,
  // so requiring it here would hang the "show all public" view for a visitor.
  // Decrypting list members or defaulting authors to self genuinely needs one.
  const needsSigner = !windowed || calendars.length > 0;
  const sdk =
    needsSigner || signerManager.getSignerIfAvailable()
      ? await getCalendarSdk()
      : await getAnonymousCalendarSdk();

  const authors = options.authors ?? (windowed ? [] : [(await selfPubkey()) ?? ""].filter(Boolean));

  const [fromLists, publicEvents] = await Promise.all([
    calendars.length > 0 ? sdk.fetchEventsFromCalendars(calendars) : Promise.resolve([]),
    sdk.fetchPublicEvents({
      ...(authors.length > 0 && { authors }),
      ...(options.since !== undefined && { since: options.since }),
      ...(options.until !== undefined && { until: options.until }),
    }),
  ]);

  const byCoordinate = new Map<string, CalendarEvent>();
  for (const event of [...fromLists, ...publicEvents]) {
    const coord = coordinate(event.kind, event.user, event.id);
    const held = byCoordinate.get(coord);
    if (!held || event.createdAt > held.createdAt) byCoordinate.set(coord, event);
  }
  const merged = [...byCoordinate.values()];

  return surviving(merged, await fetchDeletions([...new Set(merged.map((e) => e.user))]));
}

/**
 * No calendar-list context supplied by the caller — the MCP `list_calendar_events`
 * tool has none to pass — so load the caller's own lists here. Without them the
 * only reachable events are public ones: a private event's view key lives in a
 * list ref, matching the former `fetchCalendarEventsSync`.
 */
export async function fetchEventsDirect(
  options: Omit<DiscoveryOptions, "calendars"> = {},
): Promise<CalendarEvent[]> {
  let calendars: CalendarList[] = [];
  try {
    calendars = await (await getCalendarSdk()).fetchCalendars();
  } catch {
    // Logged out or the list query failed — public events are still worth returning.
  }
  return fetchEventsForUser({ ...options, calendars });
}
