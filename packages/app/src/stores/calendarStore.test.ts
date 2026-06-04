import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/calendar/service", () => ({
  fetchCalendarEventsSync: vi.fn(),
  fetchCalendarLists: vi.fn(),
  publishPublicCalendarEvent: vi.fn(),
  publishPrivateCalendarEvent: vi.fn(),
  createCalendarList: vi.fn(),
  updateCalendarList: vi.fn(),
  deleteCalendarEvent: vi.fn(),
}));

import * as calendarService from "../services/calendar/service";

import { useCalendarStore } from "./calendarStore";

function evt(over: Partial<any> = {}) {
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCalendarStore.setState({ events: [], calendars: [], error: null });
});

describe("ingestEvent", () => {
  it("adds an event and does not duplicate by id", () => {
    useCalendarStore.getState().ingestEvent(evt({ id: "a" }));
    useCalendarStore.getState().ingestEvent(evt({ id: "a" }));
    expect(useCalendarStore.getState().events).toHaveLength(1);
  });
});

describe("deleteEvent", () => {
  it("removes the event by id and forwards the coordinate to the service", async () => {
    useCalendarStore.setState({ events: [evt({ id: "d1" }), evt({ id: "d2", eventId: "e2" })] });
    await useCalendarStore.getState().deleteEvent("d1", "31923:pub:d1");
    expect(calendarService.deleteCalendarEvent).toHaveBeenCalledWith("d1", "31923:pub:d1");
    const ids = useCalendarStore.getState().events.map((e) => e.id);
    expect(ids).toEqual(["d2"]);
  });
});

describe("updateEvent", () => {
  it("re-publishes with existingId and replaces the event in place", async () => {
    useCalendarStore.setState({ events: [evt({ id: "x", title: "Old" })] });
    (calendarService.publishPublicCalendarEvent as any).mockResolvedValue(
      evt({ id: "x", title: "New" }),
    );
    await useCalendarStore.getState().updateEvent({
      title: "New",
      description: "",
      begin: new Date(0),
      end: new Date(0),
      existingId: "x",
    });
    expect(calendarService.publishPublicCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ existingId: "x" }),
    );
    const events = useCalendarStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("New");
  });
});
