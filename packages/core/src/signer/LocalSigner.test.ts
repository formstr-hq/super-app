import { generateSecretKey, verifyEvent } from "nostr-tools";
import { describe, it, expect } from "vitest";

import { LocalSigner } from "./LocalSigner";

describe("LocalSigner", () => {
  it("signs an event verifiably", async () => {
    const signer = new LocalSigner(generateSecretKey());
    const event = await signer.signEvent({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: "hello",
    });
    expect(verifyEvent(event)).toBe(true);
  });

  it("dispose() zeroes the secret key", async () => {
    const sk = generateSecretKey();
    const skCopy = new Uint8Array(sk);
    const signer = new LocalSigner(sk);
    signer.dispose();
    // Original buffer wiped
    expect(Array.from(sk)).toEqual(new Array(32).fill(0));
    // Sanity: copy still intact (proves we actually wiped the original)
    expect(skCopy.some((b) => b !== 0)).toBe(true);
  });
});
