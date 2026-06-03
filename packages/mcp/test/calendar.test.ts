import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/app/services", () => ({
  calendar: {
    fetchCalendarEventsSync: vi.fn(),
    publishPublicCalendarEvent: vi.fn(),
    deleteCalendarEvent: vi.fn(),
  },
  calendarRsvp: {
    rsvpToEvent: vi.fn(),
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
});
