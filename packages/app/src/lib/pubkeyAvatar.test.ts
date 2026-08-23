import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import { avatarColor, avatarInitials, initialsFromName } from "./pubkeyAvatar";

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

describe("initialsFromName", () => {
  it("takes the first letter of the first two words", () => {
    expect(initialsFromName("Naman Khandelwal")).toBe("NK");
    expect(initialsFromName("Ada Lovelace Byron")).toBe("AL");
  });

  it("takes the first two letters of a single word", () => {
    expect(initialsFromName("itsmanas")).toBe("IT");
  });

  it("collapses the whitespace people actually type", () => {
    expect(initialsFromName("  infinity   x2 ")).toBe("IX");
  });

  // A one-character handle is a real name; half an initial beats none.
  it("returns what it has when the name is one character", () => {
    expect(initialsFromName("q")).toBe("Q");
  });

  // Nostr names carry emoji and ornaments. A tile of punctuation says nothing,
  // so the caller should fall back to the npub instead.
  it("returns null when there is nothing readable to take", () => {
    expect(initialsFromName("")).toBeNull();
    expect(initialsFromName("   ")).toBeNull();
    expect(initialsFromName("★ ☆")).toBeNull();
    expect(initialsFromName("🔥🔥")).toBeNull();
  });

  // A script with no case, and no spaces between words, still identifies its
  // owner better than a random npub does.
  it("keeps a name written in a non-Latin script", () => {
    expect(initialsFromName("彡サト")).toBe("彡サ");
  });

  it("keeps a digit, which plenty of handles start with", () => {
    expect(initialsFromName("2fast 4u")).toBe("24");
  });
});
