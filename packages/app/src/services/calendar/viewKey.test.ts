import { describe, it, expect } from "vitest";

import {
  generateViewKey,
  encryptWithViewKey,
  decryptWithViewKey,
  buildEventRef,
  parseEventRef,
} from "./viewKey";

describe("viewKey", () => {
  it("generates an nsec + matching pubkey", () => {
    const vk = generateViewKey();
    expect(vk.nsec).toMatch(/^nsec1/);
    expect(vk.pubkey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("round-trips content through the viewKey nsec", async () => {
    const vk = generateViewKey();
    const cipher = await encryptWithViewKey(vk.nsec, JSON.stringify([["title", "Secret"]]));
    expect(cipher).not.toContain("Secret");
    const plain = await decryptWithViewKey(vk.nsec, cipher);
    expect(JSON.parse(plain)).toEqual([["title", "Secret"]]);
  });

  it("anyone holding the nsec (not just the generator) can decrypt", async () => {
    const vk = generateViewKey();
    const cipher = await encryptWithViewKey(vk.nsec, "hello");
    // Reconstruct from the nsec alone (simulating an invitee) and decrypt.
    const plain = await decryptWithViewKey(vk.nsec, cipher);
    expect(plain).toBe("hello");
  });

  it("builds and parses an event ref", () => {
    const ref = buildEventRef("32678:pk:d1", "wss://r", "nsec1abc");
    expect(ref).toEqual(["32678:pk:d1", "wss://r", "nsec1abc"]);
    expect(parseEventRef(ref)).toEqual({
      coordinate: "32678:pk:d1",
      relayHint: "wss://r",
      viewKey: "nsec1abc",
    });
  });
});
