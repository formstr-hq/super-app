import type { ActiveSigner } from "@formstr/signer";
import type { EventTemplate } from "nostr-tools";
import { describe, it, expect } from "vitest";

import { toNostrSigner } from "../src/auth/toNostrSigner";

function fakeActiveSigner(): ActiveSigner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getPublicKey: async () => "pubkey",
    signEvent: async (e: EventTemplate) => {
      calls.push(`signEvent:${e.kind}`);
      return { ...e, id: "id", pubkey: "pubkey", sig: "sig" };
    },
    nip04Encrypt: async (peer, plaintext) => {
      calls.push(`nip04Encrypt:${peer}`);
      return `04:${plaintext}`;
    },
    nip04Decrypt: async (peer, ciphertext) => {
      calls.push(`nip04Decrypt:${peer}`);
      return `d04:${ciphertext}`;
    },
    nip44Encrypt: async (peer, plaintext) => {
      calls.push(`nip44Encrypt:${peer}`);
      return `44:${plaintext}`;
    },
    nip44Decrypt: async (peer, ciphertext) => {
      calls.push(`nip44Decrypt:${peer}`);
      return `d44:${ciphertext}`;
    },
  };
}

describe("toNostrSigner", () => {
  it("maps NIP-04 encrypt/decrypt onto the core encrypt/decrypt names", async () => {
    const active = fakeActiveSigner();
    const signer = toNostrSigner(active);

    expect(await signer.encrypt!("peer", "hi")).toBe("04:hi");
    expect(await signer.decrypt!("peer", "ct")).toBe("d04:ct");
    expect(active.calls).toContain("nip04Encrypt:peer");
    expect(active.calls).toContain("nip04Decrypt:peer");
  });

  it("passes NIP-44 and signEvent straight through", async () => {
    const active = fakeActiveSigner();
    const signer = toNostrSigner(active);

    expect(await signer.nip44Encrypt!("peer", "hi")).toBe("44:hi");
    expect(await signer.nip44Decrypt!("peer", "ct")).toBe("d44:ct");
    expect(await signer.getPublicKey()).toBe("pubkey");
    const signed = await signer.signEvent({
      kind: 1,
      created_at: 0,
      tags: [],
      content: "x",
    } as EventTemplate);
    expect(signed.sig).toBe("sig");
    expect(active.calls).toContain("signEvent:1");
  });
});
