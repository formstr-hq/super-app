import { describe, it, expect } from "vitest";

import type { CalendarEvent, CalendarList } from "../services/calendar";

import { filterEventsByCalendarVisibility } from "./calendarMembership";

function evt(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "d1",
    eventId: "e1",
    title: "E",
    description: "",
    kind: 31923,
    begin: 0,
    end: 0,
    createdAt: 0,
    categories: [],
    participants: [],
    location: [],
    website: "",
    user: "pub",
    isPrivate: false,
    repeat: { rrule: null },
    ...over,
  } as CalendarEvent;
}

function cal(id: string, refs: string[][]): CalendarList {
  return {
    id,
    eventId: `evt-${id}`,
    title: id,
    description: "",
    color: "#000",
    eventRefs: refs,
    createdAt: 0,
    isVisible: true,
  };
}

describe("filterEventsByCalendarVisibility", () => {
  it("keeps an event that belongs to no calendar (unfiled)", () => {
    const e = evt({ id: "d1", kind: 31923, user: "pub" });
    const result = filterEventsByCalendarVisibility([e], [cal("c1", [])], new Set());
    expect(result).toHaveLength(1);
  });

  it("hides an event whose only owning calendar is not visible", () => {
    const e = evt({ id: "d1", kind: 31923, user: "pub" });
    const calendars = [cal("c1", [["31923:pub:d1", "", ""]])];
    const result = filterEventsByCalendarVisibility([e], calendars, new Set());
    expect(result).toHaveLength(0);
  });

  it("shows an event when at least one owning calendar is visible", () => {
    const e = evt({ id: "d1", kind: 31923, user: "pub" });
    const calendars = [
      cal("c1", [["31923:pub:d1", "", ""]]),
      cal("c2", [["31923:pub:d1", "", ""]]),
    ];
    const result = filterEventsByCalendarVisibility([e], calendars, new Set(["c2"]));
    expect(result).toHaveLength(1);
  });

  it("matches membership by coordinate (kind:user:id), not by calendarId field", () => {
    const e = evt({ id: "d9", kind: 31923, user: "alice", calendarId: undefined });
    const calendars = [cal("c1", [["31923:alice:d9", "wss://r", "nsec1x"]])];
    const hidden = filterEventsByCalendarVisibility([e], calendars, new Set());
    const shown = filterEventsByCalendarVisibility([e], calendars, new Set(["c1"]));
    expect(hidden).toHaveLength(0);
    expect(shown).toHaveLength(1);
  });
});
