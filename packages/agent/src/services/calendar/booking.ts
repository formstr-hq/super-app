import {
  signerManager,
  nostrRuntime,
  relayManager,
  nip44SelfDecrypt,
  wrapEvent,
  unwrapEvent,
} from "@formstr/core";
import type { Event as NostrEvent, Filter } from "nostr-tools";
import { nip19 } from "nostr-tools";

import { addEventToCalendarList, publishPrivateCalendarEvent } from "./service";
import { CALENDAR_KINDS, type CalendarEvent, type CalendarList } from "./types";
import { decryptWithViewKey } from "./viewKey";

/**
 * Appointment-scheduling ("booking links") read + approve service, interoperable
 * with calendar.formstr.app.
 *
 * Scope is **display + approve**: the super-app lists the booking links
 * (scheduling pages, kind 31927) the user authored, lists incoming booking
 * requests (NIP-59 gift wraps, kind 1057), and lets the host approve (→ creates
 * the appointment event + notifies the booker) or decline. Creating/editing
 * scheduling pages and the public booking page itself stay in the standalone;
 * shareable links therefore point at `BOOKING_HOST`.
 */

/** Where the public booking page is hosted (the super-app doesn't render it). */
const BOOKING_HOST = "https://calendar.formstr.app";

export interface SchedulingPage {
  /** d-tag identifier. */
  id: string;
  eventId: string;
  /** Author (host) pubkey. */
  user: string;
  title: string;
  description: string;
  /** nsec viewKey that decrypts the (always-encrypted) page; from the 32680 index. */
  viewKey?: string;
  createdAt: number;
}

export interface BookingRequest {
  /** Stable id (the delivering gift wrap's id). */
  id: string;
  giftWrapId: string;
  /** Scheduling page coordinate `31927:pubkey:dTag`. */
  schedulingPageRef: string;
  bookerPubkey: string;
  /** ms timestamps. */
  start: number;
  end: number;
  title: string;
  note: string;
  /** Pre-generated d-tag the host must reuse when publishing the appointment. */
  dTag: string;
  /** Pre-generated viewKey nsec for the appointment event. */
  viewKey?: string;
  receivedAt: number;
  status: "pending" | "approved" | "declined";
  respondedAt?: number;
  declineReason?: string;
}

// ── Scheduling pages (booking links) ────────────────────

/**
 * Fetch the booking links (scheduling pages) the current user authored. Every
 * scheduling page is NIP-44 encrypted; the per-page viewKey lives in the
 * self-encrypted kind-32680 index, so we load that first and decrypt each page.
 */
export async function fetchSchedulingPages(): Promise<SchedulingPage[]> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const relays = relayManager.getRelaysForModule("calendar");

  // 1) Page-key index (kind 32680, self-encrypted): dTag → viewKey nsec.
  const viewKeyByDTag = new Map<string, string>();
  const keyEvents = await nostrRuntime.querySync(relays, {
    kinds: [CALENDAR_KINDS.schedulingPagesList],
    authors: [pubkey],
  } as Filter);
  for (const event of keyEvents) {
    const dTag = event.tags.find((t) => t[0] === "d")?.[1];
    if (!dTag || !event.content) continue; // empty content = tombstone
    try {
      const payload = JSON.parse(await nip44SelfDecrypt(signer, event.content)) as {
        viewKey?: string;
        dTag?: string;
      };
      if (payload?.viewKey && payload.dTag === dTag) viewKeyByDTag.set(dTag, payload.viewKey);
    } catch {
      // Not ours to decrypt / malformed — skip.
    }
  }

  // 2) Pages themselves (kind 31927), newest-wins per d-tag.
  const pageEvents = await nostrRuntime.querySync(relays, {
    kinds: [CALENDAR_KINDS.schedulingPage],
    authors: [pubkey],
  } as Filter);
  const newest = new Map<string, NostrEvent>();
  for (const event of pageEvents) {
    const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
    const prev = newest.get(dTag);
    if (!prev || event.created_at > prev.created_at) newest.set(dTag, event);
  }

  const pages: SchedulingPage[] = [];
  for (const [dTag, event] of newest) {
    const viewKey = viewKeyByDTag.get(dTag);
    if (!viewKey || !event.content) continue; // can't decrypt / tombstone
    try {
      const tags = JSON.parse(await decryptWithViewKey(viewKey, event.content)) as string[][];
      if (!Array.isArray(tags)) continue;
      pages.push({
        id: dTag,
        eventId: event.id,
        user: event.pubkey,
        title: tags.find((t) => t[0] === "title")?.[1] || "Untitled",
        description: tags.find((t) => t[0] === "description")?.[1] || "",
        viewKey,
        createdAt: event.created_at,
      });
    } catch {
      // Undecryptable — skip.
    }
  }
  return pages.sort((a, b) => b.createdAt - a.createdAt);
}

/** nsec → 32-byte hex (the form the booking page's `?viewKey=` expects). */
function nsecToHex(nsec: string): string | null {
  try {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== "nsec") return null;
    return Array.from(decoded.data as Uint8Array, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/**
 * Shareable public booking URL for a scheduling page (the page itself is hosted
 * by calendar.formstr.app). Scheduling pages are always NIP-44 encrypted, so the
 * link MUST carry the access key — the booking page reads `?viewKey=<hex>` and
 * does `hexToBytes` on it; without it the page shows "missing its access key".
 * Relays are embedded in the naddr so the booker's client can locate the page.
 */
export function bookingLinkUrl(page: SchedulingPage): string {
  const naddr = nip19.naddrEncode({
    identifier: page.id,
    pubkey: page.user,
    kind: CALENDAR_KINDS.schedulingPage,
    relays: relayManager.getRelaysForModule("calendar"),
  });
  let url = `${BOOKING_HOST}/schedule/${naddr}`;
  const hex = page.viewKey ? nsecToHex(page.viewKey) : null;
  if (hex) url += `?viewKey=${hex}`;
  return url;
}

// ── Incoming booking requests ───────────────────────────

async function unwrapBookingRequest(wrap: NostrEvent): Promise<BookingRequest | null> {
  try {
    const signer = await signerManager.getSigner();
    const rumor = await unwrapEvent(wrap, signer);
    if (!rumor || rumor.kind !== CALENDAR_KINDS.bookingRequestRumor) return null;
    const tags: string[][] = Array.isArray(rumor.tags) ? rumor.tags : [];
    const get = (name: string) => tags.find((t) => t[0] === name)?.[1] ?? "";
    const schedulingPageRef = get("a");
    if (!schedulingPageRef) return null;
    return {
      id: wrap.id,
      giftWrapId: wrap.id,
      schedulingPageRef,
      bookerPubkey: rumor.pubkey,
      start: Number(get("start")) * 1000,
      end: Number(get("end")) * 1000,
      title: get("title"),
      note: get("note") || rumor.content || "",
      dTag: get("d"),
      viewKey: get("viewKey") || undefined,
      receivedAt: wrap.created_at,
      status: "pending",
    };
  } catch {
    return null;
  }
}

/** Fetch incoming booking requests (gift wraps addressed to the current user). */
export async function fetchBookingRequests(): Promise<BookingRequest[]> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const relays = relayManager.getRelaysForModule("calendar");

  const wraps = await nostrRuntime.querySync(relays, {
    kinds: [CALENDAR_KINDS.bookingRequestGiftWrap],
    "#p": [pubkey],
  } as Filter);

  const seen = new Set<string>();
  const requests: BookingRequest[] = [];
  for (const wrap of wraps) {
    if (seen.has(wrap.id)) continue;
    seen.add(wrap.id);
    const parsed = await unwrapBookingRequest(wrap);
    if (parsed) requests.push(parsed);
  }
  return requests.sort((a, b) => a.start - b.start);
}

// ── Approve / decline ───────────────────────────────────

async function sendBookingResponse(params: {
  schedulingPageRef: string;
  bookerPubkey: string;
  start: number; // ms
  end: number; // ms
  status: "approved" | "declined";
  eventRef?: string[];
  viewKey?: string;
  reason?: string;
}): Promise<void> {
  const signer = await signerManager.getSigner();
  const relays = relayManager.getRelaysForModule("calendar");
  const tags: string[][] = [
    ["a", params.schedulingPageRef],
    ["start", String(Math.floor(params.start / 1000))],
    ["end", String(Math.floor(params.end / 1000))],
    ["status", params.status],
  ];
  if (params.status === "approved" && params.eventRef) tags.push(["event_ref", ...params.eventRef]);
  if (params.status === "approved" && params.viewKey) tags.push(["viewKey", params.viewKey]);
  if (params.status === "declined" && params.reason) tags.push(["reason", params.reason]);

  const wrap = await wrapEvent(
    { kind: CALENDAR_KINDS.bookingResponseRumor, content: "", tags },
    signer,
    params.bookerPubkey,
    CALENDAR_KINDS.bookingResponseGiftWrap,
  );
  await nostrRuntime.publish(relays, wrap);
}

/**
 * Approve a booking request: publish the appointment as a private calendar event
 * reusing the booker's pre-generated d-tag + viewKey (so it lands in the
 * booker's calendar unchanged), link it to `calendar`, and notify the booker.
 * Returns the created event and the updated calendar list for store ingestion.
 */
export async function approveBookingRequest(
  request: BookingRequest,
  calendar: CalendarList,
): Promise<{ event: CalendarEvent; calendar: CalendarList }> {
  const event = await publishPrivateCalendarEvent(
    {
      title: request.title || "Appointment",
      description: request.note || "",
      begin: new Date(request.start),
      end: new Date(request.end),
      isPrivate: true,
      participants: [request.bookerPubkey],
      existingId: request.dTag || undefined,
      viewKey: request.viewKey,
      calendarId: calendar.id,
    },
    calendar.id,
  );

  const relayHint = relayManager.getRelaysForModule("calendar")[0] ?? "";
  const eventRef = [
    `${event.kind}:${event.user}:${event.id}`,
    relayHint,
    event.viewKey ?? request.viewKey ?? "",
  ];
  const updatedCalendar = await addEventToCalendarList(calendar, eventRef);

  await sendBookingResponse({
    schedulingPageRef: request.schedulingPageRef,
    bookerPubkey: request.bookerPubkey,
    start: request.start,
    end: request.end,
    status: "approved",
    eventRef,
    viewKey: event.viewKey ?? request.viewKey,
  });

  return { event, calendar: updatedCalendar };
}

/** Decline a booking request: notify the booker (optionally with a reason). */
export async function declineBookingRequest(
  request: BookingRequest,
  reason?: string,
): Promise<void> {
  await sendBookingResponse({
    schedulingPageRef: request.schedulingPageRef,
    bookerPubkey: request.bookerPubkey,
    start: request.start,
    end: request.end,
    status: "declined",
    reason,
  });
}
