import { describe, it, expect, vi } from "vitest";

import { NIP46Signer, type BunkerLike } from "./NIP46Signer";

function makeBunker(): BunkerLike {
  return {
    getPublicKey: vi.fn().mockResolvedValue("pk_hex"),
    signEvent: vi.fn().mockResolvedValue({ id: "e1", sig: "s1", kind: 1 }),
    nip44Encrypt: vi.fn().mockResolvedValue("ct"),
    nip44Decrypt: vi.fn().mockResolvedValue("pt"),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("NIP46Signer", () => {
  it("proxies getPublicKey/signEvent/nip44 to the bunker", async () => {
    const bunker = makeBunker();
    const signer = new NIP46Signer(bunker);

    expect(await signer.getPublicKey()).toBe("pk_hex");
    const ev = await signer.signEvent({ kind: 1, created_at: 0, tags: [], content: "hi" });
    expect(ev.sig).toBe("s1");
    expect(await signer.nip44Encrypt("peer", "pt")).toBe("ct");
    expect(await signer.nip44Decrypt("peer", "ct")).toBe("pt");
    expect(bunker.signEvent).toHaveBeenCalledOnce();
  });

  it("throws a clear error when the remote signer lacks a capability", () => {
    const bunker = makeBunker();
    delete bunker.nip04Encrypt;
    const signer = new NIP46Signer(bunker);
    expect(() => signer.encrypt("peer", "x")).toThrow("nip04 encrypt");
  });

  it("delegates close()", async () => {
    const bunker = makeBunker();
    const signer = new NIP46Signer(bunker);
    await signer.close();
    expect(bunker.close).toHaveBeenCalledOnce();
  });
});
