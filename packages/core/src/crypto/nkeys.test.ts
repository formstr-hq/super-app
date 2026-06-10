/**
 * Constant-time-comparison audit (spec PR #2 Crypto Fix #3):
 *   Reviewed nkeys.ts on 2026-05-27. The module only encodes/decodes bech32 +
 *   TLV — no equality comparisons on secret/key material. No fix required.
 *   If equality on secrets is ever added, use `@noble/hashes/utils#equalBytes`.
 */
import { describe, expect, it } from "vitest";

import { decodeNKeys, encodeNKeys } from "./nkeys";

/**
 * Golden vectors produced by running the standalone apps' nkeys algorithm
 * verbatim (upstream/nostr-forms/packages/formstr-app/src/utils/nkeys.ts —
 * nostr-docs ships the identical file): TLV rows are `[type, 1-byte length,
 * value]` with ALL type-0 rows (key names) emitted before ALL type-1 rows
 * (key values), paired by index on decode; bech32 limit 2048.
 *
 * These pin true cross-app compatibility: formstr.app / docs share links must
 * decode here, and our links must decode there.
 */
const UPSTREAM_VECTORS = {
  single: {
    keys: { viewKey: "a1".repeat(32) },
    encoded:
      "nkeys1qqrhv6t9wa9k27gpgpsnzcf3vyckzvtpx9snzcf3vyckzvtpx9snzcf3vyckzvtpx9snzcf3vyckzvtpx9snzcf3vyckzvtpx9snzcf3vyckzvtpx9snzcf3uh80up",
  },
  dual: {
    keys: { viewKey: "a1".repeat(32), secretKey: "b2".repeat(32) },
    encoded:
      "nkeys1qqrhv6t9wa9k27gqp9ek2cmjv46yketeq9qxzvtpx9snzcf3vyckzvtpx9snzcf3vyckzvtpx9snzcf3vyckzvtpx9snzcf3vyckzvtpx9snzcf3vyckzvtpx9snzcf3vyckzvtpxyq5qc3jvgexyvnzxf3ryc3jvgexyvnzxf3ryc3jvgexyvnzxf3ryc3jvgexyvnzxf3ryc3jvgexyvnzxf3ryc3jvgexyvnzxf3ryc3jvgeqjngxj9",
  },
  pagesStyle: {
    keys: { viewKey: "c3".repeat(32), editKey: "d4".repeat(32) },
    encoded:
      "nkeys1qqrhv6t9wa9k27gqqajkg6t5fdjhjq2qvvekxvmrxd3nxcenvvekxvmrxd3nxcenvvekxvmrxd3nxcenvvekxvmrxd3nxcenvvekxvmrxd3nxcenvvekxvmrxd3nxcenvvekxvcpgpjrgep5vs6xgdryx3jrgep5vs6xgdryx3jrgep5vs6xgdryx3jrgep5vs6xgdryx3jrgep5vs6xgdryx3jrgep5vs6xgdryx3jrgep54ut2dz",
  },
} as const;

describe("nkeys", () => {
  it("encodes a single key byte-for-byte like the standalone apps", () => {
    const { keys, encoded } = UPSTREAM_VECTORS.single;
    expect(encodeNKeys(keys)).toBe(encoded);
  });

  it("encodes multiple keys byte-for-byte like the standalone apps", () => {
    expect(encodeNKeys(UPSTREAM_VECTORS.dual.keys)).toBe(UPSTREAM_VECTORS.dual.encoded);
    expect(encodeNKeys(UPSTREAM_VECTORS.pagesStyle.keys)).toBe(UPSTREAM_VECTORS.pagesStyle.encoded);
  });

  it("decodes standalone-app-encoded links", () => {
    expect(decodeNKeys(UPSTREAM_VECTORS.single.encoded)).toEqual(UPSTREAM_VECTORS.single.keys);
    expect(decodeNKeys(UPSTREAM_VECTORS.dual.encoded)).toEqual(UPSTREAM_VECTORS.dual.keys);
    expect(decodeNKeys(UPSTREAM_VECTORS.pagesStyle.encoded)).toEqual(
      UPSTREAM_VECTORS.pagesStyle.keys,
    );
  });

  it("encode → decode round-trip", () => {
    const input = { responseKey: "00".repeat(32), viewKey: "11".repeat(32) };
    const encoded = encodeNKeys(input);
    expect(encoded.startsWith("nkeys1")).toBe(true);
    const decoded = decodeNKeys(encoded);
    expect(decoded).toEqual(input);
  });

  it("throws when a value exceeds the 1-byte TLV length (255 bytes)", () => {
    expect(() => encodeNKeys({ viewKey: "a".repeat(256) })).toThrow();
  });

  it("throws when a key name exceeds the 1-byte TLV length (255 bytes)", () => {
    expect(() => encodeNKeys({ ["k".repeat(256)]: "a1".repeat(32) })).toThrow();
  });

  it("decode throws on invalid prefix", () => {
    expect(() => decodeNKeys("npub1abc")).toThrow();
  });
});
