import type { RSVPStatus } from "@formstr/calendar-sdk";
import {
  CALENDAR_KINDS,
  coordinate as buildCoordinate,
  findCalendarForCoordinate,
  parseCoordinate,
  type CalendarEvent,
  type CalendarEventDraft,
  type CalendarList,
  type EventRef,
  type FormAttachment,
} from "@formstr/calendar-sdk";
import { signerManager } from "@formstr/core";
import { z } from "zod";

import { ok, fail } from "../result";
import { requireConfirm } from "../safety";
import { calendarBooking, calendarDiscovery } from "../services";
import { getCalendarSdk } from "../services/calendar/sdk";

import { normalizePubkeyList } from "./pubkey";
import type { ToolDef } from "./types";

/**
 * Parse an ISO 8601 string to a Date, or null when unparseable. LLM callers
 * routinely pass junk ("next friday"); unchecked, an Invalid Date flows into
 * the SDK and publishes literal "NaN" start/end tags to relays.
 */
function parseIsoDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function badDate(field: string, value: string) {
  return fail(
    `Could not parse ${field} "${value}" — pass an ISO 8601 date-time (e.g. 2026-07-02T15:00:00Z).`,
    "BAD_INPUT",
  );
}

/** The SDK models a registration form as a `forms` array; the tools expose one. */
function formsFor(naddr: string | undefined, viewKey: string | undefined): FormAttachment[] {
  return naddr ? [{ naddr, ...(viewKey ? { viewKey } : {}) }] : [];
}

function formRefOf(event: CalendarEvent): string | undefined {
  return event.forms?.[0]?.naddr;
}

function formViewKeyOf(event: CalendarEvent): string | undefined {
  return event.forms?.[0]?.viewKey;
}

/** Rebuild an edit draft from the event as it stands, before applying changes. */
function draftFrom(event: CalendarEvent): CalendarEventDraft & { id: string } {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    begin: event.begin,
    end: event.end,
    location: event.location,
    participants: event.participants,
    rrule: event.repeat.rrule ?? undefined,
    notificationPreference: event.notificationPreference,
    forms: event.forms,
    image: event.image,
  };
}

export const calendarTools: ToolDef[] = buildCalendarTools();

function buildCalendarTools(): ToolDef[] {
  const tools: ToolDef[] = [];
  let write = false;
  const server = {
    registerTool(
      name: string,
      config: Pick<ToolDef, "description" | "inputSchema">,
      handler: ToolDef["handler"],
    ) {
      tools.push({ name, ...config, handler, ...(write ? { write: true } : {}) });
    },
  };

  server.registerTool(
    "list_calendar_events",
    {
      description: "List the user's calendar events. Optional ISO 8601 since/until window.",
      inputSchema: { since: z.string().optional(), until: z.string().optional() },
    },
    async ({ since, until }) => {
      const sinceDate = since ? parseIsoDate(since) : undefined;
      if (since && !sinceDate) return badDate("since", since);
      const untilDate = until ? parseIsoDate(until) : undefined;
      if (until && !untilDate) return badDate("until", until);
      const pubkey = signerManager.getPublicKey();
      const events = await calendarDiscovery.fetchEventsDirect({
        authors: pubkey ? [pubkey] : undefined,
        since: sinceDate ? Math.floor(sinceDate.getTime() / 1000) : undefined,
        until: untilDate ? Math.floor(untilDate.getTime() / 1000) : undefined,
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
        "Schedule a calendar event. start/end are ISO 8601. Events default to PRIVATE " +
        "(encrypted) and are linked into a calendar list — that is the only way they show " +
        "on calendar.formstr.app, which renders only events referenced in a calendar list. " +
        "Pass calendarId to choose which calendar; if omitted and the user already has " +
        "calendars, this tool returns the list so you can ASK the user which one (then " +
        "re-run with calendarId). Set isPrivate:false for a public, unencrypted event — " +
        "note public events do NOT sync to calendar.formstr.app. participants (npub or hex) " +
        "receive NIP-59 invitations. registrationFormRef attaches a Formstr form; for an " +
        "ENCRYPTED form also pass registrationFormViewKey or attendees cannot read it.",
      inputSchema: {
        title: z.string(),
        description: z.string().optional(),
        start: z.string(),
        end: z.string().optional(),
        location: z.string().optional(),
        isPrivate: z.boolean().optional(),
        calendarId: z.string().optional(),
        participants: z.array(z.string()).optional(),
        rrule: z.string().optional(),
        registrationFormRef: z.string().optional(),
        registrationFormViewKey: z.string().optional(),
      },
    },
    async (args) => {
      const begin = parseIsoDate(args.start);
      if (!begin) return badDate("start", args.start);
      const end = args.end ? parseIsoDate(args.end) : new Date(begin.getTime() + 3_600_000);
      if (!end) return badDate("end", args.end!);
      // Default to private: only private events referenced (with their viewKey)
      // in a calendar list are discoverable on calendar.formstr.app.
      const isPrivate = args.isPrivate ?? true;
      const sdk = await getCalendarSdk();
      const calendars = await sdk.fetchCalendars();

      // Ask which calendar when the event needs one but none was chosen. A
      // private event with no calendars has nothing to ask about — we
      // auto-create a default "My Calendar" below.
      if (isPrivate && !args.calendarId && calendars.length > 0) {
        const choices = calendars.map((c) => `${c.title} (${c.id})`).join("; ");
        return fail(
          `Which calendar should "${args.title}" go in? Re-run create_calendar_event with ` +
            `calendarId set to one of: ${choices}.`,
          "CALENDAR_REQUIRED",
        );
      }
      if (args.calendarId && !calendars.some((c) => c.id === args.calendarId)) {
        const available = calendars.map((c) => c.id).join(", ") || "(none)";
        return fail(
          `No calendar found for id ${args.calendarId}. Available: ${available}.`,
          "NOT_FOUND",
        );
      }

      // Accept npub OR hex for each participant — the wire (["p"] rows, NIP-59
      // invitation wraps, relay-list query) needs hex, so convert here.
      const participants = normalizePubkeyList(args.participants);
      const draft: CalendarEventDraft = {
        title: args.title,
        description: args.description ?? "",
        begin: begin.getTime(),
        end: end.getTime(),
        location: args.location ? [args.location] : undefined,
        participants,
        rrule: args.rrule,
        forms: formsFor(args.registrationFormRef, args.registrationFormViewKey),
      };

      if (!isPrivate) {
        const { event } = await sdk.publishPublicEvent(draft);
        return ok(`Created public event "${args.title}".`, {
          id: event.id,
          eventId: event.eventId,
          coordinate: buildCoordinate(event.kind, event.user, event.id),
          calendarId: undefined,
          invitationsSent: 0,
        });
      }

      // A private event's per-event viewKey only survives a refresh if it is
      // stored in a list's eventRef — that is also how calendar.formstr.app
      // discovers and decrypts it — so a private event MUST land in a calendar.
      let list: CalendarList | undefined = args.calendarId
        ? calendars.find((c) => c.id === args.calendarId)
        : calendars[0];
      let known = calendars;
      if (!list) {
        list = await sdk.createCalendar({ title: "My Calendar", color: "#334155" });
        known = [...calendars, list];
      }

      const published = await sdk.publishPrivateEvent(draft, {
        calendarId: list.id,
        calendars: known,
      });
      // One NIP-59 invitation per participant, published to that participant's
      // NIP-65 relays — echo the count so callers can verify the invites went
      // out instead of guessing.
      const invitationsSent = published.invitations.length;
      return ok(
        `Created private event "${args.title}" in calendar "${list.title}"` +
          `${invitationsSent ? ` — sent ${invitationsSent} invitation(s)` : ""}.`,
        {
          id: published.event.id,
          eventId: published.event.eventId,
          coordinate: published.eventRef[0],
          calendarId: list.id,
          invitationsSent,
        },
      );
    },
  );

  server.registerTool(
    "get_calendar_event",
    {
      description: "Fetch a single calendar event by its addressable coordinate kind:pubkey:d.",
      inputSchema: { coordinate: z.string() },
    },
    async ({ coordinate }) => {
      const sdk = await getCalendarSdk();
      // Recover the per-event viewKey from the user's lists so a private event
      // decrypts (without it it comes back "Untitled" with no times/participants).
      const calendars = await sdk.fetchCalendars();
      const viewKey = await sdk.lookupEventViewKey(coordinate, calendars);
      const event = await sdk.fetchEventByCoordinate(coordinate, { viewKey });
      if (!event) return fail(`No event found for ${coordinate}.`, "NOT_FOUND");
      return ok(`Event "${event.title}".`, {
        event: {
          id: event.id,
          title: event.title,
          description: event.description,
          begin: event.begin,
          end: event.end,
          location: event.location,
          isPrivate: event.isPrivate,
          rrule: event.repeat?.rrule ?? null,
          participants: event.participants,
          calendarId: findCalendarForCoordinate(calendars, coordinate)?.id ?? null,
          // The attached form ref is surfaced so a write can be verified; the
          // form's viewKey itself is never returned (no key material in results).
          registrationFormRef: formRefOf(event) ?? null,
          registrationFormHasViewKey: Boolean(formViewKeyOf(event)),
        },
      });
    },
  );

  server.registerTool(
    "list_calendars",
    { description: "List the user's calendar lists.", inputSchema: {} },
    async () => {
      const sdk = await getCalendarSdk();
      const lists = await sdk.fetchCalendars();
      return ok(`Found ${lists.length} calendar(s).`, {
        calendars: lists.map((c) => ({
          id: c.id,
          title: c.title,
          color: c.color,
          description: c.description,
        })),
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
      const sdk = await getCalendarSdk();
      const list = await sdk.createCalendar({
        title,
        color: color ?? "#334155",
        description: description ?? "",
      });
      return ok(`Created calendar "${title}".`, { id: list.id });
    },
  );

  server.registerTool(
    "fetch_event_rsvps",
    {
      description: "List RSVPs for an event coordinate kind:pubkey:d.",
      inputSchema: { coordinate: z.string() },
    },
    async ({ coordinate }) => {
      const sdk = await getCalendarSdk();
      // A private event's RSVPs are encrypted to its viewKey; look it up so the
      // tool works for private and public events alike.
      const viewKey = await sdk.lookupEventViewKey(coordinate);
      const rsvps = await sdk.fetchRsvps(coordinate, { viewKey });
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
      const sdk = await getCalendarSdk();
      const invitations = await sdk.fetchInvitationsWithEvents();
      return ok(`Found ${invitations.length} invitation(s).`, {
        invitations: invitations.map((i) => ({
          coordinate: i.coordinate,
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
  write = true;

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
      const sdk = await getCalendarSdk();
      const lists = await sdk.fetchCalendars();
      const list = lists.find((c) => c.id === calendarId);
      if (!list) return fail(`No calendar found for id ${calendarId}.`, "NOT_FOUND");
      const { event } = await calendarBooking.approveBookingRequest(request, list);
      return ok(`Approved booking "${request.title}".`, {
        coordinate: buildCoordinate(event.kind, event.user, event.id),
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
      const sdk = await getCalendarSdk();
      // NIP-09 wants the target's kind. Take it from the coordinate when one
      // was supplied; a bare event id can only be a public event.
      const kind =
        (coordinate ? parseCoordinate(coordinate)?.kind : undefined) ?? CALENDAR_KINDS.publicEvent;
      await sdk.deleteEvent({
        kind,
        coordinate,
        // A nostr event id is 64 hex chars; the tool's `eventId` is often the
        // d-tag instead, which must not go out as an `e` row.
        eventId: /^[0-9a-f]{64}$/i.test(eventId) ? eventId : undefined,
        reason: "Deleted via Formstr",
      });
      return ok(`Deleted event ${eventId}.`);
    },
  );

  server.registerTool(
    "rsvp_event",
    {
      description:
        "RSVP to a calendar event on your identity. Optionally suggest a new time (suggestedStart/suggestedEnd, unix seconds) and add a note (comment). For private events pass the event's viewKey (nsec) if known — otherwise it is looked up from your calendar lists. Requires confirm:true.",
      inputSchema: {
        eventCoordinate: z.string(),
        status: z.enum(["accepted", "declined", "tentative"]),
        isPrivate: z.boolean().optional(),
        viewKey: z.string().optional(),
        suggestedStart: z.number().optional(),
        suggestedEnd: z.number().optional(),
        comment: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({
      eventCoordinate,
      status,
      viewKey,
      suggestedStart,
      suggestedEnd,
      comment,
      confirm,
    }) => {
      const blocked = requireConfirm("rsvp_event", { confirm }, `sends "${status}" RSVP`);
      if (blocked) return blocked;
      const sdk = await getCalendarSdk();
      // Private RSVPs need the event viewKey to take the standalone-compatible
      // kind-32069 path — calendar.formstr.app never reads the gift-wrap
      // fallback. The user's calendar lists carry it in their eventRefs. The
      // SDK picks the public or private path from the coordinate's own kind, so
      // the `isPrivate` argument is no longer consulted.
      const key = viewKey ?? (await sdk.lookupEventViewKey(eventCoordinate));
      await sdk.rsvp({
        coordinate: eventCoordinate,
        payload: { status: status as RSVPStatus, suggestedStart, suggestedEnd, comment },
        viewKey: key,
      });
      return ok(`RSVP "${status}" sent.`);
    },
  );

  server.registerTool(
    "update_calendar_event",
    {
      description:
        "Update a calendar event by its coordinate kind:pubkey:d. Only changed fields need be sent. " +
        "registrationFormRef attaches/replaces the event's registration form (empty string detaches it); " +
        "for an ENCRYPTED form also pass registrationFormViewKey or attendees cannot read it. Requires confirm:true.",
      inputSchema: {
        coordinate: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        location: z.string().optional(),
        rrule: z.string().optional(),
        registrationFormRef: z.string().optional(),
        registrationFormViewKey: z.string().optional(),
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
      const newBegin = args.start ? parseIsoDate(args.start) : undefined;
      if (args.start && !newBegin) return badDate("start", args.start);
      const newEnd = args.end ? parseIsoDate(args.end) : undefined;
      if (args.end && !newEnd) return badDate("end", args.end);
      const sdk = await getCalendarSdk();
      const calendars = await sdk.fetchCalendars();
      // Recover the per-event viewKey from the user's calendar lists so the
      // private event decrypts (without it the fields are lost) AND the republish
      // reuses the SAME key — minting a fresh one would orphan the calendar-list
      // ref's viewKey, making the event un-decryptable (invalid MAC) everywhere.
      const viewKey = await sdk.lookupEventViewKey(args.coordinate, calendars);
      const existing = await sdk.fetchEventByCoordinate(args.coordinate, { viewKey });
      if (!existing) return fail(`No event found for ${args.coordinate}.`, "NOT_FOUND");
      // Registration form: undefined keeps the current one, "" detaches it.
      // The old form's viewKey is kept only when the ref is unchanged — carried
      // over to a different form it would be the wrong key (see attach_form_to_event).
      const currentRef = formRefOf(existing);
      const formRef =
        args.registrationFormRef === undefined ? currentRef : args.registrationFormRef || undefined;
      const formViewKey = !formRef
        ? undefined
        : (args.registrationFormViewKey ??
          (formRef === currentRef ? formViewKeyOf(existing) : undefined));
      const draft = {
        ...draftFrom(existing),
        title: args.title ?? existing.title,
        description: args.description ?? existing.description,
        begin: newBegin ? newBegin.getTime() : existing.begin,
        end: newEnd ? newEnd.getTime() : existing.end,
        location: args.location ? [args.location] : existing.location,
        rrule: args.rrule ?? existing.repeat.rrule ?? undefined,
        forms: formsFor(formRef, formViewKey),
      };
      const event = await republish(sdk, existing, draft, calendars, viewKey);
      return ok(`Updated event "${event.title}".`, {
        id: event.id,
        coordinate: buildCoordinate(event.kind, event.user, event.id),
      });
    },
  );

  server.registerTool(
    "attach_form_to_event",
    {
      description:
        "Attach a Formstr form (naddr or coordinate) as an event's registration form. " +
        "For an ENCRYPTED form, also pass formViewKey (the form's view key) — without it " +
        "attendees cannot read the attached form. Requires confirm:true.",
      inputSchema: {
        coordinate: z.string(),
        formRef: z.string(),
        formViewKey: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ coordinate, formRef, formViewKey, confirm }) => {
      const blocked = requireConfirm(
        "attach_form_to_event",
        { confirm },
        `attaches a form to ${coordinate}`,
      );
      if (blocked) return blocked;
      const sdk = await getCalendarSdk();
      const calendars = await sdk.fetchCalendars();
      // See update_calendar_event: recover the viewKey first so the private
      // event decrypts and the republish keeps the calendar-list ref valid.
      const viewKey = await sdk.lookupEventViewKey(coordinate, calendars);
      const existing = await sdk.fetchEventByCoordinate(coordinate, { viewKey });
      if (!existing) return fail(`No event found for ${coordinate}.`, "NOT_FOUND");
      // Keep the old form's viewKey only when re-attaching the SAME form —
      // carried over to a different form it would be the wrong key.
      const keptViewKey =
        formViewKey ?? (formRef === formRefOf(existing) ? formViewKeyOf(existing) : undefined);
      const draft = {
        ...draftFrom(existing),
        forms: formsFor(formRef, keptViewKey),
      };
      const event = await republish(sdk, existing, draft, calendars, viewKey);
      return ok(`Attached form to "${event.title}".`, {
        coordinate: buildCoordinate(event.kind, event.user, event.id),
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
      const sdk = await getCalendarSdk();
      const lists = await sdk.fetchCalendars();
      const existing = lists.find((c) => c.id === id);
      if (!existing) return fail(`No calendar found for id ${id}.`, "NOT_FOUND");
      const saved = await sdk.updateCalendar({
        ...existing,
        title: title ?? existing.title,
        color: color ?? existing.color,
        description: description ?? existing.description,
      });
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
      const sdk = await getCalendarSdk();
      const parsed = parseCoordinate(coordinate);
      if (!parsed) return fail(`Not a calendar coordinate: ${coordinate}.`, "BAD_INPUT");
      const lists = await sdk.fetchCalendars();
      const list = lists.find((c) => c.id === parsed.dTag);
      if (!list) return fail(`No calendar found for ${coordinate}.`, "NOT_FOUND");
      await sdk.deleteCalendar(list);
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
      const sdk = await getCalendarSdk();
      const lists = await sdk.fetchCalendars();
      const list = lists.find((c) => c.id === calendarId);
      if (!list) return fail(`No calendar found for id ${calendarId}.`, "NOT_FOUND");
      const ref: EventRef = [coordinate, relayHint ?? "", viewKey ?? ""];
      const saved = await sdk.linkEventToCalendar(list, ref);
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
      const sdk = await getCalendarSdk();
      const lists = await sdk.fetchCalendars();
      const list = lists.find((c) => c.id === calendarId);
      if (!list) return fail(`No calendar found for id ${calendarId}.`, "NOT_FOUND");
      const saved = await sdk.unlinkEventFromCalendar(list, coordinate);
      return ok(`Removed ${coordinate} from "${saved.title}".`, { id: saved.id });
    },
  );

  return tools;
}

/**
 * Republish an edited event on whichever path its kind demands.
 *
 * The private path must be told who already holds an invitation: the SDK
 * re-wraps every participant missing from `previousParticipants`, so passing
 * the event's current list is what stops an edit from spamming a fresh
 * invitation at everyone.
 */
async function republish(
  sdk: Awaited<ReturnType<typeof getCalendarSdk>>,
  existing: CalendarEvent,
  draft: CalendarEventDraft & { id: string },
  calendars: readonly CalendarList[],
  viewKey: string | undefined,
): Promise<CalendarEvent> {
  if (!existing.isPrivate) {
    const { event } = await sdk.publishPublicEvent(draft, {
      previousCreatedAt: existing.createdAt,
    });
    return event;
  }
  const published = await sdk.updatePrivateEvent(draft, {
    previousParticipants: existing.participants,
    calendarId: findCalendarForCoordinate(
      calendars,
      buildCoordinate(existing.kind, existing.user, existing.id),
    )?.id,
    calendars,
    viewKey,
    previousCreatedAt: existing.createdAt,
  });
  return published.event;
}
