import { Box, Typography } from "@mui/material";

import { expandEvents } from "../../lib/rrule";
import type { CalendarEvent } from "../../services/calendar";

import { EventCard } from "./EventCard";

interface CalendarListViewProps {
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
}

export function CalendarListView({ events, onEventClick }: CalendarListViewProps) {
  const now = Date.now();
  const horizon = new Date(now + 1000 * 60 * 60 * 24 * 90);
  const upcoming = expandEvents(events, new Date(now), horizon)
    .filter((e) => e.begin >= now)
    .sort((a, b) => a.begin - b.begin);

  if (upcoming.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
        No upcoming events.
      </Typography>
    );
  }

  const groups = new Map<string, CalendarEvent[]>();
  for (const e of upcoming) {
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
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
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
                onClick={() => onEventClick(e)}
              />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
