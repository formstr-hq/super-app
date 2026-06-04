import { signerManager, nostrRuntime, relayManager, wrapEvent, unwrapEvent } from "@formstr/core";
import type { Event as NostrEvent, EventTemplate, Filter } from "nostr-tools";

import type { RSVPStatus } from "./types";
import { CALENDAR_KINDS, type RSVPResponse } from "./types";

// ── Publish an RSVP ─────────────────────────────────────
/**
 * Publish an RSVP (NIP-52 kind 31925) for a calendar event. When `isPrivate`
 * is true the RSVP is wrapped per NIP-59 so the event author sees it but
 * relays only see a gift-wrap.
 *
 * We guard upstream PR-105's race: if the caller passes a coordinate that
 * points to a missing event we still publish an RSVP but also log — the
 * inbox's `onInvitation` resolver is expected to fetch and ingest the event
 * *before* letting the UI trigger an RSVP.
 */
/** Optional questionnaire extras: a "suggest a new time" proposal and/or a note. */
export interface RSVPExtra {
  suggestedStart?: number; // unix seconds
  suggestedEnd?: number; // unix seconds
  comment?: string;
}

export async function rsvpToEvent(
  eventCoordinate: string,
  status: "accepted" | "declined" | "tentative",
  isPrivate = false,
  extra?: RSVPExtra,
): Promise<void> {
  const signer = await signerManager.getSigner();
  const [kindStr, authorPubkey, d] = eventCoordinate.split(":");
  if (!kindStr || !authorPubkey || !d) {
    throw new Error(`Invalid event coordinate: ${eventCoordinate}`);
  }

  const rsvpId = crypto.randomUUID().slice(0, 8);
  const tags: string[][] = [
    ["d", rsvpId],
    ["a", eventCoordinate],
    ["status", status],
    ["p", authorPubkey],
  ];
  // Suggested-time proposal: standalone parity (start/end in unix seconds).
  if (extra?.suggestedStart) tags.push(["start", String(extra.suggestedStart)]);
  if (extra?.suggestedEnd) tags.push(["end", String(extra.suggestedEnd)]);
  // The free-text note rides in content, matching the standalone's RSVP reader.
  const content = extra?.comment ?? "";

  const kind = isPrivate ? CALENDAR_KINDS.privateRsvp : CALENDAR_KINDS.publicRsvp;
  const template: EventTemplate = {
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };

  const relays = relayManager.getRelaysForModule("calendar");

  if (isPrivate) {
    const wrap = await wrapEvent(
      {
        kind: CALENDAR_KINDS.rsvpRumor,
        content,
        tags,
      },
      signer,
      authorPubkey,
      CALENDAR_KINDS.rsvpGiftWrap,
    );
    await nostrRuntime.publish(relays, wrap);
  } else {
    const signed = await signer.signEvent(template);
    await nostrRuntime.publish(relays, signed);
  }
}

// ── Fetch RSVPs for events ──────────────────────────────

export async function fetchRsvpsForEvent(eventCoordinate: string): Promise<RSVPResponse[]> {
  const relays = relayManager.getRelaysForModule("calendar");
  const filter: Filter = {
    kinds: [CALENDAR_KINDS.publicRsvp],
    "#a": [eventCoordinate],
  };
  const events = await nostrRuntime.querySync(relays, filter);

  const latestByPubkey = new Map<string, RSVPResponse>();
  for (const evt of events) {
    const status = evt.tags.find((t: string[]) => t[0] === "status")?.[1] as RSVPStatus | undefined;
    if (!status) continue;
    const existing = latestByPubkey.get(evt.pubkey);
    if (existing && existing.createdAt >= evt.created_at) continue;
    const start = evt.tags.find((t: string[]) => t[0] === "start")?.[1];
    const end = evt.tags.find((t: string[]) => t[0] === "end")?.[1];
    latestByPubkey.set(evt.pubkey, {
      pubkey: evt.pubkey,
      status,
      eventCoordinate,
      createdAt: evt.created_at,
      suggestedStart: start ? Number(start) : undefined,
      suggestedEnd: end ? Number(end) : undefined,
      comment: evt.content || undefined,
    });
  }
  return Array.from(latestByPubkey.values());
}

// ── Invitation subscription ─────────────────────────────

export interface InvitationRumor {
  eventCoordinate: string;
  authorPubkey: string;
  kind: number;
  wrapId: string;
  receivedAt: number;
  /** nsec to decrypt the referenced private event (standalone-shaped invites). */
  viewKey?: string;
  /** Relay where the referenced event was published. */
  relayHint?: string;
}

/**
 * Decrypt a gift-wrap addressed to the current user and, when it contains
 * a calendar-rumor pointer, return the referenced addressable coordinate.
 */
export async function extractInvitationFromWrap(wrap: NostrEvent): Promise<InvitationRumor | null> {
  try {
    const signer = await signerManager.getSigner();
    const unwrapped = await unwrapEvent(wrap, signer);
    if (!unwrapped) return null;
    if (unwrapped.kind !== CALENDAR_KINDS.rumor && unwrapped.kind !== CALENDAR_KINDS.rsvpRumor) {
      return null;
    }

    // Preferred (standalone-compatible) shape: an `a` coordinate tag plus an
    // optional `viewKey` tag. This is what calendar.formstr.app emits and
    // reads (see upstream getDetailsFromGiftWrap).
    const tags: string[][] = Array.isArray(unwrapped.tags) ? unwrapped.tags : [];
    const aTag = tags.find((t) => t[0] === "a");
    if (aTag?.[1]) {
      const coordinate = aTag[1];
      const [kindStr, authorPubkey] = coordinate.split(":");
      const kind = Number(kindStr);
      if (!kind || !authorPubkey) return null;
      return {
        eventCoordinate: coordinate,
        authorPubkey,
        kind,
        wrapId: wrap.id,
        receivedAt: wrap.created_at,
        viewKey: tags.find((t) => t[0] === "viewKey")?.[1],
        relayHint: aTag[2],
      };
    }

    // Legacy super-app shape: { eventId, authorPubkey?, kind? } in content.
    const payload = JSON.parse(unwrapped.content || "{}");
    const eventId: string | undefined = payload.eventId;
    const authorPubkey: string | undefined = payload.authorPubkey ?? unwrapped.pubkey;
    const kind: number = payload.kind ?? CALENDAR_KINDS.privateEvent;
    if (!eventId || !authorPubkey) return null;
    return {
      eventCoordinate: `${kind}:${authorPubkey}:${eventId}`,
      authorPubkey,
      kind,
      wrapId: wrap.id,
      receivedAt: wrap.created_at,
    };
  } catch {
    return null;
  }
}
