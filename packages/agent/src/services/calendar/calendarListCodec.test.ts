import { describe, it, expect } from "vitest";

import { encodeCalendarList, decodeCalendarList } from "./calendarListCodec";
import type { CalendarList } from "./types";

const list: CalendarList = {
  id: "d123",
  eventId: "",
  title: "Work",
  description: "stuff",
  color: "#4285f4",
  eventRefs: [["31923:pk:abc", "wss://r.test", "nsec1view"]],
  createdAt: 1000,
  isVisible: true,
};

describe("calendarListCodec", () => {
  it("encodes to a NIP tags array the standalone understands", () => {
    const tags = encodeCalendarList(list);
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toContainEqual(["title", "Work"]);
    expect(tags).toContainEqual(["content", "stuff"]);
    expect(tags).toContainEqual(["color", "#4285f4"]);
    expect(tags).toContainEqual(["a", "31923:pk:abc", "wss://r.test", "nsec1view"]);
  });

  it("round-trips through decode (standalone-compatible shape)", () => {
    const decoded = decodeCalendarList(encodeCalendarList(list), "d123", "evt1");
    expect(decoded.title).toBe("Work");
    expect(decoded.color).toBe("#4285f4");
    expect(decoded.eventRefs).toEqual([["31923:pk:abc", "wss://r.test", "nsec1view"]]);
    expect(decoded.id).toBe("d123");
    expect(decoded.eventId).toBe("evt1");
  });

  it("decodes a standalone-authored fixture (title/color/a tags)", () => {
    const standalone = [
      ["title", "Team"],
      ["color", "#0b8043"],
      ["a", "31923:pk:z", "", ""],
    ];
    const d = decodeCalendarList(standalone, "dx", "ex");
    expect(d.title).toBe("Team");
    expect(d.eventRefs[0][0]).toBe("31923:pk:z");
  });

  it("heals double-'a' refs written by T9-T16 (coordinate was in relay-URL slot)", () => {
    const doubleA = [
      ["title", "Bad"],
      ["color", "#334155"],
      ["a", "a", "31923:pk:xyz", "wss://r.test", "nsec1abc"],
    ];
    const d = decodeCalendarList(doubleA, "dx", "ex");
    expect(d.eventRefs).toHaveLength(1);
    expect(d.eventRefs[0][0]).toBe("31923:pk:xyz");
    expect(d.eventRefs[0][1]).toBe("wss://r.test");
    expect(d.eventRefs[0][2]).toBe("nsec1abc");
  });

  it("re-encoding healed refs produces valid tags (no double-a on next write)", () => {
    const doubleA = [
      ["title", "Bad"],
      ["color", "#334155"],
      ["a", "a", "31923:pk:xyz", "wss://r.test", "nsec1abc"],
    ];
    const healed = decodeCalendarList(doubleA, "dx", "ex");
    const encoded = encodeCalendarList(healed);
    expect(encoded).toContainEqual(["a", "31923:pk:xyz", "wss://r.test", "nsec1abc"]);
    expect(encoded.filter((t) => t[0] === "a")).toHaveLength(1);
    expect(encoded.find((t) => t[0] === "a" && t[1] === "a")).toBeUndefined();
  });
});
