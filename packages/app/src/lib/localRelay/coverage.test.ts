import type { Filter } from "nostr-tools";
import { describe, it, expect } from "vitest";

import { isCoveredBy } from "./coverage";

const ME = "a".repeat(64);

describe("isCoveredBy", () => {
  it("covers a read whose kinds and author the standing interest already declared", () => {
    const declared: Filter = { kinds: [30301, 32301], authors: [ME] };
    expect(isCoveredBy({ kinds: [30301], authors: [ME] }, declared)).toBe(true);
  });

  it("does not cover a kind the interest never asked for", () => {
    expect(isCoveredBy({ kinds: [30302], authors: [ME] }, { kinds: [30301], authors: [ME] })).toBe(
      false,
    );
  });

  it("does not cover a read for someone else's events", () => {
    const declared: Filter = { kinds: [30301], authors: [ME] };
    expect(isCoveredBy({ kinds: [30301], authors: ["b".repeat(64)] }, declared)).toBe(false);
    // Author-less means "anyone", which a single-author interest cannot promise.
    expect(isCoveredBy({ kinds: [30301] }, declared)).toBe(false);
  });

  it("covers a narrower tag filter but not a broader one", () => {
    const declared: Filter = { kinds: [32301], authors: [ME], "#d": ["board-1", "board-2"] };
    expect(isCoveredBy({ kinds: [32301], authors: [ME], "#d": ["board-1"] }, declared)).toBe(true);
    expect(isCoveredBy({ kinds: [32301], authors: [ME], "#d": ["board-9"] }, declared)).toBe(false);
    expect(isCoveredBy({ kinds: [32301], authors: [ME] }, declared)).toBe(false);
  });

  it("treats a windowed read as cold", () => {
    // A standing interest tracks the live tail. It says nothing about whether
    // the cache holds a specific historical window, so a since/until read must
    // wait for the network rather than settle on whatever happens to be there.
    const declared: Filter = { kinds: [1], authors: [ME] };
    expect(isCoveredBy({ kinds: [1], authors: [ME], since: 1000 }, declared)).toBe(false);
    expect(isCoveredBy({ kinds: [1], authors: [ME], until: 1000 }, declared)).toBe(false);
  });

  it("is covered when any one standing interest covers it", () => {
    const declared: Filter[] = [
      { kinds: [14083], authors: [ME] },
      { kinds: [30301], authors: [ME] },
    ];
    expect(declared.some((d) => isCoveredBy({ kinds: [30301], authors: [ME] }, d))).toBe(true);
  });
});
