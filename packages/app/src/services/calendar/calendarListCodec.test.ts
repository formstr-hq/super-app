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
});
