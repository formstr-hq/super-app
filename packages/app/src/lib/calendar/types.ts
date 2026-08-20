export type {
  BusyList,
  BusyRange,
  CalendarEvent,
  CalendarEventDraft,
  CalendarList,
  EventRef,
  FormAttachment,
  Invitation,
  InvitationWithEvent,
  RSVPPayload,
  RSVPResponse,
} from "@formstr/calendar-sdk";
export { CALENDAR_KINDS, RSVPStatus } from "@formstr/calendar-sdk";

import type { CalendarEvent, CalendarEventDraft } from "@formstr/calendar-sdk";

/**
 * A calendar event plus the two fields the app derives locally.
 *
 * Neither is on the wire. `calendarId` is the in-session hint set right after a
 * create, before the calendar-list refetch lands — membership itself is read
 * from each list's `eventRefs`, so an event authored in calendar.formstr.app
 * still resolves. `isInvitation` marks an event that arrived through the
 * invitation inbox rather than the user's own lists.
 */
export type AppCalendarEvent = CalendarEvent & {
  calendarId?: string;
  isInvitation?: boolean;
};

/**
 * The draft the UI edits. `isPrivate` and `calendarId` are routing decisions
 * the store turns into a publish path and a publish option — the SDK's own
 * draft carries neither, because neither is a field on the wire.
 */
export type AppCalendarEventDraft = CalendarEventDraft & {
  isPrivate?: boolean;
  calendarId?: string;
};
