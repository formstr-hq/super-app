import { LocalSigner, nip44SelfEncrypt, nip44SelfDecrypt } from "@formstr/core";
import { generateSecretKey, getPublicKey } from "nostr-tools";

/**
 * Per-document "view key" model for shared Pages, matching the standalone
 * `nostr-docs` (`src/utils/encryption.ts`). A shared document's Markdown is
 * NIP-44 encrypted under a random 32-byte key (the viewKey): the conversation
 * key is derived from `(viewKey, pubkey(viewKey))`, so anyone holding the
 * viewKey **hex** can decrypt. The viewKey travels only in a URL `#nkeys…`
 * fragment — never on relays.
 *
 * Personal (un-shared) documents instead use **owner** self-encryption
 * (`nip44SelfEncrypt(ownerSigner, …)`), exactly like the standalone.
 */

export interface PageViewKey {
  secretKey: Uint8Array;
  hex: string;
  pubkey: string;
}

export function generateViewKey(): PageViewKey {
  const secretKey = generateSecretKey();
  return { secretKey, hex: bytesToHex(secretKey), pubkey: getPublicKey(secretKey) };
}

/** A `LocalSigner` backed by a hex view/edit key — used to encrypt/sign as that key. */
export function signerFromHex(hex: string): LocalSigner {
  return new LocalSigner(hexToBytes(hex));
}

/** The Nostr public key (hex) for a hex secret key — e.g. an editKey's pubkey. */
export function pubkeyFromHex(hex: string): string {
  return getPublicKey(hexToBytes(hex));
}

/**
 * Encrypt to the viewKey's OWN pubkey (self-conversation under the viewKey),
 * identical to the standalone's `encryptContent(content, viewKey)`. Anyone with
 * the hex reconstructs the same conversation key and decrypts.
 */
export async function encryptWithViewKey(viewKeyHex: string, plaintext: string): Promise<string> {
  return nip44SelfEncrypt(signerFromHex(viewKeyHex), plaintext);
}

export async function decryptWithViewKey(viewKeyHex: string, ciphertext: string): Promise<string> {
  return nip44SelfDecrypt(signerFromHex(viewKeyHex), ciphertext);
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex length");
  if (hex.length > 0 && !/^[0-9a-fA-F]+$/.test(hex)) throw new Error("invalid hex characters");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
