import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import { avatarColor, avatarInitials } from "./pubkeyAvatar";

const PUBKEY = "a".repeat(63) + "b";
const OTHER = "c".repeat(63) + "d";

describe("avatarColor", () => {
  it("is stable for a key and differs between keys", () => {
    expect(avatarColor(PUBKEY)).toBe(avatarColor(PUBKEY));
    expect(avatarColor(PUBKEY)).not.toBe(avatarColor(OTHER));
  });

  it("stays in the band that keeps white text legible", () => {
    const match = /^hsl\((\d+), 42%, 42%\)$/.exec(avatarColor(PUBKEY));
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeLessThan(360);
  });
});

describe("avatarInitials", () => {
  it("takes two characters from the npub body", () => {
    const npub = nip19.npubEncode(PUBKEY);
    expect(avatarInitials(PUBKEY)).toBe(npub.slice(5, 7).toUpperCase());
  });

  it("falls back to the raw key when it cannot be encoded", () => {
    expect(avatarInitials("not-a-key")).toBe("NO");
  });
});
