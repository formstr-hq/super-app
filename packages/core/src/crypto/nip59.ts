import { generateSecretKey, finalizeEvent } from "nostr-tools";
import type { EventTemplate, Event, VerifiedEvent } from "nostr-tools";
import * as nip44 from "nostr-tools/nip44";

import type { NostrSigner } from "../signer/types";

type UnsignedEvent = Omit<Event, "sig">;

/**
 * NIP-59 Gift Wrap pipeline — extracted from Calendar's nip59.ts.
 * Used by Forms (access grants), Calendar (invitations, RSVP), Polls (DMs).
 *
 * Three-layer encryption:
 *   1. Rumor (unsigned event)
 *   2. Seal (NIP-44 encrypted for recipient, kind 13)
 *   3. Wrap (ephemeral key, kind 1059 or custom)
 *
 * Timestamps randomized ±2 days to prevent timing analysis.
 */

/** Step 1: Create unsigned rumor */
export function createRumor(event: Partial<EventTemplate> & { kind: number }): UnsignedEvent {
  const now = Math.floor(Date.now() / 1000);
  return {
    kind: event.kind,
    created_at: event.created_at ?? now,
    tags: event.tags ?? [],
    content: event.content ?? "",
    pubkey: "", // Will be set by caller
    id: "", // Unsigned — no ID
    sig: "",
  } as UnsignedEvent;
}

/** Step 2: Seal rumor with NIP-44 for recipient */
export async function createSeal(
  rumor: UnsignedEvent,
  signer: NostrSigner,
  recipientPubkey: string,
): Promise<VerifiedEvent> {
  if (!signer.nip44Encrypt) {
    throw new Error("Signer does not support NIP-44 for seal creation");
  }

  const encrypted = await signer.nip44Encrypt(recipientPubkey, JSON.stringify(rumor));
  const now = Math.floor(Date.now() / 1000);

  const sealEvent: EventTemplate = {
    kind: 13,
    created_at: randomizeTimestamp(now),
    tags: [],
    content: encrypted,
  };

  return signer.signEvent(sealEvent);
}

/**
 * Step 3: Wrap sealed event with ephemeral key.
 * Ephemeral random keys hide sender identity.
 */
export async function createWrap(
  seal: Event,
  recipientPubkey: string,
  wrapKind = 1059,
): Promise<VerifiedEvent> {
  const ephemeralKey = generateSecretKey();
  const now = Math.floor(Date.now() / 1000);

  const conversationKey = nip44.v2.utils.getConversationKey(ephemeralKey, recipientPubkey);
  const encrypted = nip44.v2.encrypt(JSON.stringify(seal), conversationKey);

  const wrapEvent: EventTemplate = {
    kind: wrapKind,
    created_at: randomizeTimestamp(now),
    tags: [["p", recipientPubkey]],
    content: encrypted,
  };

  return finalizeEvent(wrapEvent, ephemeralKey);
}

/** Full pipeline: rumor → seal → wrap */
export async function wrapEvent(
  event: Partial<EventTemplate> & { kind: number },
  signer: NostrSigner,
  recipientPubkey: string,
  wrapKind = 1059,
): Promise<VerifiedEvent> {
  const rumor = createRumor(event);
  rumor.pubkey = await signer.getPublicKey();
  const seal = await createSeal(rumor, signer, recipientPubkey);
  return createWrap(seal, recipientPubkey, wrapKind);
}

/** Batch wrap for multiple recipients — each gets their own seal */
export async function wrapManyEvents(
  event: Partial<EventTemplate> & { kind: number },
  signer: NostrSigner,
  recipientPubkeys: string[],
  wrapKind = 1059,
): Promise<VerifiedEvent[]> {
  const rumor = createRumor(event);
  rumor.pubkey = await signer.getPublicKey();

  const wraps: VerifiedEvent[] = [];
  for (const pubkey of recipientPubkeys) {
    const seal = await createSeal(rumor, signer, pubkey);
    const wrap = await createWrap(seal, pubkey, wrapKind);
    wraps.push(wrap);
  }
  return wraps;
}

/** Unwrap received gift wrap → decrypted rumor */
export async function unwrapEvent(
  wrappedEvent: Event,
  signer: NostrSigner,
): Promise<UnsignedEvent> {
  if (!signer.nip44Decrypt) {
    throw new Error("Signer does not support NIP-44 for unwrap");
  }

  // Unwrap outer layer (kind 1059 → seal)
  const sealJson = await signer.nip44Decrypt(wrappedEvent.pubkey, wrappedEvent.content);
  const seal = JSON.parse(sealJson) as Event;

  // Decrypt seal → rumor
  const rumorJson = await signer.nip44Decrypt(seal.pubkey, seal.content);
  return JSON.parse(rumorJson) as UnsignedEvent;
}

/** Randomize timestamp ±2 days to prevent timing analysis */
function randomizeTimestamp(timestamp: number): number {
  const twoDays = 2 * 24 * 60 * 60;
  const offset = Math.floor(Math.random() * twoDays * 2) - twoDays;
  return timestamp + offset;
}
