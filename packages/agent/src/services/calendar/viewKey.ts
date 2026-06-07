import { LocalSigner, nip44SelfEncrypt, nip44SelfDecrypt } from "@formstr/core";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";

/**
 * Per-event "view key" model for private calendar events, matching the
 * standalone `nostr-calendar`. A private event's content is encrypted with a
 * freshly generated secret key (the viewKey). The viewKey (as an `nsec`) is
 * then shared with invitees via the calendar-list `a`-ref and the NIP-59
 * invitation gift-wrap, so anyone holding it can decrypt the event — unlike
 * self-encryption, which only the author could read.
 */

export interface ViewKey {
  /** Bech32 `nsec…` — the shareable form stored in refs/invites. */
  nsec: string;
  /** Hex public key derived from the viewKey secret. */
  pubkey: string;
  /** Raw secret bytes. */
  secret: Uint8Array;
}

export function generateViewKey(): ViewKey {
  const secret = generateSecretKey();
  return { secret, nsec: nip19.nsecEncode(secret), pubkey: getPublicKey(secret) };
}

function signerFromNsec(nsec: string): LocalSigner {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec") {
    throw new Error(`Expected an nsec view key, got ${decoded.type}`);
  }
  return new LocalSigner(decoded.data);
}

/**
 * Encrypt to the viewKey's OWN pubkey (self-encryption under the viewKey).
 * Anyone who holds the nsec can reconstruct the same conversation key and
 * decrypt — that is what makes the event shareable with invitees.
 */
export async function encryptWithViewKey(nsec: string, plaintext: string): Promise<string> {
  return nip44SelfEncrypt(signerFromNsec(nsec), plaintext);
}

export async function decryptWithViewKey(nsec: string, ciphertext: string): Promise<string> {
  return nip44SelfDecrypt(signerFromNsec(nsec), ciphertext);
}

/** Calendar-list / invitation event reference: ["{coordinate}", relayHint, viewKey]. */
export function buildEventRef(coordinate: string, relayHint: string, viewKey: string): string[] {
  return [coordinate, relayHint, viewKey];
}

export function parseEventRef(ref: string[]): {
  coordinate: string;
  relayHint: string;
  viewKey: string;
} {
  return { coordinate: ref[0], relayHint: ref[1] ?? "", viewKey: ref[2] ?? "" };
}
