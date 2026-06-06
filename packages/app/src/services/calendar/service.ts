import {
  signerManager,
  nostrRuntime,
  relayManager,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
  wrapEvent,
} from "@formstr/core";
import type { SubscriptionHandle } from "@formstr/core";
import type { EventTemplate, Event, Filter } from "nostr-tools";

import { encodeCalendarList, decodeCalendarList } from "./calendarListCodec";
import { extractInvitationFromWrap, type InvitationRumor } from "./rsvp";
import {
  CALENDAR_KINDS,
  type CalendarEvent,
  type CalendarList,
  type CalendarEventDraft,
} from "./types";
import { generateViewKey, encryptWithViewKey, decryptWithViewKey, parseEventRef } from "./viewKey";

// ── Publish Public Event ────────────────────────────────

export async function publishPublicCalendarEvent(
  draft: CalendarEventDraft,
): Promise<CalendarEvent> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const eventId = draft.existingId ?? crypto.randomUUID().slice(0, 8);

  const tags: string[][] = [
    ["d", eventId],
    ["title", draft.title],
    ["description", draft.description],
    ["start", String(Math.floor(draft.begin.getTime() / 1000))],
    ["end", String(Math.floor(draft.end.getTime() / 1000))],
  ];

  if (draft.location) tags.push(["location", draft.location]);
  if (draft.website) tags.push(["r", draft.website]);
  if (draft.image) tags.push(["image", draft.image]);

  for (const cat of draft.categories ?? []) tags.push(["t", cat]);
  for (const p of draft.participants ?? []) tags.push(["p", p]);

  if (draft.startTzid) tags.push(["start_tzid", draft.startTzid]);
  if (draft.endTzid) tags.push(["end_tzid", draft.endTzid]);
  if (draft.rrule) {
    // NIP-32 label-pair, two-element ["l", RRULE] — exactly the shape the
    // standalone writes + reads (it takes the tag right after ["L","rrule"]).
    tags.push(["L", "rrule"]);
    tags.push(["l", draft.rrule]);
  }
  if (draft.registrationFormRef) tags.push(["form", draft.registrationFormRef]);

  const event: EventTemplate = {
    kind: CALENDAR_KINDS.publicEvent,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };

  const signed = await signer.signEvent(event);
  const relays = relayManager.getRelaysForModule("calendar");
  await nostrRuntime.publish(relays, signed);

  return {
    id: eventId,
    eventId: signed.id,
    title: draft.title,
    description: draft.description,
    kind: CALENDAR_KINDS.publicEvent,
    relayHint: relays[0] ?? "",
    begin: draft.begin.getTime(),
    end: draft.end.getTime(),
    createdAt: signed.created_at,
    categories: draft.categories ?? [],
    participants: draft.participants ?? [],
    location: draft.location ? [draft.location] : [],
    website: draft.website ?? "",
    user: pubkey,
    isPrivate: false,
    repeat: { rrule: draft.rrule ?? null },
    startTzid: draft.startTzid,
    endTzid: draft.endTzid,
    registrationFormRef: draft.registrationFormRef,
    event: signed,
  };
}

// ── Publish Private Event ───────────────────────────────

export async function publishPrivateCalendarEvent(
  draft: CalendarEventDraft,
  calendarId: string,
): Promise<CalendarEvent> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const eventId = draft.existingId ?? crypto.randomUUID().slice(0, 8);

  // The encrypted payload mirrors the standalone's preparePrivateCalendarEvent.
  // Critically it carries an inner ["d", id]: the standalone's viewPrivateEvent
  // REPLACES the event's tags with this decrypted array, then reads the event
  // id from the "d" row. Without it every super-app private event collapses
  // under id "" in calendar.formstr.app and only one survives.
  const eventData: string[][] = [
    ["title", draft.title],
    ["description", draft.description],
    ["start", String(Math.floor(draft.begin.getTime() / 1000))],
    ["end", String(Math.floor(draft.end.getTime() / 1000))],
    ["d", eventId],
  ];

  if (draft.image) eventData.push(["image", draft.image]);
  if (draft.location) eventData.push(["location", draft.location]);
  for (const cat of draft.categories ?? []) eventData.push(["t", cat]);
  for (const p of draft.participants ?? []) eventData.push(["p", p]);

  if (draft.startTzid) eventData.push(["start_tzid", draft.startTzid]);
  if (draft.endTzid) eventData.push(["end_tzid", draft.endTzid]);
  if (draft.rrule) {
    // Two-element ["l", RRULE] label, matching the standalone exactly.
    eventData.push(["L", "rrule"]);
    eventData.push(["l", draft.rrule]);
  }
  if (draft.registrationFormRef) eventData.push(["form", draft.registrationFormRef]);

  // Encrypt the content with a per-event viewKey (shareable with invitees),
  // matching the standalone. On edit we re-use the supplied key so existing
  // invitees keep access; on create we mint a fresh one.
  const viewKeyNsec = draft.viewKey ?? generateViewKey().nsec;
  const content = await encryptWithViewKey(viewKeyNsec, JSON.stringify(eventData));

  const event: EventTemplate = {
    kind: CALENDAR_KINDS.privateEvent,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", eventId]],
    content,
  };

  const signed = await signer.signEvent(event);
  const relays = relayManager.getRelaysForModule("calendar");
  await nostrRuntime.publish(relays, signed);

  const relayHint = relays[0] ?? "";
  const coordinate = `${CALENDAR_KINDS.privateEvent}:${pubkey}:${eventId}`;

  // Send NIP-59 invitations: a gift-wrapped rumor carrying the addressable
  // coordinate (+ relay hint) and the viewKey nsec, exactly as the standalone
  // expects (see upstream getDetailsFromGiftWrap). Empty content; data is in tags.
  if (draft.participants?.length) {
    for (const participant of draft.participants) {
      const wrap = await wrapEvent(
        {
          kind: CALENDAR_KINDS.rumor,
          content: "",
          tags: [
            ["a", coordinate, relayHint],
            ["viewKey", viewKeyNsec],
          ],
        },
        signer,
        participant,
        CALENDAR_KINDS.giftWrap,
      );
      await nostrRuntime.publish(relays, wrap);
    }
  }

  return {
    id: eventId,
    eventId: signed.id,
    title: draft.title,
    description: draft.description,
    kind: CALENDAR_KINDS.privateEvent,
    begin: draft.begin.getTime(),
    end: draft.end.getTime(),
    createdAt: signed.created_at,
    image: draft.image,
    categories: draft.categories ?? [],
    participants: draft.participants ?? [],
    location: draft.location ? [draft.location] : [],
    website: draft.website ?? "",
    user: pubkey,
    isPrivate: true,
    viewKey: viewKeyNsec,
    relayHint,
    calendarId,
    repeat: { rrule: draft.rrule ?? null },
    startTzid: draft.startTzid,
    endTzid: draft.endTzid,
    registrationFormRef: draft.registrationFormRef,
    event: signed,
  };
}

// ── Fetch Calendar Events ───────────────────────────────

export interface FetchCalendarEventsParams {
  since?: number; // unix seconds
  until?: number;
  authors?: string[];
}

export function subscribeToCalendarEvents(
  params: FetchCalendarEventsParams,
  onEvent: (event: CalendarEvent) => void,
  onEose?: () => void,
): SubscriptionHandle {
  const relays = relayManager.getRelaysForModule("calendar");

  const filter: Filter = {
    kinds: [CALENDAR_KINDS.publicEvent],
    ...(params.since && { since: params.since }),
    ...(params.until && { until: params.until }),
    ...(params.authors && { authors: params.authors }),
  };

  return nostrRuntime.subscribe(relays, [filter], {
    onEvent: async (event: Event) => {
      const parsed = await parseCalendarEvent(event);
      if (parsed) onEvent(parsed);
    },
    onEose,
  });
}

export async function fetchCalendarEventsSync(
  params: FetchCalendarEventsParams,
): Promise<CalendarEvent[]> {
  const relays = relayManager.getRelaysForModule("calendar");

  const filter: Filter = {
    kinds: [CALENDAR_KINDS.publicEvent, CALENDAR_KINDS.privateEvent],
    ...(params.since && { since: params.since }),
    ...(params.until && { until: params.until }),
    ...(params.authors && { authors: params.authors }),
  };

  const events = await nostrRuntime.querySync(relays, filter);

  // Honor NIP-09 deletions here too so the MCP listing (its caller) matches the
  // UI and a deleted event never resurfaces.
  const eventAuthors = new Set(events.map((e) => e.pubkey));
  const deletions = await fetchDeletions(relays, [...eventAuthors]);
  const survivors = events.filter((e) => !isEventDeleted(e, deletions));

  const parsed = await Promise.all(survivors.map((e) => parseCalendarEvent(e)));
  return parsed.filter((e: CalendarEvent | null): e is CalendarEvent => e !== null);
}

/**
 * NIP-09 deletion index. Maps a deleted addressable coordinate to the newest
 * deletion's `created_at` (an addressable event is only hidden when its own
 * `created_at` is ≤ that, so a legitimate re-publish after a delete survives),
 * and a set of `${author}:${eventId}` keys for deleted non-replaceable events.
 */
export interface DeletionIndex {
  coordTimes: Map<string, number>;
  ids: Set<string>;
}

/**
 * Fetch the kind-5 deletion events authored by `authors` and index them.
 *
 * The standalone applies deletions at fetch time (its EventStore tracks
 * `deletedCoordinates`/`deletedEventIds`); the super-app must do the same or a
 * deleted event silently re-appears on the next refresh, because most relays
 * keep serving addressable events after a NIP-09 request and the super-app's
 * direct author query re-fetches them. Same-author rule: a deletion only counts
 * against a coordinate whose author matches the deleter.
 */
export async function fetchDeletions(relays: string[], authors: string[]): Promise<DeletionIndex> {
  const coordTimes = new Map<string, number>();
  const ids = new Set<string>();
  if (authors.length === 0) return { coordTimes, ids };

  const events = await nostrRuntime.querySync(relays, { kinds: [5], authors } as Filter);
  for (const ev of events) {
    for (const tag of ev.tags) {
      if (tag[0] === "a" && tag[1]) {
        const author = tag[1].split(":")[1];
        if (author && author !== ev.pubkey) continue; // forgery guard
        const prev = coordTimes.get(tag[1]) ?? 0;
        if (ev.created_at > prev) coordTimes.set(tag[1], ev.created_at);
      } else if (tag[0] === "e" && tag[1]) {
        ids.add(`${ev.pubkey}:${tag[1]}`);
      }
    }
  }
  return { coordTimes, ids };
}

/** True when `event` has been tombstoned by a kind-5 deletion in `index`. */
export function isEventDeleted(event: Event, index: DeletionIndex): boolean {
  if (index.ids.has(`${event.pubkey}:${event.id}`)) return true;
  const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  const delTime = index.coordTimes.get(`${event.kind}:${event.pubkey}:${dTag}`);
  return delTime !== undefined && event.created_at <= delTime;
}

/**
 * Fetch the calendar events visible to the current user, deduped newest-wins by
 * addressable coordinate. Combines two sources, matching the standalone:
 *
 *  1. **Direct** — public + private events by author. When `opts.authors` is
 *     omitted (and no window is given) this defaults to the signed-in user, so a
 *     plain `fetchEvents()` returns *your* events regardless of which month they
 *     fall in. There is intentionally **no `created_at` window** here: relays
 *     filter `since`/`until` against publish time, not the event's `start`, so a
 *     month-coupled window silently drops events created in a different month
 *     than they occur (the cross-app "doesn't sync" bug). The views filter by
 *     event date client-side instead.
 *  2. **Referenced** — private events listed in the supplied calendar lists'
 *     `eventRefs`. Each ref carries the per-event **viewKey**, so private events
 *     authored in calendar.formstr.app (or by other members of a shared
 *     calendar) decrypt correctly — a plain author query can't, because their
 *     content is encrypted to the viewKey, not the author's own key.
 *
 * Pass `opts.since` (no `authors`) to browse a window of all-public events.
 */
export async function fetchCalendarEventsForUser(
  calendars: CalendarList[],
  opts: { authors?: string[]; since?: number; until?: number } = {},
): Promise<CalendarEvent[]> {
  const relays = relayManager.getRelaysForModule("calendar");

  // Default the direct query to the signed-in user unless an explicit author
  // list or browse window was provided.
  let authors = opts.authors;
  if (!authors && !opts.since && !opts.until) {
    try {
      authors = [await (await signerManager.getSigner()).getPublicKey()];
    } catch {
      // Anonymous — fall through to an unfiltered (windowless) public query.
    }
  }

  const collected = new Map<string, { event: Event; viewKey?: string }>();
  const consider = (event: Event, viewKey?: string) => {
    const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
    const coordinate = `${event.kind}:${event.pubkey}:${dTag}`;
    const existing = collected.get(coordinate);
    if (!existing || event.created_at > existing.event.created_at) {
      collected.set(coordinate, { event, viewKey: viewKey ?? existing?.viewKey });
    } else if (viewKey && !existing.viewKey) {
      existing.viewKey = viewKey;
    }
  };

  // 1) Direct events by author / browse window. With an author list (own
  // events) we include private kinds — those decrypt via the viewKey held in
  // our calendar lists. Without authors ("show all public") we fetch ONLY
  // public events: foreign private events can't be decrypted and would surface
  // as "Untitled" noise; private members still arrive via eventRefs below.
  const directFilter: Filter = {
    kinds: authors
      ? [CALENDAR_KINDS.publicEvent, CALENDAR_KINDS.privateEvent, CALENDAR_KINDS.privateRecurring]
      : [CALENDAR_KINDS.publicEvent],
    ...(authors && { authors }),
    ...(opts.since && { since: opts.since }),
    ...(opts.until && { until: opts.until }),
  };
  for (const event of await nostrRuntime.querySync(relays, directFilter)) consider(event);

  // 2) Private members referenced (with viewKeys) by the calendar lists.
  const kinds = new Set<number>();
  const refAuthors = new Set<string>();
  const dTags = new Set<string>();
  const viewKeyByCoordinate = new Map<string, string>();
  for (const cal of calendars) {
    for (const ref of cal.eventRefs) {
      const { coordinate, viewKey } = parseEventRef(ref);
      const [kindStr, author, dTag] = coordinate.split(":");
      const kind = Number(kindStr);
      if (!kind || !author || !dTag) continue;
      kinds.add(kind);
      refAuthors.add(author);
      dTags.add(dTag);
      if (viewKey) viewKeyByCoordinate.set(coordinate, viewKey);
    }
  }
  if (dTags.size > 0) {
    const refFilter = {
      kinds: [...kinds],
      authors: [...refAuthors],
      "#d": [...dTags],
    } as Filter;
    for (const event of await nostrRuntime.querySync(relays, refFilter)) {
      const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
      consider(event, viewKeyByCoordinate.get(`${event.kind}:${event.pubkey}:${dTag}`));
    }
  }

  // Drop anything the author deleted via NIP-09. Without this a deleted event
  // re-appears on every refresh (relays keep serving it; the direct query above
  // re-fetches it). Query deletions for exactly the authors whose events we
  // collected so the kind-5 lookup stays bounded.
  const eventAuthors = new Set<string>();
  for (const { event } of collected.values()) eventAuthors.add(event.pubkey);
  const deletions = await fetchDeletions(relays, [...eventAuthors]);
  const survivors = [...collected.values()].filter(
    ({ event }) => !isEventDeleted(event, deletions),
  );

  const parsed = await Promise.all(
    survivors.map(({ event, viewKey }) => parseCalendarEvent(event, viewKey)),
  );
  return parsed.filter((e: CalendarEvent | null): e is CalendarEvent => e !== null);
}

/**
 * Fetch + parse a single calendar event referenced by an addressable
 * coordinate `kind:pubkey:dTag`. Returns null on a malformed coordinate or miss.
 */
export async function fetchCalendarEventByCoordinate(
  coordinate: string,
  viewKey?: string,
): Promise<CalendarEvent | null> {
  const [kindStr, pubkey, dTag] = coordinate.split(":");
  const kind = Number(kindStr);
  if (!kind || !pubkey || !dTag) return null;

  const relays = relayManager.getRelaysForModule("calendar");
  const events = await nostrRuntime.querySync(relays, {
    kinds: [kind],
    authors: [pubkey],
    "#d": [dTag],
  } as Filter);
  if (events.length === 0) return null;

  // Newest-wins (addressable events can diverge across relays).
  const newest = events.reduce((a, b) => (b.created_at > a.created_at ? b : a));
  return parseCalendarEvent(newest, viewKey);
}

// ── Calendar List CRUD ──────────────────────────────────

export async function createCalendarList(
  title: string,
  color: string,
  description = "",
): Promise<CalendarList> {
  const signer = await signerManager.getSigner();
  const id = crypto.randomUUID().slice(0, 8);

  const calendarData: CalendarList = {
    id,
    eventId: "",
    title,
    description,
    color,
    eventRefs: [],
    createdAt: Math.floor(Date.now() / 1000),
    isVisible: true,
  };

  const content = await nip44SelfEncrypt(signer, JSON.stringify(encodeCalendarList(calendarData)));

  const event: EventTemplate = {
    kind: CALENDAR_KINDS.calendarList,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", id]],
    content,
  };

  const signed = await signer.signEvent(event);
  const relays = relayManager.getRelaysForModule("calendar");
  await nostrRuntime.publish(relays, signed);

  return { ...calendarData, eventId: signed.id };
}

export async function updateCalendarList(calendarList: CalendarList): Promise<CalendarList> {
  const signer = await signerManager.getSigner();

  const content = await nip44SelfEncrypt(signer, JSON.stringify(encodeCalendarList(calendarList)));

  const event: EventTemplate = {
    kind: CALENDAR_KINDS.calendarList,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", calendarList.id]],
    content,
  };

  const signed = await signer.signEvent(event);
  const relays = relayManager.getRelaysForModule("calendar");
  await nostrRuntime.publish(relays, signed);

  return { ...calendarList, eventId: signed.id };
}

export async function fetchCalendarLists(): Promise<CalendarList[]> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const relays = relayManager.getRelaysForModule("calendar");

  const filter: Filter = {
    kinds: [CALENDAR_KINDS.calendarList],
    authors: [pubkey],
  };

  const events = await nostrRuntime.querySync(relays, filter);

  // Newest-wins per d-tag: relays (and an old object-format version coexisting
  // with the healed tags-array version) can return duplicates, which otherwise
  // surface as duplicate calendars in the sidebar.
  const newest = new Map<string, Event>();
  for (const event of events) {
    const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
    const prev = newest.get(dTag);
    if (!prev || event.created_at > prev.created_at) newest.set(dTag, event);
  }

  // Honor NIP-09 deletions so a deleted calendar stays gone after a refresh
  // (same root cause as deleted events). Filter BEFORE the heal step below so a
  // deleted object-format list is never re-published back to life.
  const deletions = await fetchDeletions(relays, [pubkey]);

  const lists: CalendarList[] = [];
  for (const [dTag, event] of newest) {
    if (isEventDeleted(event, deletions)) continue;
    try {
      const decrypted = await nip44SelfDecrypt(signer, event.content);
      const parsed = JSON.parse(decrypted) as unknown;
      if (Array.isArray(parsed)) {
        lists.push(decodeCalendarList(parsed as string[][], dTag, event.id));
      } else if (parsed && typeof parsed === "object") {
        // Legacy super-app **object** payload. Load it AND re-publish it as the
        // standalone's tags-array shape: calendar.formstr.app rejects object
        // payloads, and (in deployed builds) that throw aborts its entire
        // calendar-list load — so an object list left on relays makes *none* of
        // the user's super-app events appear there. Healing it removes the
        // trigger. Self-limiting: once republished (tags array, newer
        // created_at) the next fetch sees an array and won't re-heal.
        const obj = parsed as Record<string, unknown>;
        const legacy: CalendarList = {
          id: dTag,
          eventId: event.id,
          title: typeof obj.title === "string" ? obj.title : "Calendar",
          description: typeof obj.description === "string" ? obj.description : "",
          color: typeof obj.color === "string" ? obj.color : "#334155",
          eventRefs: Array.isArray(obj.eventRefs) ? (obj.eventRefs as string[][]) : [],
          createdAt: typeof obj.createdAt === "number" ? obj.createdAt : 0,
          isVisible: obj.isVisible !== false,
        };
        lists.push(legacy);
        void updateCalendarList(legacy).catch(() => {
          // Best-effort heal — the list still loads locally regardless.
        });
      }
    } catch {
      // Skip corrupted entries
    }
  }

  return lists;
}

// ── Event ↔ Calendar membership ─────────────────────────

/**
 * Adds an event reference to a calendar list and republishes the updated list.
 * Deduplicates by coordinate (the first element of the ref); when the
 * coordinate is already present this is a no-op that returns the list unchanged
 * without republishing.
 *
 * @param calendarList - The list to update
 * @param eventRef - ["{kind}:{authorPubkey}:{dTag}", "{relayHint}", "{viewKey}"]
 */
export async function addEventToCalendarList(
  calendarList: CalendarList,
  eventRef: string[],
): Promise<CalendarList> {
  if (calendarList.eventRefs.some((ref) => ref[0] === eventRef[0])) {
    return calendarList;
  }

  const updated: CalendarList = {
    ...calendarList,
    eventRefs: [...calendarList.eventRefs, eventRef],
    createdAt: Math.floor(Date.now() / 1000),
  };

  return updateCalendarList(updated);
}

/**
 * Removes the event reference matching `eventCoordinate` and republishes.
 *
 * @param calendarList - The list to update
 * @param eventCoordinate - "{kind}:{authorPubkey}:{dTag}"
 */
export async function removeEventFromCalendarList(
  calendarList: CalendarList,
  eventCoordinate: string,
): Promise<CalendarList> {
  const updated: CalendarList = {
    ...calendarList,
    eventRefs: calendarList.eventRefs.filter((ref) => ref[0] !== eventCoordinate),
    createdAt: Math.floor(Date.now() / 1000),
  };

  return updateCalendarList(updated);
}

/**
 * Moves an event from whichever list currently holds it to `targetCalendarId`.
 * Returns `null` when the event is already in the target (no work needed); the
 * source republish is skipped when no other list holds the coordinate.
 *
 * @param calendars - All known lists to search for the current owner
 * @param targetCalendarId - Destination list id
 * @param eventCoordinate - "{kind}:{authorPubkey}:{dTag}"
 * @param eventRef - Full ref to add to the destination
 */
export async function moveEventBetweenCalendarLists(
  calendars: CalendarList[],
  targetCalendarId: string,
  eventCoordinate: string,
  eventRef: string[],
): Promise<{ source?: CalendarList; target: CalendarList } | null> {
  const targetCalendar = calendars.find((cal) => cal.id === targetCalendarId);
  if (!targetCalendar) {
    throw new Error(`Target calendar not found: ${targetCalendarId}`);
  }

  // Already in the target — nothing to move.
  if (targetCalendar.eventRefs.some((ref) => ref[0] === eventCoordinate)) {
    return null;
  }

  const sourceCalendar = calendars.find(
    (cal) => cal.id !== targetCalendarId && cal.eventRefs.some((ref) => ref[0] === eventCoordinate),
  );

  const source = sourceCalendar
    ? await removeEventFromCalendarList(sourceCalendar, eventCoordinate)
    : undefined;
  const target = await addEventToCalendarList(targetCalendar, eventRef);

  return { source, target };
}

// ── Delete Event ────────────────────────────────────────

export async function deleteCalendarEvent(eventId: string, coordinate?: string): Promise<void> {
  const signer = await signerManager.getSigner();

  const kindFromCoord = coordinate ? Number(coordinate.split(":")[0]) : NaN;
  const kind =
    Number.isFinite(kindFromCoord) && kindFromCoord ? kindFromCoord : CALENDAR_KINDS.publicEvent;

  const tags: string[][] = [["k", String(kind)]];
  if (coordinate) tags.push(["a", coordinate]);
  if (eventId && /^[0-9a-f]{64}$/i.test(eventId)) tags.push(["e", eventId]);

  const event: EventTemplate = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "Deleted via Formstr",
  };

  const signed = await signer.signEvent(event);
  const relays = relayManager.getRelaysForModule("calendar");
  await nostrRuntime.publish(relays, signed);
}

/**
 * Delete a calendar list (addressable kind-32123) via NIP-09, mirroring
 * {@link deleteCalendarEvent}.
 *
 * @param coordinate - "32123:{authorPubkey}:{dTag}"
 */
export async function deleteCalendarList(coordinate: string): Promise<void> {
  const signer = await signerManager.getSigner();
  const kind = Number(coordinate.split(":")[0]) || CALENDAR_KINDS.calendarList;

  const event: EventTemplate = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["k", String(kind)],
      ["a", coordinate],
    ],
    content: "Deleted via Formstr",
  };

  const signed = await signer.signEvent(event);
  const relays = relayManager.getRelaysForModule("calendar");
  await nostrRuntime.publish(relays, signed);
}

// ── Helpers ─────────────────────────────────────────────

export async function parseCalendarEvent(
  event: Event,
  viewKey?: string,
): Promise<CalendarEvent | null> {
  const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  const isPrivate = event.kind !== CALENDAR_KINDS.publicEvent;

  // For private events, attempt to decrypt the content to recover tags.
  let tags = event.tags;
  if (isPrivate && event.content) {
    try {
      // Prefer the shared viewKey (interop: any invitee holding the nsec can
      // decrypt). Fall back to author-only self-decryption for legacy events.
      const decrypted = viewKey
        ? await decryptWithViewKey(viewKey, event.content)
        : await nip44SelfDecrypt(await signerManager.getSigner(), event.content);
      const parsed = JSON.parse(decrypted) as string[][];
      if (Array.isArray(parsed)) {
        // Merge decrypted tags with original event tags (keep "d" tag from original)
        tags = [...event.tags, ...parsed];
      }
    } catch {
      // Decryption failed — event may belong to another user or use a viewKey
      // we don't hold. Fall through to parse with whatever tags are available.
    }
  }

  const title =
    tags.find((t) => t[0] === "title")?.[1] ?? tags.find((t) => t[0] === "name")?.[1] ?? "Untitled";
  // Standalone public events put the description in `content`, not a tag.
  // For private events content is encrypted ciphertext — never use it as text.
  const description =
    tags.find((t) => t[0] === "description")?.[1] ?? (isPrivate ? "" : (event.content ?? ""));
  const start = tags.find((t) => t[0] === "start")?.[1];
  const end = tags.find((t) => t[0] === "end")?.[1];
  const location = tags.filter((t) => t[0] === "location").map((t) => t[1]);
  const categories = tags.filter((t) => t[0] === "t").map((t) => t[1]);
  const participants = tags.filter((t) => t[0] === "p").map((t) => t[1]);
  const image = tags.find((t) => t[0] === "image")?.[1];
  const website = tags.find((t) => t[0] === "r")?.[1] ?? "";
  // Recurrence. The standalone writes NIP-32 labels: ["L","rrule"] followed by
  // a 2-element ["l", <RRULE>]. The super-app (historically) wrote a 3-element
  // ["l", <RRULE>, "rrule"]. Read both, else a legacy ["rrule", <RRULE>] —
  // otherwise an upstream-authored recurring event never expands here.
  const hasRruleLabel = tags.some((t) => t[0] === "L" && t[1] === "rrule");
  const rrule =
    tags.find((t) => t[0] === "l" && t[2] === "rrule")?.[1] ??
    (hasRruleLabel ? tags.find((t) => t[0] === "l")?.[1] : undefined) ??
    tags.find((t) => t[0] === "rrule")?.[1] ??
    null;
  const startTzid = tags.find((t) => t[0] === "start_tzid")?.[1];
  const endTzid = tags.find((t) => t[0] === "end_tzid")?.[1];
  const registrationFormRef = tags.find((t) => t[0] === "form")?.[1];

  return {
    id: dTag,
    eventId: event.id,
    title,
    description,
    kind: event.kind,
    begin: start ? Number(start) * 1000 : event.created_at * 1000,
    end: end ? Number(end) * 1000 : event.created_at * 1000 + 3600000,
    createdAt: event.created_at,
    image,
    categories,
    participants,
    location,
    website,
    user: event.pubkey,
    isPrivate,
    viewKey,
    repeat: { rrule },
    startTzid,
    endTzid,
    registrationFormRef,
    event,
  };
}

export interface InvitationWithEvent extends InvitationRumor {
  event?: CalendarEvent;
}

/**
 * Stateless fetch of NIP-59 calendar invitations addressed to the current user.
 * Mirrors the live `invitationsStore` subscription but as a one-shot query so
 * non-UI callers (e.g. the MCP server) can list invitations.
 */
export async function fetchInvitationsSync(): Promise<InvitationWithEvent[]> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const relays = relayManager.getRelaysForModule("calendar");

  const wraps = await nostrRuntime.querySync(relays, {
    kinds: [CALENDAR_KINDS.giftWrap, CALENDAR_KINDS.rsvpGiftWrap],
    "#p": [pubkey],
  } as Filter);

  const seen = new Set<string>();
  const out: InvitationWithEvent[] = [];
  for (const wrap of wraps) {
    if (seen.has(wrap.id)) continue;
    seen.add(wrap.id);
    const invitation = await extractInvitationFromWrap(wrap);
    if (!invitation) continue;
    const event = await fetchCalendarEventByCoordinate(
      invitation.eventCoordinate,
      invitation.viewKey,
    );
    out.push({ ...invitation, event: event ?? undefined });
  }
  return out;
}
