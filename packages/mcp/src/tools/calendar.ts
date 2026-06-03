import { calendar, calendarRsvp } from "@formstr/app/services";
import { signerManager } from "@formstr/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ok } from "../result";
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
        "Schedule a PUBLIC calendar event. start/end are ISO 8601. (Private events are deferred in v1.)",
      inputSchema: {
        title: z.string(),
        description: z.string().optional(),
        start: z.string(),
        end: z.string().optional(),
        location: z.string().optional(),
      },
    },
    async (args) => {
      const begin = new Date(args.start);
      const end = args.end ? new Date(args.end) : new Date(begin.getTime() + 3_600_000);
      const event = await calendar.publishPublicCalendarEvent({
        title: args.title,
        description: args.description ?? "",
        begin,
        end,
        location: args.location,
      });
      const coordinate = `${event.kind}:${event.user}:${event.id}`;
      return ok(`Created event "${args.title}".`, {
        id: event.id,
        eventId: event.eventId,
        coordinate,
      });
    },
  );

  // Read tools and constructive creates (above) are always available; only
  // destructive/outward actions below are gated behind --allow-writes.
  if (!ctx.allowWrites) return;

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
      description: "RSVP to a calendar event on your identity. Requires confirm:true.",
      inputSchema: {
        eventCoordinate: z.string(),
        status: z.enum(["accepted", "declined", "tentative"]),
        isPrivate: z.boolean().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ eventCoordinate, status, isPrivate, confirm }) => {
      const blocked = requireConfirm("rsvp_event", { confirm }, `sends "${status}" RSVP`);
      if (blocked) return blocked;
      await calendarRsvp.rsvpToEvent(eventCoordinate, status, Boolean(isPrivate));
      return ok(`RSVP "${status}" sent.`);
    },
  );
}
