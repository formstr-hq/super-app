import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/agent/services/calendar/service", () => ({
  fetchCalendarEventsSync: vi.fn(),
  fetchCalendarLists: vi.fn(),
  publishPublicCalendarEvent: vi.fn(),
  publishPrivateCalendarEvent: vi.fn(),
  createCalendarEvent: vi.fn(),
  createCalendarList: vi.fn(),
  updateCalendarList: vi.fn(),
  deleteCalendarList: vi.fn(),
  addEventToCalendarList: vi.fn(),
  deleteCalendarEvent: vi.fn(),
}));

vi.mock("@formstr/agent/services/calendar/busyList", () => ({
  addBusyRange: vi.fn().mockResolvedValue(undefined),
  removeBusyRange: vi.fn().mockResolvedValue(undefined),
}));

import { addBusyRange, removeBusyRange } from "@formstr/agent/services/calendar/busyList";
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

describe("createEvent — delegates to the shared createCalendarEvent service", () => {
  it("passes the draft + loaded calendars and upserts the returned event + calendar", async () => {
    const cal = { id: "c1", title: "Work", eventRefs: [] };
    useCalendarStore.setState({ calendars: [cal as any] });
    (calendarService.createCalendarEvent as any).mockResolvedValue({
      event: evt({ id: "d9", kind: 31923, user: "pub" }),
      calendar: { ...cal, eventRefs: [["31923:pub:d9", "", ""]] },
    });
    await useCalendarStore.getState().createEvent({
      title: "X",
      description: "",
      begin: new Date(0),
      end: new Date(0),
      calendarId: "c1",
    } as any);
    expect(calendarService.createCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: "c1" }),
      { calendars: [cal] },
    );
    const state = useCalendarStore.getState();
    expect(state.events.map((e) => e.id)).toContain("d9");
    // The updated list returned by the service replaced the stale one in state.
    expect(state.calendars.find((c) => c.id === "c1")?.eventRefs).toEqual([
      ["31923:pub:d9", "", ""],
    ]);
  });

  it("upserts a newly auto-created calendar returned by the service", async () => {
    useCalendarStore.setState({ calendars: [] });
    (calendarService.createCalendarEvent as any).mockResolvedValue({
      event: evt({ id: "p1", kind: 32678, user: "pub", isPrivate: true }),
      calendar: {
        id: "auto1",
        title: "My Calendar",
        eventRefs: [["32678:pub:p1", "", "nsec1xyz"]],
      },
    });
    await useCalendarStore.getState().createEvent({
      title: "Secret",
      description: "",
      begin: new Date(0),
      end: new Date(0),
      isPrivate: true,
    } as any);
    const state = useCalendarStore.getState();
    expect(state.calendars.map((c) => c.id)).toContain("auto1");
    expect(state.events.map((e) => e.id)).toContain("p1");
  });

  it("stores the event even when the service did not link a calendar", async () => {
    (calendarService.createCalendarEvent as any).mockResolvedValue({
      event: evt({ id: "d2", kind: 31923, user: "pub" }),
      calendar: undefined,
    });
    await useCalendarStore.getState().createEvent({
      title: "Townhall",
      description: "",
      begin: new Date(0),
      end: new Date(0),
      isPrivate: false,
    } as any);
    expect(useCalendarStore.getState().events.map((e) => e.id)).toContain("d2");
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

describe("public busy list (kind 31926) wiring", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("createEvent publishes a busy range for a non-recurring event", async () => {
    (calendarService.createCalendarEvent as any).mockResolvedValue({
      event: evt({ id: "d9", begin: 1000, end: 2000 }),
    });
    await useCalendarStore.getState().createEvent({
      title: "X",
      description: "",
      begin: new Date(1000),
      end: new Date(2000),
    } as any);
    await flush();
    expect(addBusyRange).toHaveBeenCalledWith({ start: 1000, end: 2000 });
  });

  it("createEvent skips the busy range for recurring events (raw ranges only)", async () => {
    (calendarService.createCalendarEvent as any).mockResolvedValue({
      event: evt({ id: "d9", begin: 1000, end: 2000, repeat: { rrule: "FREQ=DAILY" } }),
    });
    await useCalendarStore.getState().createEvent({
      title: "X",
      description: "",
      begin: new Date(1000),
      end: new Date(2000),
      rrule: "FREQ=DAILY",
    } as any);
    await flush();
    expect(addBusyRange).not.toHaveBeenCalled();
  });

  it("updateEvent swaps the old busy range for the new one when times change", async () => {
    useCalendarStore.setState({ events: [evt({ id: "x", begin: 1000, end: 2000 })] });
    (calendarService.publishPublicCalendarEvent as any).mockResolvedValue(
      evt({ id: "x", begin: 3000, end: 4000 }),
    );
    await useCalendarStore.getState().updateEvent({
      title: "X",
      description: "",
      begin: new Date(3000),
      end: new Date(4000),
      existingId: "x",
    });
    await flush();
    expect(removeBusyRange).toHaveBeenCalledWith({ start: 1000, end: 2000 });
    expect(addBusyRange).toHaveBeenCalledWith({ start: 3000, end: 4000 });
  });

  it("updateEvent leaves the busy lists alone when times are unchanged", async () => {
    useCalendarStore.setState({ events: [evt({ id: "x", begin: 1000, end: 2000 })] });
    (calendarService.publishPublicCalendarEvent as any).mockResolvedValue(
      evt({ id: "x", begin: 1000, end: 2000, title: "Renamed" }),
    );
    await useCalendarStore.getState().updateEvent({
      title: "Renamed",
      description: "",
      begin: new Date(1000),
      end: new Date(2000),
      existingId: "x",
    });
    await flush();
    expect(removeBusyRange).not.toHaveBeenCalled();
    expect(addBusyRange).not.toHaveBeenCalled();
  });

  it("deleteEvent removes the deleted event's busy range", async () => {
    useCalendarStore.setState({ events: [evt({ id: "d1", begin: 1000, end: 2000 })] });
    await useCalendarStore.getState().deleteEvent("d1", "31923:pub:d1");
    await flush();
    expect(removeBusyRange).toHaveBeenCalledWith({ start: 1000, end: 2000 });
  });

  it("createEvent publishes nothing when the user opted out of busy publishing", async () => {
    const { useSettingsStore } = await import("./settingsStore");
    useSettingsStore.setState({ publishBusyTimes: false });
    try {
      (calendarService.createCalendarEvent as any).mockResolvedValue({
        event: evt({ id: "d9", begin: 1000, end: 2000 }),
      });
      await useCalendarStore.getState().createEvent({
        title: "X",
        description: "",
        begin: new Date(1000),
        end: new Date(2000),
      } as any);
      await flush();
      expect(addBusyRange).not.toHaveBeenCalled();
    } finally {
      useSettingsStore.setState({ publishBusyTimes: true });
    }
  });

  it("deleteEvent still retracts the busy range when opted out (cleanup of past publishes)", async () => {
    const { useSettingsStore } = await import("./settingsStore");
    useSettingsStore.setState({ publishBusyTimes: false });
    try {
      useCalendarStore.setState({ events: [evt({ id: "d1", begin: 1000, end: 2000 })] });
      await useCalendarStore.getState().deleteEvent("d1", "31923:pub:d1");
      await flush();
      expect(removeBusyRange).toHaveBeenCalledWith({ start: 1000, end: 2000 });
    } finally {
      useSettingsStore.setState({ publishBusyTimes: true });
    }
  });
});
