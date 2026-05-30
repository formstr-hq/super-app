import { nip19 } from "nostr-tools";
import { describe, it, expect } from "vitest";

import { formatNpub, npubToHex } from "./npub";

const HEX = "a".repeat(64);
const NPUB = nip19.npubEncode(HEX);

describe("npubToHex", () => {
  it("decodes a valid npub to hex", () => {
    expect(npubToHex(NPUB)).toBe(HEX);
  });

  it("accepts a raw 64-char hex pubkey", () => {
    expect(npubToHex(HEX)).toBe(HEX);
  });

  it("trims surrounding whitespace", () => {
    expect(npubToHex(`  ${NPUB}  `)).toBe(HEX);
  });

  it("returns null for invalid input", () => {
    expect(npubToHex("not-a-key")).toBeNull();
  });
});

describe("formatNpub", () => {
  it("returns a truncated npub for a hex pubkey", () => {
    const out = formatNpub(HEX);
    expect(out.startsWith("npub1")).toBe(true);
    expect(out).toContain("…");
  });

  it("falls back to truncated hex for invalid input", () => {
    expect(formatNpub("xyz")).toBe("xyz…");
  });
});
