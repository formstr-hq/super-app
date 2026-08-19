import { fetchEventsForUser } from "@formstr/agent/services/calendar/discovery";
import { describe, it, expect, vi, beforeEach } from "vitest";

const sdk = vi.hoisted(() => ({
  fetchCalendars: vi.fn(),
  createCalendar: vi.fn(),
  updateCalendar: vi.fn(),
  deleteCalendar: vi.fn(),
  unlinkEventFromCalendar: vi.fn(),
  publishPrivateEvent: vi.fn(),
  updatePrivateEvent: vi.fn(),
  publishPublicEvent: vi.fn(),
  linkEventToCalendar: vi.fn(),
  deleteEvent: vi.fn(),
  addBusyRange: vi.fn().mockResolvedValue([]),
  removeBusyRange: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/calendar/sdk", () => ({ getCalendarSdk: vi.fn(async () => sdk) }));
vi.mock("@formstr/agent/services/calendar/discovery", () => ({
  fetchEventsForUser: vi.fn(async () => []),
}));

function evt(over: Partial<any> = {}) {
  return {
    id: "d1",
    eventId: "e1",
    title: "E",
    description: "",
    kind: 31923,
    begin: 0,
    end: 0,
    allDay: false,
    createdAt: 0,
    categories: [],
    participants: [],
    location: [],
    references: [],
    geohashes: [],
    user: "pub",
    isPrivate: false,
    repeat: { rrule: null },
    ...over,
  };
}

const addBusyRange = sdk.addBusyRange;
const removeBusyRange = sdk.removeBusyRange;

import { useCalendarStore } from "./calendarStore";

beforeEach(() => {
  vi.clearAllMocks();
  sdk.addBusyRange.mockResolvedValue([]);
  sdk.removeBusyRange.mockResolvedValue([]);
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
  it("removes the event by id and deletes it by coordinate", async () => {
    useCalendarStore.setState({ events: [evt({ id: "d1" }), evt({ id: "d2", eventId: "e2" })] });
    await useCalendarStore.getState().deleteEvent("d1", "31923:pub:d1");
    expect(sdk.deleteEvent).toHaveBeenCalledWith(
      expect.objectContaining({ coordinate: "31923:pub:d1", kind: 31923, eventId: "e1" }),
    );
    const ids = useCalendarStore.getState().events.map((e) => e.id);
    expect(ids).toEqual(["d2"]);
  });
});

describe("createCalendar", () => {
  it("forwards title, color and description to the service", async () => {
    sdk.createCalendar.mockResolvedValue({ id: "c1", title: "Work" });
    await useCalendarStore.getState().createCalendar("Work", "#4285f4", "desc");
    expect(sdk.createCalendar).toHaveBeenCalledWith({
      title: "Work",
      color: "#4285f4",
      description: "desc",
    });
  });
});

describe("updateCalendar", () => {
  it("forwards the calendar to the SDK and replaces it in state", async () => {
    const cal = { id: "c1", title: "Old", color: "#fff", eventRefs: [] };
    useCalendarStore.setState({ calendars: [cal as any] });
    sdk.updateCalendar.mockResolvedValue({ ...cal, title: "New" });
    await useCalendarStore.getState().updateCalendar({ ...cal, title: "New" } as any);
    expect(sdk.updateCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1", title: "New" }),
    );
    expect(useCalendarStore.getState().calendars[0].title).toBe("New");
  });
});

describe("deleteCalendar", () => {
  it("deletes the list object and removes it from state", async () => {
    // The SDK deletes a CalendarList, not a coordinate — it needs the event id
    // and d-tag the list was parsed from.
    useCalendarStore.setState({ calendars: [{ id: "c1" } as any, { id: "c2" } as any] });
    await useCalendarStore.getState().deleteCalendar({ id: "c1" } as any);
    expect(sdk.deleteCalendar).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
    expect(useCalendarStore.getState().calendars.map((c) => c.id)).toEqual(["c2"]);
  });
});

describe("createEvent", () => {
  it("publishes into the chosen calendar and passes the loaded lists through", async () => {
    const cal = { id: "c1", title: "Work", eventRefs: [] };
    useCalendarStore.setState({ calendars: [cal as any] });
    sdk.publishPrivateEvent.mockResolvedValue({
      event: evt({ id: "d9", kind: 32678, user: "pub", isPrivate: true }),
      eventRef: ["32678:pub:d9", "", "nsec1k"],
      viewKey: "nsec1k",
      invitations: [],
    });
    await useCalendarStore.getState().createEvent({
      title: "X",
      description: "",
      begin: 0,
      end: 0,
      calendarId: "c1",
      isPrivate: true,
    } as any);
    // The target calendar is a publish option now, and the already-loaded lists
    // are handed over so the SDK does not refetch them.
    expect(sdk.publishPrivateEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: "X" }),
      expect.objectContaining({ calendarId: "c1", calendars: [cal] }),
    );
    const state = useCalendarStore.getState();
    expect(state.events.map((e) => e.id)).toContain("d9");
    expect(state.events.find((e) => e.id === "d9")?.calendarId).toBe("c1");
    expect(sdk.createCalendar).not.toHaveBeenCalled();
  });

  it("mints a default calendar for a private event when the user has none", async () => {
    // A private event's viewKey only survives inside a list's eventRef, so it
    // must land in a calendar even when the user has never made one.
    useCalendarStore.setState({ calendars: [] });
    sdk.createCalendar.mockResolvedValue({ id: "auto1", title: "My Calendar", eventRefs: [] });
    sdk.publishPrivateEvent.mockResolvedValue({
      event: evt({ id: "p1", kind: 32678, user: "pub", isPrivate: true }),
      eventRef: ["32678:pub:p1", "", "nsec1xyz"],
      viewKey: "nsec1xyz",
      invitations: [],
    });
    await useCalendarStore.getState().createEvent({
      title: "Secret",
      description: "",
      begin: 0,
      end: 0,
      isPrivate: true,
    } as any);
    const state = useCalendarStore.getState();
    expect(state.calendars.map((c) => c.id)).toContain("auto1");
    expect(state.events.map((e) => e.id)).toContain("p1");
  });

  it("links a public event into the chosen calendar", async () => {
    const cal = { id: "c1", title: "Work", eventRefs: [] };
    useCalendarStore.setState({ calendars: [cal as any] });
    sdk.publishPublicEvent.mockResolvedValue({
      event: evt({ id: "d3", kind: 31923, user: "pub" }),
      relayHint: "wss://r.test",
    });
    sdk.linkEventToCalendar.mockResolvedValue({ ...cal, eventRefs: [["31923:pub:d3", "", ""]] });
    await useCalendarStore.getState().createEvent({
      title: "Townhall",
      description: "",
      begin: 0,
      end: 0,
      calendarId: "c1",
      isPrivate: false,
    } as any);
    // A public event has no view key, but the ref is what groups it under the
    // calendar the user picked — for this client and for every other one.
    expect(sdk.linkEventToCalendar).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), [
      "31923:pub:d3",
      "wss://r.test",
      "",
    ]);
    const state = useCalendarStore.getState();
    expect(state.events.find((e) => e.id === "d3")?.calendarId).toBe("c1");
    expect(state.calendars.find((c) => c.id === "c1")?.eventRefs).toHaveLength(1);
  });

  it("keeps a public event when linking it to its calendar fails", async () => {
    useCalendarStore.setState({ calendars: [{ id: "c1", title: "Work", eventRefs: [] } as any] });
    sdk.publishPublicEvent.mockResolvedValue({
      event: evt({ id: "d4", kind: 31923, user: "pub" }),
      relayHint: "",
    });
    sdk.linkEventToCalendar.mockRejectedValue(new Error("relay down"));
    await useCalendarStore.getState().createEvent({
      title: "Townhall",
      description: "",
      begin: 0,
      end: 0,
      calendarId: "c1",
      isPrivate: false,
    } as any);
    expect(useCalendarStore.getState().events.map((e) => e.id)).toContain("d4");
  });

  it("stores a public event without touching any calendar list", async () => {
    sdk.publishPublicEvent.mockResolvedValue({
      event: evt({ id: "d2", kind: 31923, user: "pub" }),
      relayHint: "wss://r.test",
    });
    await useCalendarStore.getState().createEvent({
      title: "Townhall",
      description: "",
      begin: 0,
      end: 0,
      isPrivate: false,
    } as any);
    expect(useCalendarStore.getState().events.map((e) => e.id)).toContain("d2");
    expect(sdk.publishPrivateEvent).not.toHaveBeenCalled();
    expect(sdk.createCalendar).not.toHaveBeenCalled();
  });
});

describe("updateEvent", () => {
  it("re-publishes under the same id and replaces the event in place", async () => {
    useCalendarStore.setState({ events: [evt({ id: "x", title: "Old" })] });
    sdk.publishPublicEvent.mockResolvedValue({
      event: evt({ id: "x", title: "New" }),
      relayHint: "wss://r.test",
    });
    await useCalendarStore.getState().updateEvent({
      title: "New",
      description: "",
      begin: 0,
      end: 0,
      id: "x",
    });
    expect(sdk.publishPublicEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "x" }),
      expect.anything(),
    );
    const events = useCalendarStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("New");
  });
});

describe("fetchEvents", () => {
  it("passes the loaded calendars to discovery so private refs decrypt", async () => {
    const calendars = [{ id: "c1", eventRefs: [] }];
    useCalendarStore.setState({ calendars: calendars as any });
    await useCalendarStore.getState().fetchEvents({ authors: ["me"] });
    expect(fetchEventsForUser).toHaveBeenCalledWith(
      expect.objectContaining({ calendars, authors: ["me"] }),
    );
  });
});

describe("updateEvent — calendar membership", () => {
  it("keeps a public event's calendar after an edit", async () => {
    useCalendarStore.setState({
      events: [evt({ id: "x", title: "Old", calendarId: "c1" }) as any],
    });
    sdk.publishPublicEvent.mockResolvedValue({
      event: evt({ id: "x", title: "New" }),
      relayHint: "wss://r.test",
    });
    await useCalendarStore.getState().updateEvent({
      id: "x",
      title: "New",
      description: "",
      begin: 0,
      end: 0,
      isPrivate: false,
    } as any);
    expect(useCalendarStore.getState().events.find((e) => e.id === "x")?.calendarId).toBe("c1");
  });
});

describe("updateEvent — invitation hygiene", () => {
  it("passes the event's current participants so nobody is re-invited", async () => {
    // `updatePrivateEvent` gift-wraps a fresh invitation for every participant
    // missing from `previousParticipants`; omitting it re-invites the whole
    // guest list on every edit.
    const existing = evt({ id: "d1", kind: 32678, isPrivate: true, participants: ["bob"] });
    useCalendarStore.setState({ events: [existing] });
    sdk.updatePrivateEvent.mockResolvedValue({
      event: existing,
      eventRef: ["32678:pub:d1", "", "nsec1k"],
      viewKey: "nsec1k",
      invitations: [],
    });

    await useCalendarStore.getState().updateEvent({ id: "d1", title: "R", begin: 0, end: 0 });

    expect(sdk.updatePrivateEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "d1" }),
      expect.objectContaining({ previousParticipants: ["bob"] }),
    );
  });
});

describe("public busy list (kind 31926) wiring", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("createEvent publishes a busy range for a non-recurring event", async () => {
    sdk.publishPrivateEvent.mockResolvedValue({
      event: evt({ id: "d9", begin: 1000, end: 2000 }),
      eventRef: ["31923:pub:d9", "", ""],
      viewKey: "nsec1k",
      invitations: [],
    });
    sdk.createCalendar.mockResolvedValue({ id: "auto", title: "My Calendar", eventRefs: [] });
    await useCalendarStore.getState().createEvent({
      title: "X",
      description: "",
      begin: 1000,
      end: 2000,
    } as any);
    await flush();
    expect(addBusyRange).toHaveBeenCalledWith({ start: 1000, end: 2000 });
  });

  it("createEvent skips the busy range for recurring events (raw ranges only)", async () => {
    sdk.publishPrivateEvent.mockResolvedValue({
      event: evt({ id: "d9", begin: 1000, end: 2000, repeat: { rrule: "FREQ=DAILY" } }),
      eventRef: ["31923:pub:d9", "", ""],
      viewKey: "nsec1k",
      invitations: [],
    });
    sdk.createCalendar.mockResolvedValue({ id: "auto", title: "My Calendar", eventRefs: [] });
    await useCalendarStore.getState().createEvent({
      title: "X",
      description: "",
      begin: 1000,
      end: 2000,
      rrule: "FREQ=DAILY",
    } as any);
    await flush();
    expect(addBusyRange).not.toHaveBeenCalled();
  });

  it("updateEvent swaps the old busy range for the new one when times change", async () => {
    useCalendarStore.setState({ events: [evt({ id: "x", begin: 1000, end: 2000 })] });
    sdk.publishPublicEvent.mockResolvedValue({
      event: evt({ id: "x", begin: 3000, end: 4000 }),
      relayHint: "wss://r.test",
    });
    await useCalendarStore.getState().updateEvent({
      title: "X",
      description: "",
      begin: 3000,
      end: 4000,
      id: "x",
    });
    await flush();
    expect(removeBusyRange).toHaveBeenCalledWith({ start: 1000, end: 2000 });
    expect(addBusyRange).toHaveBeenCalledWith({ start: 3000, end: 4000 });
  });

  it("updateEvent leaves the busy lists alone when times are unchanged", async () => {
    useCalendarStore.setState({ events: [evt({ id: "x", begin: 1000, end: 2000 })] });
    sdk.publishPublicEvent.mockResolvedValue({
      event: evt({ id: "x", begin: 1000, end: 2000, title: "Renamed" }),
      relayHint: "wss://r.test",
    });
    await useCalendarStore.getState().updateEvent({
      title: "Renamed",
      description: "",
      begin: 1000,
      end: 2000,
      id: "x",
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
      sdk.publishPrivateEvent.mockResolvedValue({
        event: evt({ id: "d9", begin: 1000, end: 2000 }),
        eventRef: ["31923:pub:d9", "", ""],
        viewKey: "nsec1k",
        invitations: [],
      });
      sdk.createCalendar.mockResolvedValue({ id: "auto", title: "My Calendar", eventRefs: [] });
      await useCalendarStore.getState().createEvent({
        title: "X",
        description: "",
        begin: 1000,
        end: 2000,
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
