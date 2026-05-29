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
  const eventId = crypto.randomUUID().slice(0, 8);

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
    repeat: { rrule: null },
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
  const eventId = crypto.randomUUID().slice(0, 8);

  const eventData: string[][] = [
    ["title", draft.title],
    ["description", draft.description],
    ["start", String(Math.floor(draft.begin.getTime() / 1000))],
    ["end", String(Math.floor(draft.end.getTime() / 1000))],
  ];

  if (draft.location) eventData.push(["location", draft.location]);
  for (const cat of draft.categories ?? []) eventData.push(["t", cat]);
  for (const p of draft.participants ?? []) eventData.push(["p", p]);

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
    repeat: { rrule: null },
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
    onEvent: async (event) => {
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
  return parsed.filter((e): e is CalendarEvent => e !== null);
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

  const tags: string[][] = [["k", String(CALENDAR_KINDS.publicEvent)]];
  if (eventId) tags.push(["e", eventId]);
  if (coordinate) tags.push(["a", coordinate]);

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

async function parseCalendarEvent(event: Event): Promise<CalendarEvent | null> {
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
    repeat: { rrule: null },
    event,
  };
}
