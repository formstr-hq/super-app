import type { CalendarEvent, CalendarList } from "../services/calendar";

/** Addressable coordinate of a calendar event: `kind:authorPubkey:dTag`. */
export function eventCoordinate(event: CalendarEvent): string {
  return `${event.kind}:${event.user}:${event.id}`;
}

/**
 * Filters events by calendar-list membership and visibility.
 *
 * Membership is derived from each calendar list's `eventRefs` (the standalone's
 * model), matched by coordinate — not the super-app-only `calendarId` field, so
 * events authored in calendar.formstr.app filter correctly too.
 *
 * - An event referenced by no calendar is "unfiled" and always shown.
 * - An event referenced by one or more calendars is shown only when at least one
 *   of those calendars is currently visible.
 */
export function filterEventsByCalendarVisibility(
  events: CalendarEvent[],
  calendars: CalendarList[],
  visibleCalendarIds: Set<string>,
): CalendarEvent[] {
  return events.filter((event) => {
    const coord = eventCoordinate(event);
    const owning = calendars.filter((c) => c.eventRefs.some((ref) => ref[0] === coord));
    if (owning.length === 0) return true;
    return owning.some((c) => visibleCalendarIds.has(c.id));
  });
}

/**
 * Resolves the calendar list that owns an event, matched by coordinate against
 * each list's `eventRefs`. Returns `null` for unfiled events.
 *
 * Membership is NOT read from the event's `calendarId` field — fetched events
 * never carry it (only the calendar list's `eventRefs` record membership), so
 * any colour/name lookup must go through the refs to work for events authored
 * elsewhere (e.g. calendar.formstr.app).
 */
export function calendarForEvent(
  event: CalendarEvent,
  calendars: CalendarList[],
): CalendarList | null {
  // Prefer the in-session `calendarId` (set right after creating an event,
  // before the list refetch lands), then fall back to the coordinate match.
  if (event.calendarId) {
    const byId = calendars.find((c) => c.id === event.calendarId);
    if (byId) return byId;
  }
  const coord = eventCoordinate(event);
  return calendars.find((c) => c.eventRefs.some((ref) => ref[0] === coord)) ?? null;
}
