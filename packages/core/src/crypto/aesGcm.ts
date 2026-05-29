/**
 * AES-256-GCM file encryption — Drive's per-file keypair model.
 * Uses Web Crypto API for browser-native performance.
 *
 * Each file encrypted with unique random key →
 * file key encrypted via NIP-44 to owner + shared users.
 */

export interface EncryptedPayload {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded 12-byte IV */
  iv: string;
}

/** Generate a random 256-bit AES key (returns hex string) */
export async function generateFileKey(): Promise<string> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return bytesToHex(key);
}

/** Encrypt data with AES-256-GCM */
export async function aesGcmEncrypt(data: Uint8Array, keyHex: string): Promise<EncryptedPayload> {
  const keyBytes = hexToBytes(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    data.buffer as ArrayBuffer,
  );

  return {
    ciphertext: uint8ToBase64(new Uint8Array(ciphertext)),
    iv: uint8ToBase64(iv),
  };
}

/** Decrypt data with AES-256-GCM */
export async function aesGcmDecrypt(
  payload: EncryptedPayload,
  keyHex: string,
): Promise<Uint8Array> {
  const keyBytes = hexToBytes(keyHex);
  const iv = base64ToUint8(payload.iv);
  const ciphertext = base64ToUint8(payload.ciphertext);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    ciphertext.buffer as ArrayBuffer,
  );

  return new Uint8Array(plaintext);
}

// ── Helpers ──────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
