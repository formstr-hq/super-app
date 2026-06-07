/**
 * Per-file encryption for Drive — byte-for-byte parity with the standalone
 * formstr-drive (`src/crypto.ts`), so blobs uploaded by either app are
 * mutually decryptable.
 *
 * Model: each file gets its own random **nostr keypair**. The file is
 * encrypted to itself via a NIP-44-v2-style transform (HKDF-SHA256 → AES-GCM,
 * AES-GCM substituting for ChaCha20 since WebCrypto lacks it). The per-file
 * secret key (hex) is stored in the file's encrypted Nostr metadata.
 */

import { generateSecretKey, getPublicKey, nip44 } from "nostr-tools";

import { bytesToHex, hexToBytes } from "./hex";

// ── base64 helpers (chunked, large-payload safe) ───────────

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000; // 32KB chunks
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── NIP-44 v2 large-payload transform ──────────────────────

/**
 * Encrypt text under a NIP-44 conversation key.
 * Output: base64 of `[version=2 (1B) | nonce (32B) | AES-GCM ciphertext]`.
 */
export async function aesGcmEncrypt(
  plaintext: string,
  conversationKey: Uint8Array,
): Promise<string> {
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);

  const nonce = crypto.getRandomValues(new Uint8Array(32));

  const baseKey = await crypto.subtle.importKey(
    "raw",
    conversationKey as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: nonce, info: encoder.encode("nip44-v2") },
    baseKey,
    44 * 8,
  );
  const derived = new Uint8Array(derivedBits);
  const aesKeyBytes = derived.slice(0, 32);
  const aesIv = derived.slice(32, 44);

  const aesKey = await crypto.subtle.importKey(
    "raw",
    aesKeyBytes as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: aesIv as BufferSource },
    aesKey,
    plaintextBytes,
  );
  const ciphertextBytes = new Uint8Array(ciphertext);

  const payload = new Uint8Array(1 + 32 + ciphertextBytes.length);
  payload.set([2], 0); // version v2
  payload.set(nonce, 1);
  payload.set(ciphertextBytes, 33);
  return uint8ArrayToBase64(payload);
}

/** Decrypt the output of {@link aesGcmEncrypt}. */
export async function aesGcmDecrypt(
  ciphertext: string,
  conversationKey: Uint8Array,
): Promise<string> {
  const encoder = new TextEncoder();
  const payload = base64ToUint8Array(ciphertext);

  const version = payload[0];
  if (version !== 2) {
    throw new Error(`Unsupported NIP-44 version: ${version}`);
  }
  const nonce = payload.slice(1, 33);
  const ciphertextBytes = payload.slice(33);

  const baseKey = await crypto.subtle.importKey(
    "raw",
    conversationKey as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: nonce, info: encoder.encode("nip44-v2") },
    baseKey,
    44 * 8,
  );
  const derived = new Uint8Array(derivedBits);
  const aesKeyBytes = derived.slice(0, 32);
  const aesIv = derived.slice(32, 44);

  const aesKey = await crypto.subtle.importKey(
    "raw",
    aesKeyBytes as BufferSource,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: aesIv as BufferSource },
    aesKey,
    ciphertextBytes as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}

// ── Per-file encryption ────────────────────────────────────

/**
 * Encrypt file bytes with a freshly generated per-file nostr keypair
 * (self-conversation). Returns the ciphertext (base64 payload) and the
 * per-file secret key (hex) to store in the file's metadata.
 */
export async function encryptFileWithKey(
  fileBytes: Uint8Array,
): Promise<{ ciphertext: string; privateKeyHex: string }> {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const conversationKey = nip44.v2.utils.getConversationKey(secretKey, pubkey);

  const plaintextBase64 = uint8ArrayToBase64(fileBytes);
  const ciphertext = await aesGcmEncrypt(plaintextBase64, conversationKey);

  return { ciphertext, privateKeyHex: bytesToHex(secretKey) };
}

/** Decrypt a file blob using the stored per-file secret key (hex). */
export async function decryptFileWithKey(
  ciphertext: string,
  privateKeyHex: string,
): Promise<Uint8Array> {
  const secretKey = hexToBytes(privateKeyHex);
  const pubkey = getPublicKey(secretKey);
  const conversationKey = nip44.v2.utils.getConversationKey(secretKey, pubkey);

  const plaintextBase64 = await aesGcmDecrypt(ciphertext, conversationKey);
  if (!plaintextBase64) {
    throw new Error("Decryption failed");
  }
  return base64ToUint8Array(plaintextBase64);
}
