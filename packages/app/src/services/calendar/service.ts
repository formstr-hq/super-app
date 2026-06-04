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

import {
  CALENDAR_KINDS,
  type CalendarEvent,
  type CalendarList,
  type CalendarEventDraft,
} from "./types";

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
    tags.push(["L", "rrule"]);
    tags.push(["l", draft.rrule, "rrule"]);
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

  const eventData: string[][] = [
    ["title", draft.title],
    ["description", draft.description],
    ["start", String(Math.floor(draft.begin.getTime() / 1000))],
    ["end", String(Math.floor(draft.end.getTime() / 1000))],
  ];

  if (draft.location) eventData.push(["location", draft.location]);
  for (const cat of draft.categories ?? []) eventData.push(["t", cat]);
  for (const p of draft.participants ?? []) eventData.push(["p", p]);

  if (draft.startTzid) eventData.push(["start_tzid", draft.startTzid]);
  if (draft.endTzid) eventData.push(["end_tzid", draft.endTzid]);
  if (draft.rrule) {
    eventData.push(["L", "rrule"]);
    eventData.push(["l", draft.rrule, "rrule"]);
  }
  if (draft.registrationFormRef) eventData.push(["form", draft.registrationFormRef]);

  // Encrypt content with self-encryption
  const content = await nip44SelfEncrypt(signer, JSON.stringify(eventData));

  const event: EventTemplate = {
    kind: CALENDAR_KINDS.privateEvent,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", eventId]],
    content,
  };

  const signed = await signer.signEvent(event);
  const relays = relayManager.getRelaysForModule("calendar");
  await nostrRuntime.publish(relays, signed);

  // Send gift wraps to participants
  if (draft.participants?.length) {
    for (const participant of draft.participants) {
      const wrap = await wrapEvent(
        { kind: CALENDAR_KINDS.rumor, content: JSON.stringify({ eventId, calendarId }), tags: [] },
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
    categories: draft.categories ?? [],
    participants: draft.participants ?? [],
    location: draft.location ? [draft.location] : [],
    website: draft.website ?? "",
    user: pubkey,
    isPrivate: true,
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
  const parsed = await Promise.all(events.map(parseCalendarEvent));
  return parsed.filter((e: CalendarEvent | null): e is CalendarEvent => e !== null);
}

/**
 * Fetch + parse a single calendar event referenced by an addressable
 * coordinate `kind:pubkey:dTag`. Returns null on a malformed coordinate or miss.
 */
export async function fetchCalendarEventByCoordinate(
  coordinate: string,
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
  return parseCalendarEvent(newest);
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

  const content = await nip44SelfEncrypt(signer, JSON.stringify(calendarData));

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

  const content = await nip44SelfEncrypt(signer, JSON.stringify(calendarList));

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
  const lists: CalendarList[] = [];

  for (const event of events) {
    try {
      const decrypted = await nip44SelfDecrypt(signer, event.content);
      const data = JSON.parse(decrypted) as CalendarList;
      data.eventId = event.id;
      lists.push(data);
    } catch {
      // Skip corrupted entries
    }
  }

  return lists;
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

// ── Helpers ─────────────────────────────────────────────

export async function parseCalendarEvent(event: Event): Promise<CalendarEvent | null> {
  const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  const isPrivate = event.kind !== CALENDAR_KINDS.publicEvent;

  // For private events, attempt to decrypt the content to recover tags
  let tags = event.tags;
  if (isPrivate && event.content) {
    try {
      const signer = await signerManager.getSigner();
      const decrypted = await nip44SelfDecrypt(signer, event.content);
      const parsed = JSON.parse(decrypted) as string[][];
      if (Array.isArray(parsed)) {
        // Merge decrypted tags with original event tags (keep "d" tag from original)
        tags = [...event.tags, ...parsed];
      }
    } catch {
      // Decryption failed — event may belong to another user or use a viewKey.
      // Fall through to parse with whatever tags are available.
    }
  }

  const title =
    tags.find((t) => t[0] === "title")?.[1] ?? tags.find((t) => t[0] === "name")?.[1] ?? "Untitled";
  const description = tags.find((t) => t[0] === "description")?.[1] ?? "";
  const start = tags.find((t) => t[0] === "start")?.[1];
  const end = tags.find((t) => t[0] === "end")?.[1];
  const location = tags.filter((t) => t[0] === "location").map((t) => t[1]);
  const categories = tags.filter((t) => t[0] === "t").map((t) => t[1]);
  const participants = tags.filter((t) => t[0] === "p").map((t) => t[1]);
  const image = tags.find((t) => t[0] === "image")?.[1];
  const website = tags.find((t) => t[0] === "r")?.[1] ?? "";
  const rrule =
    tags.find((t) => t[0] === "l" && t[2] === "rrule")?.[1] ??
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
    repeat: { rrule },
    startTzid,
    endTzid,
    registrationFormRef,
    event,
  };
}
