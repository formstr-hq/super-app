import { Box, Typography } from "@mui/material";

import { calendarForEvent } from "../../lib/calendarMembership";
import { expandEvents } from "../../lib/rrule";
import type { CalendarEvent, CalendarList } from "../../services/calendar";

import { EventCard } from "./EventCard";

interface CalendarListViewProps {
  events: CalendarEvent[];
  /** Selected month — the list mirrors the grid's range so the two views agree. */
  year: number;
  month: number;
  onEventClick: (event: CalendarEvent) => void;
  calendars?: CalendarList[];
}

export function CalendarListView({
  events,
  year,
  month,
  onEventClick,
  calendars = [],
}: CalendarListViewProps) {
  const colorFor = (e: CalendarEvent) => calendarForEvent(e, calendars)?.color;

  // Show the same set the month grid shows (occurrences within the selected
  // month), as a chronological agenda. Keeping the range identical to
  // CalendarMonthView is what fixes "month shows an event, list shows none".
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);
  const inMonth = expandEvents(events, monthStart, monthEnd).sort((a, b) => a.begin - b.begin);

  if (inMonth.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
        No events this month.
      </Typography>
    );
  }

  const groups = new Map<string, CalendarEvent[]>();
  for (const e of inMonth) {
    const key = new Date(e.begin).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {Array.from(groups.entries()).map(([day, dayEvents]) => (
        <Box key={day}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
            {day}
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
            {dayEvents.map((e) => (
              <EventCard
                key={`${e.eventId}-${e.begin}`}
                event={e}
                color={colorFor(e)}
                onClick={() => onEventClick(e)}
              />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
