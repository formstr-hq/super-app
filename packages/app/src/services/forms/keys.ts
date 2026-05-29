import { LocalSigner } from "@formstr/core";
import { generateSecretKey, getPublicKey } from "nostr-tools";

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
 * Build a signer backed by the view key — used to decrypt form content.
 * Decrypt with: nip44Decrypt(makeViewKeySigner(viewKeyHex), formPubkey, content)
 */
export function makeViewKeySigner(viewKeyHex: string): LocalSigner {
  return new LocalSigner(hexToBytes(viewKeyHex));
}

/**
 * Build a signer backed by the signing key — used to decrypt encrypted responses.
 * Decrypt with: nip44Decrypt(makeSigningKeySigner(signingKeyHex), respondentPubkey, content)
 */
export function makeSigningKeySigner(signingKeyHex: string): LocalSigner {
  return new LocalSigner(hexToBytes(signingKeyHex));
}

/**
 * Encode signing key (and optional view key) into the kind-14083 tag segment:
 *   "signingKeyHex:viewKeyHex"  (encrypted form)
 *   "signingKeyHex"             (public form)
 *
 * Compatible with the @formstr/sdk and formstr.app wire format.
 */
export function encodeFormKeys(signingKeyHex: string, viewKeyHex?: string): string {
  return viewKeyHex ? `${signingKeyHex}:${viewKeyHex}` : signingKeyHex;
}

/**
 * Decode a kind-14083 tag key segment back into individual keys.
 */
export function decodeFormKeys(segment: string): { signingKey: string; viewKey?: string } {
  const idx = segment.indexOf(":");
  if (idx < 0) return { signingKey: segment };
  return { signingKey: segment.slice(0, idx), viewKey: segment.slice(idx + 1) };
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
