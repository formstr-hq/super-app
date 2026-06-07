import { generateSecretKey, getPublicKey, nip44 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import { aesGcmDecrypt, aesGcmEncrypt, decryptFileWithKey, encryptFileWithKey } from "./aesGcm";
import { hexToBytes } from "./hex";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

describe("file crypto (standalone formstr-drive parity)", () => {
  it("encryptFileWithKey → decryptFileWithKey round-trips arbitrary binary bytes", async () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 128, 10, 13, 0, 42]);
    const { ciphertext, privateKeyHex } = await encryptFileWithKey(bytes);
    const out = await decryptFileWithKey(ciphertext, privateKeyHex);
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });

  it("stores a 32-byte nostr secret key (hex) as the file key", async () => {
    const { privateKeyHex } = await encryptFileWithKey(new Uint8Array([1]));
    expect(privateKeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the standalone payload format: base64 of [version=2 | nonce(32) | ct]", async () => {
    const { ciphertext } = await encryptFileWithKey(new Uint8Array([1, 2, 3]));
    const payload = base64ToBytes(ciphertext);
    expect(payload[0]).toBe(2); // version byte
    expect(payload.length).toBeGreaterThan(1 + 32); // version + nonce + ct
  });

  it("is wire-compatible with the standalone decrypt path (self-conversation key)", async () => {
    // Reconstruct exactly what the standalone does on download.
    const bytes = new TextEncoder().encode("hello drive interop");
    const { ciphertext, privateKeyHex } = await encryptFileWithKey(bytes);

    const sk = hexToBytes(privateKeyHex);
    const pk = getPublicKey(sk);
    const conversationKey = nip44.v2.utils.getConversationKey(sk, pk);
    const plaintextBase64 = await aesGcmDecrypt(ciphertext, conversationKey);
    const recovered = base64ToBytes(plaintextBase64);

    expect(new TextDecoder().decode(recovered)).toBe("hello drive interop");
  });

  it("decryptFileWithKey with the wrong key throws", async () => {
    const { ciphertext } = await encryptFileWithKey(new Uint8Array([9, 9, 9]));
    const otherKey = Array.from(generateSecretKey())
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    await expect(decryptFileWithKey(ciphertext, otherKey)).rejects.toThrow();
  });

  it("aesGcmEncrypt/aesGcmDecrypt string round-trip with a conversation key", async () => {
    const sk = generateSecretKey();
    const conversationKey = nip44.v2.utils.getConversationKey(sk, getPublicKey(sk));
    const enc = await aesGcmEncrypt("payload text", conversationKey);
    const dec = await aesGcmDecrypt(enc, conversationKey);
    expect(dec).toBe("payload text");
  });

  it("aesGcmDecrypt rejects an unsupported version byte", async () => {
    const sk = generateSecretKey();
    const conversationKey = nip44.v2.utils.getConversationKey(sk, getPublicKey(sk));
    const enc = await aesGcmEncrypt("x", conversationKey);
    const payload = base64ToBytes(enc);
    payload[0] = 9; // corrupt version
    let bin = "";
    for (const b of payload) bin += String.fromCharCode(b);
    await expect(aesGcmDecrypt(btoa(bin), conversationKey)).rejects.toThrow();
  });
});
