import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/agent/services/calendar/service", () => ({
  fetchCalendarEventsSync: vi.fn(),
  fetchCalendarLists: vi.fn(),
  publishPublicCalendarEvent: vi.fn(),
  publishPrivateCalendarEvent: vi.fn(),
  createCalendarList: vi.fn(),
  updateCalendarList: vi.fn(),
  deleteCalendarList: vi.fn(),
  addEventToCalendarList: vi.fn(),
  deleteCalendarEvent: vi.fn(),
}));

import * as calendarService from "@formstr/agent/services/calendar/service";

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

describe("createCalendar", () => {
  it("forwards title, color and description to the service", async () => {
    (calendarService.createCalendarList as any).mockResolvedValue({ id: "c1", title: "Work" });
    await useCalendarStore.getState().createCalendar("Work", "#4285f4", "desc");
    expect(calendarService.createCalendarList).toHaveBeenCalledWith("Work", "#4285f4", "desc");
  });
});

describe("updateCalendar", () => {
  it("forwards the calendar to updateCalendarList and replaces it in state", async () => {
    const cal = { id: "c1", title: "Old", color: "#fff", eventRefs: [] };
    useCalendarStore.setState({ calendars: [cal as any] });
    (calendarService.updateCalendarList as any).mockResolvedValue({ ...cal, title: "New" });
    await useCalendarStore.getState().updateCalendar({ ...cal, title: "New" } as any);
    expect(calendarService.updateCalendarList).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1", title: "New" }),
    );
    expect(useCalendarStore.getState().calendars[0].title).toBe("New");
  });
});

describe("deleteCalendar", () => {
  it("calls deleteCalendarList with the coordinate and removes it from state", async () => {
    useCalendarStore.setState({ calendars: [{ id: "c1" } as any, { id: "c2" } as any] });
    await useCalendarStore.getState().deleteCalendar("32123:pub:c1", "c1");
    expect(calendarService.deleteCalendarList).toHaveBeenCalledWith("32123:pub:c1");
    expect(useCalendarStore.getState().calendars.map((c) => c.id)).toEqual(["c2"]);
  });
});

describe("createEvent membership", () => {
  it("adds the event coordinate (no 'a' prefix) via addEventToCalendarList", async () => {
    const cal = { id: "c1", title: "Work", eventRefs: [] };
    useCalendarStore.setState({ calendars: [cal as any] });
    (calendarService.publishPublicCalendarEvent as any).mockResolvedValue(
      evt({ id: "d9", kind: 31923, user: "pub" }),
    );
    (calendarService.addEventToCalendarList as any).mockResolvedValue({
      ...cal,
      eventRefs: [["31923:pub:d9", "", ""]],
    });
    await useCalendarStore.getState().createEvent({
      title: "X",
      description: "",
      begin: new Date(0),
      end: new Date(0),
      calendarId: "c1",
    } as any);
    expect(calendarService.addEventToCalendarList).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1" }),
      ["31923:pub:d9", "", ""],
    );
  });

  it("auto-creates a default calendar for a private event with no calendar (viewKey must persist)", async () => {
    useCalendarStore.setState({ calendars: [] });
    (calendarService.publishPrivateCalendarEvent as any).mockResolvedValue(
      evt({
        id: "p1",
        kind: 32678,
        user: "pub",
        isPrivate: true,
        viewKey: "nsec1xyz",
        relayHint: "wss://r",
      }),
    );
    (calendarService.createCalendarList as any).mockResolvedValue({
      id: "auto1",
      title: "My Calendar",
      color: "#334155",
      eventRefs: [],
    });
    (calendarService.addEventToCalendarList as any).mockResolvedValue({
      id: "auto1",
      eventRefs: [["32678:pub:p1", "wss://r", "nsec1xyz"]],
    });
    await useCalendarStore.getState().createEvent({
      title: "Secret",
      description: "",
      begin: new Date(0),
      end: new Date(0),
      isPrivate: true,
    } as any);
    expect(calendarService.createCalendarList).toHaveBeenCalled();
    expect(calendarService.addEventToCalendarList).toHaveBeenCalledWith(
      expect.objectContaining({ id: "auto1" }),
      ["32678:pub:p1", "wss://r", "nsec1xyz"],
    );
  });

  it("links a private event with no chosen calendar to the first existing calendar", async () => {
    const cal = { id: "c1", title: "Work", eventRefs: [] };
    useCalendarStore.setState({ calendars: [cal as any] });
    (calendarService.publishPrivateCalendarEvent as any).mockResolvedValue(
      evt({
        id: "p2",
        kind: 32678,
        user: "pub",
        isPrivate: true,
        viewKey: "nsec1abc",
        relayHint: "",
      }),
    );
    (calendarService.addEventToCalendarList as any).mockResolvedValue({
      ...cal,
      eventRefs: [["32678:pub:p2", "", "nsec1abc"]],
    });
    await useCalendarStore.getState().createEvent({
      title: "Secret2",
      description: "",
      begin: new Date(0),
      end: new Date(0),
      isPrivate: true,
    } as any);
    expect(calendarService.createCalendarList).not.toHaveBeenCalled();
    expect(calendarService.addEventToCalendarList).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1" }),
      ["32678:pub:p2", "", "nsec1abc"],
    );
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
