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
});
