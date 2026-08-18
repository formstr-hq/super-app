import {
  coordinate,
  fetchDeletions,
  isDeleted,
  type CalendarEvent,
  type CalendarList,
  type DeletionIndex,
} from "@formstr/calendar-sdk";
import { signerManager, nostrRuntime } from "@formstr/core";

import { calendarRelays, getCalendarSdk } from "./sdk";

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

/** kind-5 sweep across every author whose events we collected, in parallel. */
async function deletionsFor(authors: Iterable<string>): Promise<DeletionIndex[]> {
  const relays = calendarRelays();
  return Promise.all([...authors].map((a) => fetchDeletions(nostrRuntime, relays, a)));
}

function surviving(events: CalendarEvent[], indexes: DeletionIndex[]): CalendarEvent[] {
  return events.filter((event) => {
    const coord = coordinate(event.kind, event.user, event.id);
    return !indexes.some((index) => isDeleted(index, { id: event.eventId, coordinate: coord }));
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
 *  2. A NIP-09 deletion sweep (fanned out per collected author, since
 *     `fetchDeletions` is scoped to one author's own deletions): no SDK read
 *     path filters these, so a deleted event would otherwise resurface on
 *     every refresh.
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
  const sdk = await getCalendarSdk();
  const calendars = options.calendars ?? [];
  // A window (even since:0, the epoch) means "browse public events broadly" —
  // only default to self when neither bound was given.
  const windowed = options.since !== undefined || options.until !== undefined;
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

  return surviving(merged, await deletionsFor(new Set(merged.map((e) => e.user))));
}

/**
 * Direct query only, no calendar-list refs. The MCP `list_calendar_events` tool
 * has no list context to pass, matching the former `fetchCalendarEventsSync`.
 */
export async function fetchEventsDirect(
  options: Omit<DiscoveryOptions, "calendars"> = {},
): Promise<CalendarEvent[]> {
  return fetchEventsForUser({ ...options, calendars: [] });
}
