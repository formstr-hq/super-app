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
