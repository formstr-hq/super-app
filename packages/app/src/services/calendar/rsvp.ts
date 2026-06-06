import { signerManager, nostrRuntime, relayManager, wrapEvent, unwrapEvent } from "@formstr/core";
import type { Event as NostrEvent, EventTemplate, Filter } from "nostr-tools";

import type { RSVPStatus } from "./types";
import { CALENDAR_KINDS, type RSVPResponse } from "./types";
import { encryptWithViewKey, decryptWithViewKey } from "./viewKey";

// ── Publish an RSVP ─────────────────────────────────────

/** Optional questionnaire extras: a "suggest a new time" proposal and/or a note. */
export interface RSVPExtra {
  suggestedStart?: number; // unix seconds
  suggestedEnd?: number; // unix seconds
  comment?: string;
}

/**
 * Publish an RSVP for a calendar event.
 *
 * - Public events → kind 31925 (NIP-52, unencrypted).
 * - Private events with `viewKey` → kind 32069 (NIP-44 payload encrypted with
 *   the event's viewKey), matching calendar.formstr.app exactly so the organiser
 *   can read it there.
 * - Private events without `viewKey` → NIP-59 gift-wrap fallback (old behaviour;
 *   used by callers that don't yet have the viewKey in scope, e.g. MCP).
 *
 * All paths use a deterministic d-tag = sha256("responder:author:eventDTag")[:30]
 * so re-RSVPing replaces the previous RSVP instead of accumulating new events.
 */
export async function rsvpToEvent(
  eventCoordinate: string,
  status: "accepted" | "declined" | "tentative",
  isPrivate = false,
  extra?: RSVPExtra,
  viewKey?: string,
): Promise<void> {
  const signer = await signerManager.getSigner();
  const [kindStr, authorPubkey, eventDTag] = eventCoordinate.split(":");
  if (!kindStr || !authorPubkey || !eventDTag) {
    throw new Error(`Invalid event coordinate: ${eventCoordinate}`);
  }

  // Deterministic d-tag matching the standalone: sha256("responder:author:eventDTag")[:30].
  // Ensures re-RSVPing replaces the previous RSVP (same NIP-33 key) rather than
  // accumulating additional events on relays. Random UUIDs caused unbounded growth.
  const responderPubkey = await signer.getPublicKey();
  const hashBuf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${responderPubkey}:${authorPubkey}:${eventDTag}`),
  );
  const rsvpId = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 30);

  const relays = relayManager.getRelaysForModule("calendar");

  if (isPrivate && viewKey) {
    // Standalone-compatible private RSVP: full payload NIP-44 encrypted with the
    // event viewKey; status and suggested times are inside the ciphertext, not tags.
    const payload: Record<string, unknown> = { status };
    if (extra?.suggestedStart !== undefined) payload.suggestedStart = extra.suggestedStart;
    if (extra?.suggestedEnd !== undefined) payload.suggestedEnd = extra.suggestedEnd;
    if (extra?.comment) payload.comment = extra.comment;
    const encryptedContent = await encryptWithViewKey(viewKey, JSON.stringify(payload));
    const signed = await signer.signEvent({
      kind: CALENDAR_KINDS.privateRsvp,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["a", eventCoordinate],
        ["d", rsvpId],
      ],
      content: encryptedContent,
    } satisfies EventTemplate);
    await nostrRuntime.publish(relays, signed);
    return;
  }

  // Public RSVP or private without viewKey (gift-wrap fallback).
  const content = extra?.comment ?? "";
  const tags: string[][] = [
    ["d", rsvpId],
    ["a", eventCoordinate],
    ["status", status],
  ];
  if (extra?.suggestedStart) tags.push(["start", String(extra.suggestedStart)]);
  if (extra?.suggestedEnd) tags.push(["end", String(extra.suggestedEnd)]);

  if (isPrivate) {
    const wrap = await wrapEvent(
      { kind: CALENDAR_KINDS.rsvpRumor, content, tags },
      signer,
      authorPubkey,
      CALENDAR_KINDS.rsvpGiftWrap,
    );
    await nostrRuntime.publish(relays, wrap);
  } else {
    const signed = await signer.signEvent({
      kind: CALENDAR_KINDS.publicRsvp,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content,
    } satisfies EventTemplate);
    await nostrRuntime.publish(relays, signed);
  }
}

// ── Fetch RSVPs for events ──────────────────────────────

/**
 * Fetch RSVPs for a calendar event, deduped newest-wins per pubkey.
 *
 * Pass `viewKey` to also include private RSVPs (kind 32069) that were
 * published by calendar.formstr.app users or by this app's private RSVP path.
 */
export async function fetchRsvpsForEvent(
  eventCoordinate: string,
  viewKey?: string,
): Promise<RSVPResponse[]> {
  const relays = relayManager.getRelaysForModule("calendar");
  const latestByPubkey = new Map<string, RSVPResponse>();

  // 1) Public RSVPs (kind 31925) — status/suggested-times in tags, comment in content.
  const publicEvents = await nostrRuntime.querySync(relays, {
    kinds: [CALENDAR_KINDS.publicRsvp],
    "#a": [eventCoordinate],
  } as Filter);
  for (const evt of publicEvents) {
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

  // 2) Private RSVPs (kind 32069) — full payload NIP-44 encrypted with the viewKey.
  if (viewKey) {
    const privateEvents = await nostrRuntime.querySync(relays, {
      kinds: [CALENDAR_KINDS.privateRsvp],
      "#a": [eventCoordinate],
    } as Filter);
    for (const evt of privateEvents) {
      try {
        const decrypted = await decryptWithViewKey(viewKey, evt.content);
        const payload = JSON.parse(decrypted) as {
          status?: RSVPStatus;
          suggestedStart?: number;
          suggestedEnd?: number;
          comment?: string;
        };
        if (!payload.status) continue;
        const existing = latestByPubkey.get(evt.pubkey);
        if (existing && existing.createdAt >= evt.created_at) continue;
        latestByPubkey.set(evt.pubkey, {
          pubkey: evt.pubkey,
          status: payload.status,
          eventCoordinate,
          createdAt: evt.created_at,
          suggestedStart: payload.suggestedStart,
          suggestedEnd: payload.suggestedEnd,
          comment: payload.comment || undefined,
        });
      } catch {
        // Decryption failed — RSVP encrypted with a different viewKey; skip.
      }
    }
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
