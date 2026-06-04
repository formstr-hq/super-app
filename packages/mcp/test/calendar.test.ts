import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/app/services", () => ({
  calendar: {
    fetchCalendarEventsSync: vi.fn(),
    fetchCalendarEventByCoordinate: vi.fn(),
    publishPublicCalendarEvent: vi.fn(),
    publishPrivateCalendarEvent: vi.fn(),
    deleteCalendarEvent: vi.fn(),
    fetchCalendarLists: vi.fn(),
    createCalendarList: vi.fn(),
    updateCalendarList: vi.fn(),
    deleteCalendarList: vi.fn(),
    addEventToCalendarList: vi.fn(),
    removeEventFromCalendarList: vi.fn(),
    fetchInvitationsSync: vi.fn(),
  },
  calendarRsvp: {
    rsvpToEvent: vi.fn(),
    fetchRsvpsForEvent: vi.fn(),
  },
}));

import { calendar, calendarRsvp } from "@formstr/app/services";

import { registerCalendar } from "../src/tools/calendar";

function fakeServer() {
  const tools = new Map<string, { handler: (a: any) => Promise<any> }>();
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (a: any) => Promise<any>) =>
      tools.set(name, { handler }),
  } as any;
  return { server, tools };
}

describe("calendar tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gates delete/rsvp behind allowWrites", () => {
    const ro = fakeServer();
    registerCalendar(ro.server, { allowWrites: false });
    expect(ro.tools.has("list_calendar_events")).toBe(true);
    expect(ro.tools.has("create_calendar_event")).toBe(true);
    expect(ro.tools.has("delete_calendar_event")).toBe(false);
    expect(ro.tools.has("rsvp_event")).toBe(false);

    const rw = fakeServer();
    registerCalendar(rw.server, { allowWrites: true });
    expect(rw.tools.has("delete_calendar_event")).toBe(true);
    expect(rw.tools.has("rsvp_event")).toBe(true);
  });

  it("rsvp_event requires confirm then calls rsvpToEvent with 3 args", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    const blocked = await tools
      .get("rsvp_event")!
      .handler({ eventCoordinate: "31923:pk:d", status: "accepted" });
    expect(blocked.isError).toBe(true);
    expect(calendarRsvp.rsvpToEvent).not.toHaveBeenCalled();

    const okRes = await tools
      .get("rsvp_event")!
      .handler({ eventCoordinate: "31923:pk:d", status: "accepted", confirm: true });
    expect(calendarRsvp.rsvpToEvent).toHaveBeenCalledWith("31923:pk:d", "accepted", false);
    expect(okRes.isError).toBeFalsy();
  });

  it("create_calendar_event publishes a public event with a coordinate", async () => {
    (calendar.publishPublicCalendarEvent as any).mockResolvedValue({
      id: "d1",
      eventId: "ev1",
      kind: 31923,
      user: "pk",
    });
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    const res = await tools
      .get("create_calendar_event")!
      .handler({ title: "Standup", start: "2026-06-10T10:00:00Z" });
    expect(calendar.publishPublicCalendarEvent).toHaveBeenCalledOnce();
    expect(res.structuredContent.coordinate).toBe("31923:pk:d1");
  });

  it("create_calendar_event routes to private publish when isPrivate", async () => {
    (calendar.publishPrivateCalendarEvent as any).mockResolvedValue({
      id: "d9",
      eventId: "ev9",
      kind: 32678,
      user: "pk",
    });
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    await tools.get("create_calendar_event")!.handler({
      title: "Secret",
      start: "2026-06-10T10:00:00Z",
      isPrivate: true,
      participants: ["pubA"],
    });
    expect(calendar.publishPrivateCalendarEvent).toHaveBeenCalledOnce();
  });

  it("get_calendar_event returns the event or NOT_FOUND", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    (calendar.fetchCalendarEventByCoordinate as any).mockResolvedValueOnce(null);
    const miss = await tools.get("get_calendar_event")!.handler({ coordinate: "31923:p:d" });
    expect(miss.isError).toBe(true);
    (calendar.fetchCalendarEventByCoordinate as any).mockResolvedValueOnce({
      id: "d",
      title: "Found",
      kind: 31923,
      user: "p",
    });
    const hit = await tools.get("get_calendar_event")!.handler({ coordinate: "31923:p:d" });
    expect(hit.isError).toBeFalsy();
  });

  it("list_calendars and create_calendar are available without writes", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    (calendar.fetchCalendarLists as any).mockResolvedValue([
      { id: "c1", title: "Work", color: "#fff" },
    ]);
    const list = await tools.get("list_calendars")!.handler({});
    expect(list.structuredContent.calendars).toHaveLength(1);

    (calendar.createCalendarList as any).mockResolvedValue({ id: "c2" });
    const created = await tools.get("create_calendar")!.handler({ title: "Personal" });
    expect(calendar.createCalendarList).toHaveBeenCalledWith("Personal", "#334155", "");
    expect(created.isError).toBeFalsy();
  });

  it("fetch_event_rsvps returns public RSVPs", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    (calendarRsvp.fetchRsvpsForEvent as any).mockResolvedValue([
      { pubkey: "p1", status: "accepted" },
    ]);
    const res = await tools.get("fetch_event_rsvps")!.handler({ coordinate: "31923:p:d" });
    expect(res.structuredContent.rsvps).toEqual([{ pubkey: "p1", status: "accepted" }]);
  });

  it("list_invitations summarizes received invitations", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    (calendar.fetchInvitationsSync as any).mockResolvedValue([
      {
        wrapId: "w1",
        eventCoordinate: "32678:a:d",
        authorPubkey: "a",
        kind: 32678,
        receivedAt: 0,
        event: { title: "P", begin: 123 },
      },
    ]);
    const res = await tools.get("list_invitations")!.handler({});
    expect(res.structuredContent.invitations[0]).toMatchObject({
      coordinate: "32678:a:d",
      title: "P",
    });
  });

  it("update_calendar_event is gated and requires confirm, then republishes", async () => {
    const ro = fakeServer();
    registerCalendar(ro.server, { allowWrites: false });
    expect(ro.tools.has("update_calendar_event")).toBe(false);
    expect(ro.tools.has("attach_form_to_event")).toBe(false);

    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    (calendar.fetchCalendarEventByCoordinate as any).mockResolvedValue({
      id: "d",
      title: "Old",
      description: "",
      begin: 1700000000000,
      end: 1700003600000,
      kind: 31923,
      user: "pk",
      location: [],
      participants: [],
      isPrivate: false,
      repeat: { rrule: null },
    });
    (calendar.publishPublicCalendarEvent as any).mockResolvedValue({
      id: "d",
      eventId: "ev",
      kind: 31923,
      user: "pk",
      title: "New",
    });

    const blocked = await tools
      .get("update_calendar_event")!
      .handler({ coordinate: "31923:pk:d", title: "New" });
    expect(blocked.isError).toBe(true);
    const okRes = await tools
      .get("update_calendar_event")!
      .handler({ coordinate: "31923:pk:d", title: "New", confirm: true });
    expect(calendar.publishPublicCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ existingId: "d", title: "New" }),
    );
    expect(okRes.isError).toBeFalsy();
  });

  it("attach_form_to_event republishes with the form ref", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    (calendar.fetchCalendarEventByCoordinate as any).mockResolvedValue({
      id: "d",
      title: "T",
      description: "",
      begin: 1,
      end: 2,
      kind: 31923,
      user: "pk",
      location: [],
      participants: [],
      isPrivate: false,
      repeat: { rrule: null },
    });
    (calendar.publishPublicCalendarEvent as any).mockResolvedValue({
      id: "d",
      eventId: "ev",
      kind: 31923,
      user: "pk",
      title: "T",
    });
    await tools
      .get("attach_form_to_event")!
      .handler({ coordinate: "31923:pk:d", formRef: "naddr1abc", confirm: true });
    expect(calendar.publishPublicCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ registrationFormRef: "naddr1abc", existingId: "d" }),
    );
  });

  // ── Task 18: update_calendar / delete_calendar ─────────────

  it("update_calendar and delete_calendar are gated behind allowWrites", () => {
    const ro = fakeServer();
    registerCalendar(ro.server, { allowWrites: false });
    expect(ro.tools.has("update_calendar")).toBe(false);
    expect(ro.tools.has("delete_calendar")).toBe(false);

    const rw = fakeServer();
    registerCalendar(rw.server, { allowWrites: true });
    expect(rw.tools.has("update_calendar")).toBe(true);
    expect(rw.tools.has("delete_calendar")).toBe(true);
  });

  it("update_calendar requires confirm then merges and republishes the list", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    (calendar.fetchCalendarLists as any).mockResolvedValue([
      {
        id: "c1",
        eventId: "e1",
        title: "Old",
        description: "d",
        color: "#000",
        eventRefs: [["31923:pk:x", "", ""]],
        createdAt: 0,
        isVisible: true,
      },
    ]);
    (calendar.updateCalendarList as any).mockResolvedValue({ id: "c1", title: "New" });

    const blocked = await tools.get("update_calendar")!.handler({ id: "c1", title: "New" });
    expect(blocked.isError).toBe(true);
    expect(calendar.updateCalendarList).not.toHaveBeenCalled();

    const okRes = await tools
      .get("update_calendar")!
      .handler({ id: "c1", title: "New", color: "#fff", confirm: true });
    expect(calendar.updateCalendarList).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "c1",
        title: "New",
        color: "#fff",
        description: "d",
        eventRefs: [["31923:pk:x", "", ""]],
      }),
    );
    expect(okRes.isError).toBeFalsy();
  });

  it("update_calendar returns NOT_FOUND when the list is missing", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    (calendar.fetchCalendarLists as any).mockResolvedValue([]);
    const res = await tools
      .get("update_calendar")!
      .handler({ id: "zzz", title: "x", confirm: true });
    expect(res.isError).toBe(true);
    expect(calendar.updateCalendarList).not.toHaveBeenCalled();
  });

  it("delete_calendar requires confirm then calls deleteCalendarList", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });

    const blocked = await tools.get("delete_calendar")!.handler({ coordinate: "32123:pk:c1" });
    expect(blocked.isError).toBe(true);
    expect(calendar.deleteCalendarList).not.toHaveBeenCalled();

    const okRes = await tools
      .get("delete_calendar")!
      .handler({ coordinate: "32123:pk:c1", confirm: true });
    expect(calendar.deleteCalendarList).toHaveBeenCalledWith("32123:pk:c1");
    expect(okRes.isError).toBeFalsy();
  });

  // ── Task 19: add/remove event ↔ calendar membership ────────

  it("add/remove event to calendar are gated behind allowWrites", () => {
    const ro = fakeServer();
    registerCalendar(ro.server, { allowWrites: false });
    expect(ro.tools.has("add_event_to_calendar")).toBe(false);
    expect(ro.tools.has("remove_event_from_calendar")).toBe(false);

    const rw = fakeServer();
    registerCalendar(rw.server, { allowWrites: true });
    expect(rw.tools.has("add_event_to_calendar")).toBe(true);
    expect(rw.tools.has("remove_event_from_calendar")).toBe(true);
  });

  it("add_event_to_calendar resolves the list and calls addEventToCalendarList", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    (calendar.fetchCalendarLists as any).mockResolvedValue([{ id: "c1", eventRefs: [] }]);
    (calendar.addEventToCalendarList as any).mockResolvedValue({
      id: "c1",
      eventRefs: [["31923:pk:d", "wss://r", "nsec1view"]],
    });

    const blocked = await tools
      .get("add_event_to_calendar")!
      .handler({ calendarId: "c1", coordinate: "31923:pk:d" });
    expect(blocked.isError).toBe(true);
    expect(calendar.addEventToCalendarList).not.toHaveBeenCalled();

    const okRes = await tools.get("add_event_to_calendar")!.handler({
      calendarId: "c1",
      coordinate: "31923:pk:d",
      relayHint: "wss://r",
      viewKey: "nsec1view",
      confirm: true,
    });
    expect(calendar.addEventToCalendarList).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1" }),
      ["31923:pk:d", "wss://r", "nsec1view"],
    );
    expect(okRes.isError).toBeFalsy();
  });

  it("add_event_to_calendar returns NOT_FOUND when the calendar is missing", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    (calendar.fetchCalendarLists as any).mockResolvedValue([]);
    const res = await tools
      .get("add_event_to_calendar")!
      .handler({ calendarId: "nope", coordinate: "31923:pk:d", confirm: true });
    expect(res.isError).toBe(true);
    expect(calendar.addEventToCalendarList).not.toHaveBeenCalled();
  });

  it("remove_event_from_calendar resolves the list and calls removeEventFromCalendarList", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    (calendar.fetchCalendarLists as any).mockResolvedValue([
      { id: "c1", eventRefs: [["31923:pk:d", "", ""]] },
    ]);
    (calendar.removeEventFromCalendarList as any).mockResolvedValue({ id: "c1", eventRefs: [] });

    const okRes = await tools
      .get("remove_event_from_calendar")!
      .handler({ calendarId: "c1", coordinate: "31923:pk:d", confirm: true });
    expect(calendar.removeEventFromCalendarList).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1" }),
      "31923:pk:d",
    );
    expect(okRes.isError).toBeFalsy();
  });

  // ── Task 20: RSVP suggested-time + note ────────────────────

  it("rsvp_event forwards suggested times and comment as the 4th arg", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    await tools.get("rsvp_event")!.handler({
      eventCoordinate: "31923:pk:d",
      status: "tentative",
      suggestedStart: 1000,
      suggestedEnd: 2000,
      comment: "running late",
      confirm: true,
    });
    expect(calendarRsvp.rsvpToEvent).toHaveBeenCalledWith("31923:pk:d", "tentative", false, {
      suggestedStart: 1000,
      suggestedEnd: 2000,
      comment: "running late",
    });
  });

  it("fetch_event_rsvps includes suggested times and comment", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    (calendarRsvp.fetchRsvpsForEvent as any).mockResolvedValue([
      {
        pubkey: "p1",
        status: "tentative",
        suggestedStart: 1000,
        suggestedEnd: 2000,
        comment: "can we push?",
      },
    ]);
    const res = await tools.get("fetch_event_rsvps")!.handler({ coordinate: "31923:p:d" });
    expect(res.structuredContent.rsvps[0]).toMatchObject({
      pubkey: "p1",
      status: "tentative",
      suggestedStart: 1000,
      suggestedEnd: 2000,
      comment: "can we push?",
    });
  });
});
