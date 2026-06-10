import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import {
  createRef,
  createTagRef,
  MODULE_ROUTES,
  parseRef,
  parseTagRef,
  resolveRef,
} from "./linking";

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

  it("maps each module's real event kinds (pages 33457, drive 34578, calendar 32678/32123)", () => {
    const cases: Array<[number, string]> = [
      [33457, "pages"], // encrypted markdown doc (nostr-docs)
      [34578, "drive"], // file metadata (formstr-drive)
      [31923, "calendar"], // public time-based event
      [32678, "calendar"], // private event
      [32123, "calendar"], // calendar list
    ];
    for (const [kind, module] of cases) {
      const naddr = nip19.naddrEncode({
        kind,
        pubkey: "00".repeat(32),
        identifier: "x",
        relays: [],
      });
      expect(parseRef(naddr)?.module, `kind ${kind}`).toBe(module);
    }
  });

  it("maps a polls nevent (kind 1068)", () => {
    const nevent = nip19.neventEncode({ id: "00".repeat(32), kind: 1068, relays: [] });
    expect(parseRef(nevent)?.module).toBe("polls");
  });

  it("no longer claims kinds the modules don't read (30023/30024 NIP-23, 30563)", () => {
    for (const kind of [30023, 30024, 30563]) {
      const naddr = nip19.naddrEncode({
        kind,
        pubkey: "00".repeat(32),
        identifier: "x",
        relays: [],
      });
      expect(parseRef(naddr), `kind ${kind}`).toBeNull();
    }
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

  it("parses an nprofile", () => {
    const nprofile = nip19.nprofileEncode({
      pubkey: "aa".repeat(32),
      relays: ["wss://relay.damus.io"],
    });
    const ref = parseRef(nprofile);
    expect(ref?.module).toBe("forms");
    expect(ref?.params.pubkey).toBe("aa".repeat(32));
    expect(ref?.route).toMatch(/^\/profile\//);
  });

  it("resolveRef returns a route string for valid input", () => {
    const naddr = createRef("forms", 30168, "11".repeat(32), "abc", []);
    const route = resolveRef(naddr);
    expect(route).toMatch(/^\/forms\//);
  });

  it("resolveRef returns null for invalid input", () => {
    expect(resolveRef("garbage")).toBeNull();
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

describe("MODULE_ROUTES", () => {
  it("has an entry for every module type", () => {
    for (const m of ["forms", "calendar", "pages", "drive", "polls"] as const) {
      expect(MODULE_ROUTES[m]).toMatch(/^\/\w+/);
    }
  });

  it("parseRef route uses MODULE_ROUTES base", () => {
    const naddr = nip19.naddrEncode({
      kind: 30168,
      pubkey: "00".repeat(32),
      identifier: "x",
      relays: [],
    });
    const ref = parseRef(naddr);
    expect(ref?.route.startsWith(MODULE_ROUTES.forms)).toBe(true);
  });
});
