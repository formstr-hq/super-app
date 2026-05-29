import { generateSecretKey } from "nostr-tools";
import { describe, expect, it } from "vitest";

import { LocalSigner } from "../signer/LocalSigner";

import { nip44Decrypt, nip44Encrypt, nip44SelfDecrypt, nip44SelfEncrypt } from "./nip44";

describe("nip44", () => {
  it("self-encrypts and decrypts a string", async () => {
    const signer = new LocalSigner(generateSecretKey());
    const cipher = await nip44SelfEncrypt(signer, "secret note");
    const plain = await nip44SelfDecrypt(signer, cipher);
    expect(plain).toBe("secret note");
  });

  it("encrypts from A → B and B decrypts", async () => {
    const a = new LocalSigner(generateSecretKey());
    const b = new LocalSigner(generateSecretKey());
    const aPub = await a.getPublicKey();
    const bPub = await b.getPublicKey();

    const cipher = await nip44Encrypt(a, bPub, "hi B");
    const plain = await nip44Decrypt(b, aPub, cipher);
    expect(plain).toBe("hi B");
  });

  it("throws if signer lacks nip44Encrypt capability", async () => {
    const stub = {
      getPublicKey: async () => "00".repeat(32),
      signEvent: async () => {
        throw new Error("not used");
      },
    } as unknown as Parameters<typeof nip44Encrypt>[0];

    await expect(nip44Encrypt(stub, "00".repeat(32), "x")).rejects.toThrow(/NIP-44/);
  });
});
