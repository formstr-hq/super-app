import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import { makeBoard } from "./boardFixture";
import { boardKey, coordinateFromNaddr, naddrForBoard, naddrForCoordinate } from "./boardKey";

const PUBKEY = "a".repeat(64);

// Encoded once by hand with `nip19.naddrEncode`, not by the code under test:
// asserting against `coordinateFromNaddr` would only prove the two halves agree
// with each other, and a mirrored mistake — a swapped kind, a dropped field —
// would round-trip perfectly.
const PUBLIC_NADDR =
  "naddr1qvzqqqrkt5pzp242424242424242424242424242424242424242424242424242qqrkymmpwfjz6vguclwzx";
const PRIVATE_NADDR =
  "naddr1qvzqqqr795pzp242424242424242424242424242424242424242424242424242qqrkymmpwfjz6vg2e9adl";

describe("boardKey", () => {
  it("keys a public board on the public board kind", () => {
    expect(boardKey(makeBoard({ pubkey: PUBKEY, isPrivate: false }))).toBe(
      `30301:${PUBKEY}:board-1`,
    );
  });

  it("keys a private board on the private board kind", () => {
    expect(boardKey(makeBoard({ pubkey: PUBKEY, isPrivate: true }))).toBe(
      `32301:${PUBKEY}:board-1`,
    );
  });
});

describe("naddrForCoordinate", () => {
  it("encodes a coordinate as the naddr for that address", () => {
    expect(naddrForCoordinate(`30301:${PUBKEY}:board-1`)).toBe(PUBLIC_NADDR);
  });

  it("keeps a `d` tag that itself contains colons", () => {
    const coordinate = `30301:${PUBKEY}:has:colons`;
    expect(coordinateFromNaddr(naddrForCoordinate(coordinate))).toBe(coordinate);
  });

  it("falls back to the raw coordinate rather than throwing on a non-hex pubkey", () => {
    // Invitation coordinates come off a relay-supplied gift wrap, so a
    // malformed one is reachable: `nip19.naddrEncode` rejects it with a raw
    // hex-decoding error, which would reject the navigation promise.
    const segment = naddrForCoordinate("30301:not-hex:board-1");

    expect(decodeURIComponent(segment)).toBe("30301:not-hex:board-1");
  });

  it("falls back rather than throwing on a coordinate with no `d` at all", () => {
    expect(decodeURIComponent(naddrForCoordinate("nonsense"))).toBe("nonsense");
  });
});

describe("naddrForBoard", () => {
  it("encodes a private board under its private kind", () => {
    expect(naddrForBoard(makeBoard({ pubkey: PUBKEY, isPrivate: true }))).toBe(PRIVATE_NADDR);
  });

  it("carries the relay that accepted the board, so the link travels", () => {
    // Without a hint the naddr only resolves for someone whose relay set
    // already overlaps the board's — which is the case a shared link is for.
    const naddr = naddrForBoard(
      makeBoard({ pubkey: PUBKEY, isPrivate: false, relayHint: "wss://relay.test" }),
    );

    expect(nip19.decode(naddr).data).toMatchObject({ relays: ["wss://relay.test"] });
    expect(coordinateFromNaddr(naddr)).toBe(`30301:${PUBKEY}:board-1`);
  });

  it("does not throw on a board whose pubkey is not hex", () => {
    expect(() => naddrForBoard(makeBoard({ pubkey: "owner" }))).not.toThrow();
  });
});

describe("coordinateFromNaddr", () => {
  it("decodes an naddr back to the board key it was built from", () => {
    expect(coordinateFromNaddr(PUBLIC_NADDR)).toBe(`30301:${PUBKEY}:board-1`);
  });

  it("returns null for a bare word, so route sentinels cannot collide", () => {
    expect(coordinateFromNaddr("invitations")).toBeNull();
  });

  it("returns null for a well-formed NIP-19 entity that is not an naddr", () => {
    expect(
      coordinateFromNaddr("npub1424242424242424242424242424242424242424242424242424qamrcaj"),
    ).toBeNull();
  });

  it("returns null for a raw coordinate, leaving the caller its own fallback", () => {
    expect(coordinateFromNaddr(`30301:${PUBKEY}:board-1`)).toBeNull();
  });
});
