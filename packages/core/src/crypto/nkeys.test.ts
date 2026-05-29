/**
 * Constant-time-comparison audit (spec PR #2 Crypto Fix #3):
 *   Reviewed nkeys.ts on 2026-05-27. The module only encodes/decodes bech32 +
 *   TLV — no equality comparisons on secret/key material. No fix required.
 *   If equality on secrets is ever added, use `@noble/hashes/utils#equalBytes`.
 */
import { describe, expect, it } from "vitest";

import { decodeNKeys, encodeNKeys } from "./nkeys";

describe("nkeys", () => {
  it("encode → decode round-trip", () => {
    const input = { responseKey: "00".repeat(32), viewKey: "11".repeat(32) };
    const encoded = encodeNKeys(input);
    expect(encoded.startsWith("nkeys1")).toBe(true);
    const decoded = decodeNKeys(encoded);
    expect(decoded).toEqual(input);
  });

  it("decode throws on invalid prefix", () => {
    expect(() => decodeNKeys("npub1abc")).toThrow();
  });
});
