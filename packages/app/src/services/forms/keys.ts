import { LocalSigner, wrapEvent, type NostrSigner } from "@formstr/core";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import type { VerifiedEvent } from "nostr-tools";

import { FORM_KINDS } from "./types";

/**
 * Form view-key helpers.
 *
 * Upstream `nostr-forms` puts the view secret in the URL hash (`#view-key=...`).
 * The super-app prefers NIP-59 gift-wrap distribution so the secret never
 * leaves encrypted storage:
 *
 *   1. createForm() generates an ephemeral viewKey (secret + pubkey).
 *   2. The template's content is NIP-44 encrypted to the viewKey.pubkey by
 *      the author's signer, so any holder of the view secret can decrypt it.
 *   3. For every collaborator/responder, the author publishes a kind-1059
 *      gift-wrap containing a rumor with the view secret + the form's
 *      `["a", "30168:<author>:<d>"]` coordinate.
 *   4. `formsKeyStore` subscribes to kind-1059 `#p = self`, unwraps them,
 *      and caches `{coord → viewSecret}`.
 */

export interface FormViewKey {
  secretKey: Uint8Array;
  pubkey: string;
}

/** Generate an ephemeral view key used to encrypt form fields. */
export function generateViewKey(): FormViewKey {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  return { secretKey, pubkey };
}

/**
 * Build a signer that impersonates the view key — used by non-authors to
 * decrypt the form content with `nip44Decrypt(signer, authorPubkey, content)`.
 */
export function makeEphemeralSigner(secret: Uint8Array): NostrSigner {
  return new LocalSigner(secret);
}

/** Inner rumor kind for the forms view-key gift-wrap. */
export const FORM_VIEW_KEY_RUMOR_KIND = 1068; // arbitrary; the wrap kind 1059 is what clients filter on

/** Inner tag used to mark a rumor as carrying a Formstr view key. */
export const FORM_VIEW_KEY_TAG = "view_key";

/**
 * Wrap a view secret so that only `recipientPubkey` can unseal it.
 * The rumor is a kind-1068 "text" event (to keep compat if old clients peek)
 * with two tags:
 *
 *   ["a", "30168:<author>:<d>"]
 *   ["view_key", "<hex-secret>"]
 *
 * The wrap itself is kind 1059.
 */
export async function wrapFormKeyForRecipient(
  secret: Uint8Array,
  formCoord: string,
  recipientPubkey: string,
  signer: NostrSigner,
): Promise<VerifiedEvent> {
  const hex = bytesToHex(secret);
  return wrapEvent(
    {
      kind: FORM_VIEW_KEY_RUMOR_KIND,
      content: JSON.stringify({ formCoord }),
      tags: [
        ["a", formCoord],
        [FORM_VIEW_KEY_TAG, hex],
      ],
    },
    signer,
    recipientPubkey,
    FORM_KINDS.giftWrap,
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
