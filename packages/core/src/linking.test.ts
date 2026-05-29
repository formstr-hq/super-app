import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import { createRef, createTagRef, parseRef, parseTagRef } from "./linking";

describe("linking parseRef", () => {
  it("parses a forms naddr", () => {
    const naddr = nip19.naddrEncode({
      kind: 30168,
      pubkey: "00".repeat(32),
      identifier: "my-form",
      relays: [],
    });
    const ref = parseRef(naddr);
    expect(ref?.module).toBe("forms");
    expect(ref?.params.identifier).toBe("my-form");
  });

  it("returns null for naddr with unknown kind", () => {
    const naddr = nip19.naddrEncode({
      kind: 30617, // Nostr Git repo — not a module
      pubkey: "00".repeat(32),
      identifier: "repo",
      relays: [],
    });
    expect(parseRef(naddr)).toBeNull();
  });

  it("returns null for nevent with unknown kind", () => {
    const nevent = nip19.neventEncode({
      id: "00".repeat(32),
      kind: 7, // reaction — not a module kind
      relays: [],
    });
    expect(parseRef(nevent)).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(parseRef("not-a-bech32-string")).toBeNull();
  });

  it("round-trips createRef → parseRef for a forms entity", () => {
    const naddr = createRef("forms", 30168, "11".repeat(32), "feedback", []);
    const ref = parseRef(naddr);
    expect(ref?.module).toBe("forms");
    expect(ref?.params.identifier).toBe("feedback");
  });
});

describe("linking tag-ref form", () => {
  it("createTagRef formats 'formstr:<module>:<identifier>'", () => {
    expect(createTagRef("forms", "abcd")).toBe("formstr:forms:abcd");
    expect(createTagRef("calendar", "naddr1xyz")).toBe("formstr:calendar:naddr1xyz");
  });

  it("parseTagRef inverts createTagRef", () => {
    expect(parseTagRef("formstr:forms:abcd")).toEqual({
      module: "forms",
      identifier: "abcd",
    });
    expect(parseTagRef("formstr:polls:naddr1xyz")).toEqual({
      module: "polls",
      identifier: "naddr1xyz",
    });
  });

  it("parseTagRef returns null for malformed input", () => {
    expect(parseTagRef("not-a-tag-ref")).toBeNull();
    expect(parseTagRef("formstr:invalid-module:abc")).toBeNull();
    expect(parseTagRef("formstr:forms:")).toBeNull();
  });
});
