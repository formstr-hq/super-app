import { describe, it, expect } from "vitest";

import { toNostrSigner } from "./toNostrSigner";

function fakeActive() {
  const calls: string[] = [];
  const active = {
    getPublicKey: async () => "pk",
    signEvent: async (e: any) => ({ ...e, id: "id", sig: "sig", pubkey: "pk" }),
    nip04Encrypt: async (p: string, t: string) => {
      calls.push(`04e:${p}:${t}`);
      return "c04";
    },
    nip04Decrypt: async () => {
      calls.push("04d");
      return "p04";
    },
    nip44Encrypt: async () => {
      calls.push("44e");
      return "c44";
    },
    nip44Decrypt: async () => {
      calls.push("44d");
      return "p44";
    },
  };
  return { active, calls };
}

describe("toNostrSigner", () => {
  it("passes through getPublicKey + signEvent", async () => {
    const { active } = fakeActive();
    const s = toNostrSigner(active as any);
    expect(await s.getPublicKey()).toBe("pk");
    const signed = await s.signEvent({ kind: 1, content: "x", tags: [], created_at: 0 });
    expect(signed.id).toBe("id");
  });

  it("maps NIP-04 encrypt/decrypt onto the package's nip04* names", async () => {
    const { active, calls } = fakeActive();
    const s = toNostrSigner(active as any);
    expect(await s.encrypt!("peer", "hi")).toBe("c04");
    expect(await s.decrypt!("peer", "c")).toBe("p04");
    expect(calls).toContain("04e:peer:hi");
    expect(calls).toContain("04d");
  });

  it("passes NIP-44 through unchanged", async () => {
    const { active, calls } = fakeActive();
    const s = toNostrSigner(active as any);
    expect(await s.nip44Encrypt!("peer", "hi")).toBe("c44");
    expect(await s.nip44Decrypt!("peer", "c")).toBe("p44");
    expect(calls).toEqual(expect.arrayContaining(["44e", "44d"]));
  });
});
