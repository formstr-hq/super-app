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

describe("public busy list (kind 31926) wiring", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("createEvent publishes a busy range for a non-recurring event", async () => {
    (calendarService.publishPublicCalendarEvent as any).mockResolvedValue(
      evt({ id: "d9", begin: 1000, end: 2000 }),
    );
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
    (calendarService.publishPublicCalendarEvent as any).mockResolvedValue(
      evt({ id: "d9", begin: 1000, end: 2000, repeat: { rrule: "FREQ=DAILY" } }),
    );
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
      (calendarService.publishPublicCalendarEvent as any).mockResolvedValue(
        evt({ id: "d9", begin: 1000, end: 2000 }),
      );
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
