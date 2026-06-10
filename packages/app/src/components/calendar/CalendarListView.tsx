import type { CalendarEvent, CalendarList } from "@formstr/agent/services/calendar";
import { Box, Paper, Skeleton, Typography } from "@mui/material";
import { CalendarDays } from "lucide-react";

import { calendarForEvent } from "../../lib/calendarMembership";
import { expandEvents } from "../../lib/rrule";
import { EmptyState } from "../EmptyState";

import { EventCard } from "./EventCard";

interface CalendarListViewProps {
  events: CalendarEvent[];
  /** Selected month — the list mirrors the grid's range so the two views agree. */
  year: number;
  month: number;
  isLoading?: boolean;
  onEventClick: (event: CalendarEvent) => void;
  calendars?: CalendarList[];
}

export function CalendarListView({
  events,
  year,
  month,
  isLoading = false,
  onEventClick,
  calendars = [],
}: CalendarListViewProps) {
  const colorFor = (e: CalendarEvent) => calendarForEvent(e, calendars)?.color;

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Paper key={i} variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }}>
            <Skeleton variant="text" width="55%" height={18} />
            <Skeleton variant="text" width="35%" height={14} />
          </Paper>
        ))}
      </Box>
    );
  }

  // Show the same set the month grid shows (occurrences within the selected
  // month), as a chronological agenda. Keeping the range identical to
  // CalendarMonthView is what fixes "month shows an event, list shows none".
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);
  const inMonth = expandEvents(events, monthStart, monthEnd).sort((a, b) => a.begin - b.begin);

  if (inMonth.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No events this month"
        description="Create an event or import invitations — private events stay encrypted."
        compact
      />
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
