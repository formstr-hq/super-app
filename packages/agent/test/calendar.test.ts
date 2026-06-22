import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services", () => ({
  calendar: {
    fetchCalendarEventsSync: vi.fn(),
    fetchCalendarEventByCoordinate: vi.fn(),
    publishPublicCalendarEvent: vi.fn(),
    publishPrivateCalendarEvent: vi.fn(),
    createCalendarEvent: vi.fn(),
    deleteCalendarEvent: vi.fn(),
    fetchCalendarLists: vi.fn(),
    createCalendarList: vi.fn(),
    updateCalendarList: vi.fn(),
    deleteCalendarList: vi.fn(),
    addEventToCalendarList: vi.fn(),
    removeEventFromCalendarList: vi.fn(),
    fetchInvitationsSync: vi.fn(),
    lookupEventViewKey: vi.fn(),
  },
  calendarRsvp: {
    rsvpToEvent: vi.fn(),
    fetchRsvpsForEvent: vi.fn(),
  },
  calendarBooking: {
    fetchSchedulingPages: vi.fn(),
    fetchBookingRequests: vi.fn(),
    bookingLinkUrl: vi.fn(() => "https://calendar.formstr.app/schedule/naddr1xxx"),
    approveBookingRequest: vi.fn(),
    declineBookingRequest: vi.fn(),
  },
}));

import { calendar, calendarBooking, calendarRsvp } from "../src/services";
import { calendarTools } from "../src/tools/calendar";
import type { ToolCtx } from "../src/tools/types";

type FakeTools = Map<string, { handler: (a: any) => Promise<any> }>;

function fakeServer(): { server: { tools: FakeTools }; tools: FakeTools } {
  const tools: FakeTools = new Map();
  return { server: { tools }, tools };
}

// Replicates the stdio adapter's gating: skip `write` tools unless allowWrites,
// and inject the ctx so the existing single-arg handler call sites still work.
function registerCalendar(server: { tools: FakeTools }, ctx: ToolCtx) {
  for (const t of calendarTools) {
    if (t.write && !ctx.allowWrites) continue;
    server.tools.set(t.name, { handler: (a: any) => t.handler(a, ctx) });
  }
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

  it("rsvp_event requires confirm then calls rsvpToEvent", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    const blocked = await tools
      .get("rsvp_event")!
      .handler({ eventCoordinate: "31923:pk:d", status: "accepted" });
    expect(blocked.ok).toBe(false);
    expect(calendarRsvp.rsvpToEvent).not.toHaveBeenCalled();

    const okRes = await tools
      .get("rsvp_event")!
      .handler({ eventCoordinate: "31923:pk:d", status: "accepted", confirm: true });
    expect(calendarRsvp.rsvpToEvent).toHaveBeenCalledWith(
      "31923:pk:d",
      "accepted",
      false,
      undefined,
      undefined,
    );
    expect(okRes.ok).toBeTruthy();
  });

  it("rsvp_event passes an explicit viewKey through to the service", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    await tools.get("rsvp_event")!.handler({
      eventCoordinate: "32678:pk:d",
      status: "accepted",
      isPrivate: true,
      viewKey: "nsec1explicit",
      confirm: true,
    });
    expect(calendar.lookupEventViewKey).not.toHaveBeenCalled();
    expect(calendarRsvp.rsvpToEvent).toHaveBeenCalledWith(
      "32678:pk:d",
      "accepted",
      true,
      undefined,
      "nsec1explicit",
    );
  });

  it("rsvp_event auto-discovers the viewKey from calendar lists for private events", async () => {
    // Without the viewKey a private RSVP falls back to the gift-wrap path,
    // which calendar.formstr.app never reads — the standalone-compatible
    // kind-32069 path needs the event's viewKey from the user's lists.
    (calendar.lookupEventViewKey as any).mockResolvedValue("nsec1fromlist");
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    await tools.get("rsvp_event")!.handler({
      eventCoordinate: "32678:pk:d",
      status: "declined",
      isPrivate: true,
      confirm: true,
    });
    expect(calendar.lookupEventViewKey).toHaveBeenCalledWith("32678:pk:d");
    expect(calendarRsvp.rsvpToEvent).toHaveBeenCalledWith(
      "32678:pk:d",
      "declined",
      true,
      undefined,
      "nsec1fromlist",
    );
  });

  it("create_calendar_event defaults to PRIVATE and auto-lists when no calendars exist", async () => {
    // No calendars yet → nothing to ask; the service auto-creates a default list.
    (calendar.fetchCalendarLists as any).mockResolvedValue([]);
    (calendar.createCalendarEvent as any).mockResolvedValue({
      event: { id: "d1", eventId: "ev1", kind: 32678, user: "pk" },
      calendar: { id: "auto", title: "My Calendar" },
    });
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    const res = await tools
      .get("create_calendar_event")!
      .handler({ title: "Standup", start: "2026-06-10T10:00:00Z" });
    // Defaulted to private (no isPrivate passed).
    expect((calendar.createCalendarEvent as any).mock.calls[0][0]).toMatchObject({
      isPrivate: true,
    });
    expect(res.ok).toBeTruthy();
    expect(res.data.coordinate).toBe("32678:pk:d1");
  });

  it("create_calendar_event ASKS which calendar when calendars exist and none was chosen", async () => {
    (calendar.fetchCalendarLists as any).mockResolvedValue([
      { id: "c1", title: "Work" },
      { id: "c2", title: "Personal" },
    ]);
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    const res = await tools
      .get("create_calendar_event")!
      .handler({ title: "Standup", start: "2026-06-10T10:00:00Z" });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("CALENDAR_REQUIRED");
    // Lists the choices so the agent can ask the user.
    expect(res.text).toContain("c1");
    expect(res.text).toContain("c2");
    expect(calendar.createCalendarEvent).not.toHaveBeenCalled();
  });

  it("create_calendar_event uses the chosen calendarId without asking", async () => {
    (calendar.fetchCalendarLists as any).mockResolvedValue([
      { id: "c1", title: "Work" },
      { id: "c2", title: "Personal" },
    ]);
    (calendar.createCalendarEvent as any).mockResolvedValue({
      event: { id: "d9", eventId: "ev9", kind: 32678, user: "pk" },
      calendar: { id: "c2", title: "Personal" },
    });
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    const res = await tools.get("create_calendar_event")!.handler({
      title: "Secret",
      start: "2026-06-10T10:00:00Z",
      calendarId: "c2",
      participants: ["pubA"],
    });
    expect((calendar.createCalendarEvent as any).mock.calls[0][0]).toMatchObject({
      calendarId: "c2",
      isPrivate: true,
    });
    expect(res.data.coordinate).toBe("32678:pk:d9");
  });

  it("create_calendar_event returns NOT_FOUND for an unknown calendarId", async () => {
    (calendar.fetchCalendarLists as any).mockResolvedValue([{ id: "c1", title: "Work" }]);
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    const res = await tools.get("create_calendar_event")!.handler({
      title: "X",
      start: "2026-06-10T10:00:00Z",
      calendarId: "nope",
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("NOT_FOUND");
    expect(calendar.createCalendarEvent).not.toHaveBeenCalled();
  });

  it("create_calendar_event allows an explicit public event without asking", async () => {
    (calendar.fetchCalendarLists as any).mockResolvedValue([{ id: "c1", title: "Work" }]);
    (calendar.createCalendarEvent as any).mockResolvedValue({
      event: { id: "d2", eventId: "ev2", kind: 31923, user: "pk" },
      calendar: undefined,
    });
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    const res = await tools
      .get("create_calendar_event")!
      .handler({ title: "Townhall", start: "2026-06-10T10:00:00Z", isPrivate: false });
    expect(res.ok).toBeTruthy();
    expect(res.data.coordinate).toBe("31923:pk:d2");
    expect((calendar.createCalendarEvent as any).mock.calls[0][0]).toMatchObject({
      isPrivate: false,
    });
  });

  it("get_calendar_event returns the event or NOT_FOUND", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    (calendar.fetchCalendarEventByCoordinate as any).mockResolvedValueOnce(null);
    const miss = await tools.get("get_calendar_event")!.handler({ coordinate: "31923:p:d" });
    expect(miss.ok).toBe(false);
    (calendar.fetchCalendarEventByCoordinate as any).mockResolvedValueOnce({
      id: "d",
      title: "Found",
      kind: 31923,
      user: "p",
    });
    const hit = await tools.get("get_calendar_event")!.handler({ coordinate: "31923:p:d" });
    expect(hit.ok).toBeTruthy();
  });

  it("get_calendar_event recovers a private event's viewKey so it decrypts", async () => {
    // Without the viewKey a private event comes back "Untitled" with no
    // times/participants — get must look it up like update/attach/rsvp do.
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    (calendar.lookupEventViewKey as any).mockResolvedValue("nsec1fromlist");
    (calendar.fetchCalendarEventByCoordinate as any).mockResolvedValue({
      id: "d",
      title: "Match",
      kind: 32678,
      user: "pk",
      begin: 1,
      end: 2,
      location: [],
      participants: [],
      isPrivate: true,
      repeat: { rrule: null },
    });
    const res = await tools.get("get_calendar_event")!.handler({ coordinate: "32678:pk:d" });
    expect(calendar.lookupEventViewKey).toHaveBeenCalledWith("32678:pk:d");
    expect(calendar.fetchCalendarEventByCoordinate).toHaveBeenCalledWith(
      "32678:pk:d",
      "nsec1fromlist",
    );
    expect(res.ok).toBeTruthy();
  });

  it("list_calendars and create_calendar are available without writes", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    (calendar.fetchCalendarLists as any).mockResolvedValue([
      { id: "c1", title: "Work", color: "#fff" },
    ]);
    const list = await tools.get("list_calendars")!.handler({});
    expect(list.data.calendars).toHaveLength(1);

    (calendar.createCalendarList as any).mockResolvedValue({ id: "c2" });
    const created = await tools.get("create_calendar")!.handler({ title: "Personal" });
    expect(calendar.createCalendarList).toHaveBeenCalledWith("Personal", "#334155", "");
    expect(created.ok).toBeTruthy();
  });

  it("fetch_event_rsvps returns public RSVPs", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    (calendarRsvp.fetchRsvpsForEvent as any).mockResolvedValue([
      { pubkey: "p1", status: "accepted" },
    ]);
    const res = await tools.get("fetch_event_rsvps")!.handler({ coordinate: "31923:p:d" });
    expect(res.data.rsvps).toEqual([{ pubkey: "p1", status: "accepted" }]);
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
    expect(res.data.invitations[0]).toMatchObject({
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
    expect(blocked.ok).toBe(false);
    const okRes = await tools
      .get("update_calendar_event")!
      .handler({ coordinate: "31923:pk:d", title: "New", confirm: true });
    expect(calendar.publishPublicCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ existingId: "d", title: "New" }),
    );
    expect(okRes.ok).toBeTruthy();
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

  it("update_calendar_event recovers a private event's viewKey and reuses it on republish", async () => {
    // Without the viewKey, fetchCalendarEventByCoordinate can't decrypt the
    // event (fields lost) and existing.viewKey is undefined → the republish
    // mints a NEW viewKey, orphaning the calendar-list ref's old one → the
    // event becomes un-decryptable (invalid MAC) on calendar.formstr.app.
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    (calendar.lookupEventViewKey as any).mockResolvedValue("nsec1fromlist");
    (calendar.fetchCalendarEventByCoordinate as any).mockResolvedValue({
      id: "d",
      title: "Match",
      description: "",
      begin: 1700000000000,
      end: 1700003600000,
      kind: 32678,
      user: "pk",
      location: [],
      participants: ["pubA"],
      isPrivate: true,
      calendarId: "c1",
      viewKey: "nsec1fromlist",
      repeat: { rrule: null },
    });
    (calendar.publishPrivateCalendarEvent as any).mockResolvedValue({
      id: "d",
      eventId: "ev",
      kind: 32678,
      user: "pk",
      title: "Match",
    });

    await tools
      .get("update_calendar_event")!
      .handler({ coordinate: "32678:pk:d", title: "Match", confirm: true });

    expect(calendar.lookupEventViewKey).toHaveBeenCalledWith("32678:pk:d");
    expect(calendar.fetchCalendarEventByCoordinate).toHaveBeenCalledWith(
      "32678:pk:d",
      "nsec1fromlist",
    );
    expect(calendar.publishPrivateCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ existingId: "d", viewKey: "nsec1fromlist" }),
      "c1",
    );
  });

  it("attach_form_to_event recovers a private event's viewKey and reuses it on republish", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    (calendar.lookupEventViewKey as any).mockResolvedValue("nsec1fromlist");
    (calendar.fetchCalendarEventByCoordinate as any).mockResolvedValue({
      id: "d",
      title: "Match",
      description: "",
      begin: 1,
      end: 2,
      kind: 32678,
      user: "pk",
      location: [],
      participants: [],
      isPrivate: true,
      calendarId: "c1",
      viewKey: "nsec1fromlist",
      repeat: { rrule: null },
    });
    (calendar.publishPrivateCalendarEvent as any).mockResolvedValue({
      id: "d",
      eventId: "ev",
      kind: 32678,
      user: "pk",
      title: "Match",
    });

    await tools
      .get("attach_form_to_event")!
      .handler({ coordinate: "32678:pk:d", formRef: "naddr1abc", confirm: true });

    expect(calendar.lookupEventViewKey).toHaveBeenCalledWith("32678:pk:d");
    expect(calendar.fetchCalendarEventByCoordinate).toHaveBeenCalledWith(
      "32678:pk:d",
      "nsec1fromlist",
    );
    expect(calendar.publishPrivateCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        existingId: "d",
        viewKey: "nsec1fromlist",
        registrationFormRef: "naddr1abc",
      }),
      "c1",
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
    expect(blocked.ok).toBe(false);
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
    expect(okRes.ok).toBeTruthy();
  });

  it("update_calendar returns NOT_FOUND when the list is missing", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    (calendar.fetchCalendarLists as any).mockResolvedValue([]);
    const res = await tools
      .get("update_calendar")!
      .handler({ id: "zzz", title: "x", confirm: true });
    expect(res.ok).toBe(false);
    expect(calendar.updateCalendarList).not.toHaveBeenCalled();
  });

  it("delete_calendar requires confirm then calls deleteCalendarList", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });

    const blocked = await tools.get("delete_calendar")!.handler({ coordinate: "32123:pk:c1" });
    expect(blocked.ok).toBe(false);
    expect(calendar.deleteCalendarList).not.toHaveBeenCalled();

    const okRes = await tools
      .get("delete_calendar")!
      .handler({ coordinate: "32123:pk:c1", confirm: true });
    expect(calendar.deleteCalendarList).toHaveBeenCalledWith("32123:pk:c1");
    expect(okRes.ok).toBeTruthy();
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
    expect(blocked.ok).toBe(false);
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
    expect(okRes.ok).toBeTruthy();
  });

  it("add_event_to_calendar returns NOT_FOUND when the calendar is missing", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    (calendar.fetchCalendarLists as any).mockResolvedValue([]);
    const res = await tools
      .get("add_event_to_calendar")!
      .handler({ calendarId: "nope", coordinate: "31923:pk:d", confirm: true });
    expect(res.ok).toBe(false);
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
    expect(okRes.ok).toBeTruthy();
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
    expect(calendarRsvp.rsvpToEvent).toHaveBeenCalledWith(
      "31923:pk:d",
      "tentative",
      false,
      { suggestedStart: 1000, suggestedEnd: 2000, comment: "running late" },
      undefined,
    );
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
    expect(res.data.rsvps[0]).toMatchObject({
      pubkey: "p1",
      status: "tentative",
      suggestedStart: 1000,
      suggestedEnd: 2000,
      comment: "can we push?",
    });
  });

  // ── Booking links: scheduling pages + approve/decline ──────

  it("booking read tools are available; approve/decline are gated behind allowWrites", () => {
    const ro = fakeServer();
    registerCalendar(ro.server, { allowWrites: false });
    expect(ro.tools.has("list_scheduling_pages")).toBe(true);
    expect(ro.tools.has("list_booking_requests")).toBe(true);
    expect(ro.tools.has("approve_booking")).toBe(false);
    expect(ro.tools.has("decline_booking")).toBe(false);

    const rw = fakeServer();
    registerCalendar(rw.server, { allowWrites: true });
    expect(rw.tools.has("approve_booking")).toBe(true);
    expect(rw.tools.has("decline_booking")).toBe(true);
  });

  it("list_scheduling_pages returns booking links with shareable urls", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    (calendarBooking.fetchSchedulingPages as any).mockResolvedValue([
      {
        id: "p1",
        title: "Intro call",
        description: "30m",
        user: "pk",
        viewKey: "nsec1",
        createdAt: 0,
      },
    ]);
    const res = await tools.get("list_scheduling_pages")!.handler({});
    expect(res.data.bookingLinks[0]).toMatchObject({
      id: "p1",
      title: "Intro call",
      url: "https://calendar.formstr.app/schedule/naddr1xxx",
    });
  });

  it("list_booking_requests summarizes incoming requests", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: false });
    (calendarBooking.fetchBookingRequests as any).mockResolvedValue([
      {
        id: "r1",
        title: "Coffee",
        note: "looking forward",
        start: 1000,
        end: 2000,
        bookerPubkey: "booker",
        schedulingPageRef: "31927:pk:p1",
      },
    ]);
    const res = await tools.get("list_booking_requests")!.handler({});
    expect(res.data.requests[0]).toMatchObject({
      id: "r1",
      title: "Coffee",
      booker: "booker",
    });
  });

  it("approve_booking requires confirm then approves into the chosen calendar", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    (calendarBooking.fetchBookingRequests as any).mockResolvedValue([
      {
        id: "r1",
        title: "Coffee",
        bookerPubkey: "booker",
        start: 1,
        end: 2,
        schedulingPageRef: "31927:pk:p1",
      },
    ]);
    (calendar.fetchCalendarLists as any).mockResolvedValue([
      { id: "c1", title: "Work", eventRefs: [] },
    ]);
    (calendarBooking.approveBookingRequest as any).mockResolvedValue({
      event: { id: "d1", kind: 32678, user: "pk" },
      calendar: { id: "c1" },
    });

    const blocked = await tools
      .get("approve_booking")!
      .handler({ requestId: "r1", calendarId: "c1" });
    expect(blocked.ok).toBe(false);
    expect(calendarBooking.approveBookingRequest).not.toHaveBeenCalled();

    const okRes = await tools
      .get("approve_booking")!
      .handler({ requestId: "r1", calendarId: "c1", confirm: true });
    expect(calendarBooking.approveBookingRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1" }),
      expect.objectContaining({ id: "c1" }),
    );
    expect(okRes.data.coordinate).toBe("32678:pk:d1");
  });

  it("approve_booking returns NOT_FOUND for an unknown request", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    (calendarBooking.fetchBookingRequests as any).mockResolvedValue([]);
    const res = await tools
      .get("approve_booking")!
      .handler({ requestId: "zzz", calendarId: "c1", confirm: true });
    expect(res.ok).toBe(false);
    expect(calendarBooking.approveBookingRequest).not.toHaveBeenCalled();
  });

  it("decline_booking requires confirm then declines", async () => {
    const { server, tools } = fakeServer();
    registerCalendar(server, { allowWrites: true });
    (calendarBooking.fetchBookingRequests as any).mockResolvedValue([
      {
        id: "r1",
        title: "Coffee",
        bookerPubkey: "booker",
        start: 1,
        end: 2,
        schedulingPageRef: "31927:pk:p1",
      },
    ]);

    const blocked = await tools.get("decline_booking")!.handler({ requestId: "r1" });
    expect(blocked.ok).toBe(false);
    expect(calendarBooking.declineBookingRequest).not.toHaveBeenCalled();

    const okRes = await tools
      .get("decline_booking")!
      .handler({ requestId: "r1", reason: "unavailable", confirm: true });
    expect(calendarBooking.declineBookingRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1" }),
      "unavailable",
    );
    expect(okRes.ok).toBeTruthy();
  });
});
