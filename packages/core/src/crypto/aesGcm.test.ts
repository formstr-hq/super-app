import { describe, expect, it } from "vitest";

import { aesGcmDecrypt, aesGcmEncrypt, generateFileKey } from "./aesGcm";

describe("aesGcm", () => {
  it("round-trips a payload", async () => {
    const key = await generateFileKey();
    const plain = new TextEncoder().encode("file contents here");
    const enc = await aesGcmEncrypt(plain, key);
    const dec = await aesGcmDecrypt(enc, key);
    expect(new TextDecoder().decode(dec)).toBe("file contents here");
  });

  it("decryption with wrong key throws", async () => {
    const k1 = await generateFileKey();
    const k2 = await generateFileKey();
    const enc = await aesGcmEncrypt(new TextEncoder().encode("x"), k1);
    await expect(aesGcmDecrypt(enc, k2)).rejects.toThrow();
  });

  it("IV is unique across calls", async () => {
    const key = await generateFileKey();
    const a = await aesGcmEncrypt(new TextEncoder().encode("a"), key);
    const b = await aesGcmEncrypt(new TextEncoder().encode("a"), key);
    expect(a.iv).not.toBe(b.iv);
  });
});
