import { describe, it, expect } from "vitest";

import { buildIcs } from "./ics";

function event(over: Partial<any> = {}) {
  return {
    id: "d1",
    eventId: "e1",
    kind: 31923,
    title: "Standup",
    description: "",
    begin: Date.UTC(2026, 7, 18, 9, 0, 0),
    end: Date.UTC(2026, 7, 18, 9, 30, 0),
    allDay: false,
    location: [],
    participants: [],
    categories: [],
    references: [],
    geohashes: [],
    user: "alice",
    isPrivate: false,
    repeat: { rrule: null },
    createdAt: 0,
    ...over,
  };
}

describe("buildIcs", () => {
  it("keeps the timezone of an older event whose raw tags carry start_tzid", () => {
    // The SDK neither writes nor parses tzid rows, but it does keep the raw
    // wire event — which is where a pre-migration event's timezone still lives.
    const ics = buildIcs([
      event({
        event: {
          tags: [
            ["d", "d1"],
            ["start_tzid", "Europe/Berlin"],
          ],
        },
      }),
    ]);
    expect(ics).toContain("DTSTART;TZID=Europe/Berlin:");
  });

  it("falls back to UTC when the event carries no tzid", () => {
    const ics = buildIcs([event()]);
    expect(ics).toContain("DTSTART:20260818T090000Z");
  });

  it("uses start_tzid for the end when only start_tzid is present", () => {
    const ics = buildIcs([event({ event: { tags: [["start_tzid", "Asia/Kolkata"]] } })]);
    expect(ics).toContain("DTEND;TZID=Asia/Kolkata:");
  });
});
