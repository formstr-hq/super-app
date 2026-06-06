import { calendar, calendarBooking, calendarRsvp } from "@formstr/app/services";
import { signerManager } from "@formstr/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ok, fail } from "../result";
import { requireConfirm } from "../safety";

import type { RegisterCtx } from "./shared";

export function registerCalendar(server: McpServer, ctx: RegisterCtx): void {
  server.registerTool(
    "list_calendar_events",
    {
      description: "List the user's calendar events. Optional ISO 8601 since/until window.",
      inputSchema: { since: z.string().optional(), until: z.string().optional() },
    },
    async ({ since, until }) => {
      const pubkey = signerManager.getPublicKey();
      const events = await calendar.fetchCalendarEventsSync({
        authors: pubkey ? [pubkey] : undefined,
        since: since ? Math.floor(new Date(since).getTime() / 1000) : undefined,
        until: until ? Math.floor(new Date(until).getTime() / 1000) : undefined,
      });
      return ok(`Found ${events.length} event(s).`, {
        events: events.map((e) => ({
          id: e.id,
          eventId: e.eventId,
          title: e.title,
          begin: e.begin,
          end: e.end,
          location: e.location,
          isPrivate: e.isPrivate,
        })),
      });
    },
  );

  server.registerTool(
    "create_calendar_event",
    {
      description:
        "Schedule a calendar event. start/end are ISO 8601. Set isPrivate:true for an encrypted event; participants receive NIP-59 invitations.",
      inputSchema: {
        title: z.string(),
        description: z.string().optional(),
        start: z.string(),
        end: z.string().optional(),
        location: z.string().optional(),
        isPrivate: z.boolean().optional(),
        participants: z.array(z.string()).optional(),
        rrule: z.string().optional(),
        startTzid: z.string().optional(),
        registrationFormRef: z.string().optional(),
      },
    },
    async (args) => {
      const begin = new Date(args.start);
      const end = args.end ? new Date(args.end) : new Date(begin.getTime() + 3_600_000);
      const draft = {
        title: args.title,
        description: args.description ?? "",
        begin,
        end,
        location: args.location,
        participants: args.participants,
        isPrivate: Boolean(args.isPrivate),
        rrule: args.rrule,
        startTzid: args.startTzid,
        registrationFormRef: args.registrationFormRef,
      };
      const event = args.isPrivate
        ? await calendar.publishPrivateCalendarEvent(draft, "default")
        : await calendar.publishPublicCalendarEvent(draft);
      const coordinate = `${event.kind}:${event.user}:${event.id}`;
      return ok(`Created ${args.isPrivate ? "private" : "public"} event "${args.title}".`, {
        id: event.id,
        eventId: event.eventId,
        coordinate,
      });
    },
  );

  server.registerTool(
    "get_calendar_event",
    {
      description: "Fetch a single calendar event by its addressable coordinate kind:pubkey:d.",
      inputSchema: { coordinate: z.string() },
    },
    async ({ coordinate }) => {
      const event = await calendar.fetchCalendarEventByCoordinate(coordinate);
      if (!event) return fail(`No event found for ${coordinate}.`, "NOT_FOUND");
      return ok(`Event "${event.title}".`, {
        event: {
          id: event.id,
          title: event.title,
          begin: event.begin,
          end: event.end,
          location: event.location,
          isPrivate: event.isPrivate,
          rrule: event.repeat?.rrule ?? null,
          participants: event.participants,
        },
      });
    },
  );

  server.registerTool(
    "list_calendars",
    { description: "List the user's calendar lists.", inputSchema: {} },
    async () => {
      const lists = await calendar.fetchCalendarLists();
      return ok(`Found ${lists.length} calendar(s).`, {
        calendars: lists.map((c) => ({ id: c.id, title: c.title, color: c.color })),
      });
    },
  );

  server.registerTool(
    "create_calendar",
    {
      description: "Create a calendar list with a title and optional hex color.",
      inputSchema: {
        title: z.string(),
        color: z.string().optional(),
        description: z.string().optional(),
      },
    },
    async ({ title, color, description }) => {
      const list = await calendar.createCalendarList(title, color ?? "#334155", description ?? "");
      return ok(`Created calendar "${title}".`, { id: list.id });
    },
  );

  server.registerTool(
    "fetch_event_rsvps",
    {
      description: "List public RSVPs for an event coordinate kind:pubkey:d.",
      inputSchema: { coordinate: z.string() },
    },
    async ({ coordinate }) => {
      const rsvps = await calendarRsvp.fetchRsvpsForEvent(coordinate);
      return ok(`Found ${rsvps.length} RSVP(s).`, {
        rsvps: rsvps.map((r) => ({
          pubkey: r.pubkey,
          status: r.status,
          suggestedStart: r.suggestedStart,
          suggestedEnd: r.suggestedEnd,
          comment: r.comment,
        })),
      });
    },
  );

  server.registerTool(
    "list_invitations",
    {
      description: "List calendar invitations received via NIP-59 gift-wrap.",
      inputSchema: {},
    },
    async () => {
      const invitations = await calendar.fetchInvitationsSync();
      return ok(`Found ${invitations.length} invitation(s).`, {
        invitations: invitations.map((i) => ({
          coordinate: i.eventCoordinate,
          title: i.event?.title ?? null,
          begin: i.event?.begin ?? null,
        })),
      });
    },
  );

  server.registerTool(
    "list_scheduling_pages",
    {
      description:
        "List the user's booking links (appointment scheduling pages). Each has a shareable booking URL.",
      inputSchema: {},
    },
    async () => {
      const pages = await calendarBooking.fetchSchedulingPages();
      return ok(`Found ${pages.length} booking link(s).`, {
        bookingLinks: pages.map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          url: calendarBooking.bookingLinkUrl(p),
        })),
      });
    },
  );

  server.registerTool(
    "list_booking_requests",
    {
      description:
        "List incoming appointment booking requests (from your booking links) received via NIP-59 gift-wrap.",
      inputSchema: {},
    },
    async () => {
      const requests = await calendarBooking.fetchBookingRequests();
      return ok(`Found ${requests.length} booking request(s).`, {
        requests: requests.map((r) => ({
          id: r.id,
          title: r.title,
          note: r.note,
          start: r.start,
          end: r.end,
          booker: r.bookerPubkey,
          schedulingPageRef: r.schedulingPageRef,
        })),
      });
    },
  );

  // Read tools and constructive creates (above) are always available; only
  // destructive/outward actions below are gated behind --allow-writes.
  if (!ctx.allowWrites) return;

  server.registerTool(
    "approve_booking",
    {
      description:
        "Approve an incoming booking request by id, creating the appointment in the given calendar (id/d-tag) and notifying the booker. Requires confirm:true.",
      inputSchema: {
        requestId: z.string(),
        calendarId: z.string(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ requestId, calendarId, confirm }) => {
      const blocked = requireConfirm(
        "approve_booking",
        { confirm },
        `approves booking ${requestId}`,
      );
      if (blocked) return blocked;
      const requests = await calendarBooking.fetchBookingRequests();
      const request = requests.find((r) => r.id === requestId);
      if (!request) return fail(`No booking request found for id ${requestId}.`, "NOT_FOUND");
      const lists = await calendar.fetchCalendarLists();
      const list = lists.find((c) => c.id === calendarId);
      if (!list) return fail(`No calendar found for id ${calendarId}.`, "NOT_FOUND");
      const { event } = await calendarBooking.approveBookingRequest(request, list);
      return ok(`Approved booking "${request.title}".`, {
        coordinate: `${event.kind}:${event.user}:${event.id}`,
      });
    },
  );

  server.registerTool(
    "decline_booking",
    {
      description:
        "Decline an incoming booking request by id, notifying the booker (optional reason). Requires confirm:true.",
      inputSchema: {
        requestId: z.string(),
        reason: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ requestId, reason, confirm }) => {
      const blocked = requireConfirm(
        "decline_booking",
        { confirm },
        `declines booking ${requestId}`,
      );
      if (blocked) return blocked;
      const requests = await calendarBooking.fetchBookingRequests();
      const request = requests.find((r) => r.id === requestId);
      if (!request) return fail(`No booking request found for id ${requestId}.`, "NOT_FOUND");
      await calendarBooking.declineBookingRequest(request, reason);
      return ok(`Declined booking "${request.title}".`);
    },
  );

  server.registerTool(
    "delete_calendar_event",
    {
      description: "Delete a calendar event. Requires confirm:true.",
      inputSchema: {
        eventId: z.string(),
        coordinate: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ eventId, coordinate, confirm }) => {
      const blocked = requireConfirm(
        "delete_calendar_event",
        { confirm },
        `deletes event ${eventId}`,
      );
      if (blocked) return blocked;
      await calendar.deleteCalendarEvent(eventId, coordinate);
      return ok(`Deleted event ${eventId}.`);
    },
  );

  server.registerTool(
    "rsvp_event",
    {
      description:
        "RSVP to a calendar event on your identity. Optionally suggest a new time (suggestedStart/suggestedEnd, unix seconds) and add a note (comment). Requires confirm:true.",
      inputSchema: {
        eventCoordinate: z.string(),
        status: z.enum(["accepted", "declined", "tentative"]),
        isPrivate: z.boolean().optional(),
        suggestedStart: z.number().optional(),
        suggestedEnd: z.number().optional(),
        comment: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({
      eventCoordinate,
      status,
      isPrivate,
      suggestedStart,
      suggestedEnd,
      comment,
      confirm,
    }) => {
      const blocked = requireConfirm("rsvp_event", { confirm }, `sends "${status}" RSVP`);
      if (blocked) return blocked;
      const hasExtra =
        suggestedStart !== undefined || suggestedEnd !== undefined || comment !== undefined;
      if (hasExtra) {
        await calendarRsvp.rsvpToEvent(eventCoordinate, status, Boolean(isPrivate), {
          suggestedStart,
          suggestedEnd,
          comment,
        });
      } else {
        await calendarRsvp.rsvpToEvent(eventCoordinate, status, Boolean(isPrivate));
      }
      return ok(`RSVP "${status}" sent.`);
    },
  );

  server.registerTool(
    "update_calendar_event",
    {
      description:
        "Update a calendar event by its coordinate kind:pubkey:d. Only changed fields need be sent. Requires confirm:true.",
      inputSchema: {
        coordinate: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        location: z.string().optional(),
        rrule: z.string().optional(),
        startTzid: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async (args) => {
      const blocked = requireConfirm(
        "update_calendar_event",
        { confirm: args.confirm },
        `updates event ${args.coordinate}`,
      );
      if (blocked) return blocked;
      const existing = await calendar.fetchCalendarEventByCoordinate(args.coordinate);
      if (!existing) return fail(`No event found for ${args.coordinate}.`, "NOT_FOUND");
      const draft = {
        title: args.title ?? existing.title,
        description: args.description ?? existing.description,
        begin: args.start ? new Date(args.start) : new Date(existing.begin),
        end: args.end ? new Date(args.end) : new Date(existing.end),
        location: args.location ?? existing.location[0],
        participants: existing.participants,
        isPrivate: existing.isPrivate,
        rrule: args.rrule ?? existing.repeat.rrule ?? undefined,
        startTzid: args.startTzid ?? existing.startTzid,
        registrationFormRef: existing.registrationFormRef,
        existingId: existing.id,
      };
      const event = existing.isPrivate
        ? await calendar.publishPrivateCalendarEvent(draft, existing.calendarId ?? "default")
        : await calendar.publishPublicCalendarEvent(draft);
      return ok(`Updated event "${event.title}".`, {
        id: event.id,
        coordinate: `${event.kind}:${event.user}:${event.id}`,
      });
    },
  );

  server.registerTool(
    "attach_form_to_event",
    {
      description:
        "Attach a Formstr form (naddr or coordinate) as an event's registration form. Requires confirm:true.",
      inputSchema: {
        coordinate: z.string(),
        formRef: z.string(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ coordinate, formRef, confirm }) => {
      const blocked = requireConfirm(
        "attach_form_to_event",
        { confirm },
        `attaches a form to ${coordinate}`,
      );
      if (blocked) return blocked;
      const existing = await calendar.fetchCalendarEventByCoordinate(coordinate);
      if (!existing) return fail(`No event found for ${coordinate}.`, "NOT_FOUND");
      const draft = {
        title: existing.title,
        description: existing.description,
        begin: new Date(existing.begin),
        end: new Date(existing.end),
        location: existing.location[0],
        participants: existing.participants,
        isPrivate: existing.isPrivate,
        rrule: existing.repeat.rrule ?? undefined,
        startTzid: existing.startTzid,
        registrationFormRef: formRef,
        existingId: existing.id,
      };
      const event = existing.isPrivate
        ? await calendar.publishPrivateCalendarEvent(draft, existing.calendarId ?? "default")
        : await calendar.publishPublicCalendarEvent(draft);
      return ok(`Attached form to "${event.title}".`, {
        coordinate: `${event.kind}:${event.user}:${event.id}`,
      });
    },
  );

  server.registerTool(
    "update_calendar",
    {
      description:
        "Update a calendar list by its id (d-tag). Only changed fields need be sent. Requires confirm:true.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        color: z.string().optional(),
        description: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ id, title, color, description, confirm }) => {
      const blocked = requireConfirm("update_calendar", { confirm }, `updates calendar ${id}`);
      if (blocked) return blocked;
      const lists = await calendar.fetchCalendarLists();
      const existing = lists.find((c) => c.id === id);
      if (!existing) return fail(`No calendar found for id ${id}.`, "NOT_FOUND");
      const merged = {
        ...existing,
        title: title ?? existing.title,
        color: color ?? existing.color,
        description: description ?? existing.description,
      };
      const saved = await calendar.updateCalendarList(merged);
      return ok(`Updated calendar "${saved.title}".`, { id: saved.id });
    },
  );

  server.registerTool(
    "delete_calendar",
    {
      description:
        "Delete a calendar list by its addressable coordinate 32123:pubkey:id. Requires confirm:true.",
      inputSchema: {
        coordinate: z.string(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ coordinate, confirm }) => {
      const blocked = requireConfirm(
        "delete_calendar",
        { confirm },
        `deletes calendar ${coordinate}`,
      );
      if (blocked) return blocked;
      await calendar.deleteCalendarList(coordinate);
      return ok(`Deleted calendar ${coordinate}.`);
    },
  );

  server.registerTool(
    "add_event_to_calendar",
    {
      description:
        "Add an event to a calendar list. coordinate is the event's kind:pubkey:d; supply relayHint and viewKey (nsec) for private events. Requires confirm:true.",
      inputSchema: {
        calendarId: z.string(),
        coordinate: z.string(),
        relayHint: z.string().optional(),
        viewKey: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ calendarId, coordinate, relayHint, viewKey, confirm }) => {
      const blocked = requireConfirm(
        "add_event_to_calendar",
        { confirm },
        `adds ${coordinate} to calendar ${calendarId}`,
      );
      if (blocked) return blocked;
      const lists = await calendar.fetchCalendarLists();
      const list = lists.find((c) => c.id === calendarId);
      if (!list) return fail(`No calendar found for id ${calendarId}.`, "NOT_FOUND");
      const saved = await calendar.addEventToCalendarList(list, [
        coordinate,
        relayHint ?? "",
        viewKey ?? "",
      ]);
      return ok(`Added ${coordinate} to "${saved.title}".`, { id: saved.id });
    },
  );

  server.registerTool(
    "remove_event_from_calendar",
    {
      description:
        "Remove an event (by its coordinate kind:pubkey:d) from a calendar list. Requires confirm:true.",
      inputSchema: {
        calendarId: z.string(),
        coordinate: z.string(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ calendarId, coordinate, confirm }) => {
      const blocked = requireConfirm(
        "remove_event_from_calendar",
        { confirm },
        `removes ${coordinate} from calendar ${calendarId}`,
      );
      if (blocked) return blocked;
      const lists = await calendar.fetchCalendarLists();
      const list = lists.find((c) => c.id === calendarId);
      if (!list) return fail(`No calendar found for id ${calendarId}.`, "NOT_FOUND");
      const saved = await calendar.removeEventFromCalendarList(list, coordinate);
      return ok(`Removed ${coordinate} from "${saved.title}".`, { id: saved.id });
    },
  );
}
