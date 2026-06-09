import type { CalendarEvent, CalendarList } from "@formstr/agent/services/calendar";
import { Box, Paper, Popover, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Lock, X } from "lucide-react";
import { useState } from "react";

import { calendarForEvent } from "../../lib/calendarMembership";
import { expandEvents } from "../../lib/rrule";

/** Cap of chips rendered inline per day before collapsing into "+N more". */
const MAX_CHIPS_PER_DAY = 5;

/** A single event chip — colored left accent, time prefix, title, hover-delete. */
function EventChip({
  event,
  color,
  onClick,
  onDelete,
}: {
  event: CalendarEvent;
  color: string;
  onClick: () => void;
  onDelete: () => void;
}) {
  const time = new Date(event.begin).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <Box
      onClick={onClick}
      style={{ borderLeft: `3px solid ${color}` }}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        borderRadius: 0.5,
        pl: 0.5,
        pr: 0.25,
        py: 0.25,
        fontSize: 10,
        fontWeight: 500,
        lineHeight: 1.3,
        cursor: "pointer",
        bgcolor: "action.hover",
        color: "text.primary",
        "&:hover": { bgcolor: "action.selected" },
        "&:hover .evt-del": { opacity: 1 },
      }}
    >
      {event.isPrivate && <Lock size={8} />}
      <Box component="span" sx={{ color: "text.secondary", flexShrink: 0 }}>
        {time}
      </Box>
      <Box
        component="span"
        sx={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {event.title}
      </Box>
      <Box
        className="evt-del"
        component="button"
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label="Delete event"
        sx={{
          opacity: 0,
          bgcolor: "transparent",
          border: "none",
          cursor: "pointer",
          p: 0,
          color: "inherit",
          display: "flex",
          flexShrink: 0,
        }}
      >
        <X size={8} />
      </Box>
    </Box>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CalendarMonthViewProps {
  events: CalendarEvent[];
  year: number;
  month: number;
  calendars: CalendarList[];
  onEventClick: (event: CalendarEvent) => void;
  onDeleteEvent: (event: CalendarEvent) => void;
}

export function CalendarMonthView({
  events,
  year,
  month,
  calendars,
  onEventClick,
  onDeleteEvent,
}: CalendarMonthViewProps) {
  const theme = useTheme();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  // Anchor + payload for the "+N more" overflow popover.
  const [more, setMore] = useState<{ anchor: HTMLElement; events: CalendarEvent[] } | null>(null);

  const expanded = expandEvents(
    events,
    new Date(year, month, 1),
    new Date(year, month + 1, 0, 23, 59, 59),
  );

  const eventsForDay = (day: number) => {
    const dayStart = new Date(year, month, day).getTime();
    const dayEnd = dayStart + 86400000;
    // Chronological within the day so the earliest event renders first.
    return expanded
      .filter((e) => e.begin >= dayStart && e.begin < dayEnd)
      .sort((a, b) => a.begin - b.begin);
  };
  const colorFor = (e: CalendarEvent) =>
    calendarForEvent(e, calendars)?.color ?? theme.palette.primary.main;

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 1.5,
        overflow: "hidden",
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          borderBottom: `1px solid ${theme.palette.divider}`,
          bgcolor: "action.hover",
          flexShrink: 0,
        }}
      >
        {DAYS.map((day) => (
          <Box key={day} sx={{ py: 1, textAlign: "center" }}>
            <Typography variant="caption" fontWeight={500} color="text.secondary">
              <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                {day}
              </Box>
              <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
                {day[0]}
              </Box>
            </Typography>
          </Box>
        ))}
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridAutoRows: "minmax(72px, 1fr)",
        }}
      >
        {Array.from({ length: firstDay }, (_, i) => (
          <Box
            key={`pre-${i}`}
            sx={{
              minHeight: 72,
              borderRight: `1px solid ${theme.palette.divider}`,
              borderBottom: `1px solid ${theme.palette.divider}`,
              bgcolor: "action.disabledBackground",
            }}
          />
        ))}

        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const dayEvents = eventsForDay(day);
          const isToday =
            day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
          const cellIndex = firstDay + i;
          const isLastRow =
            Math.floor(cellIndex / 7) === Math.floor((firstDay + daysInMonth - 1) / 7);

          return (
            <Box
              key={day}
              sx={{
                minHeight: 72,
                p: 0.75,
                borderRight:
                  (cellIndex + 1) % 7 === 0 ? "none" : `1px solid ${theme.palette.divider}`,
                borderBottom: isLastRow ? "none" : `1px solid ${theme.palette.divider}`,
              }}
            >
              <Box
                sx={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  mb: 0.5,
                  bgcolor: isToday ? "primary.main" : "transparent",
                  color: isToday ? "primary.contrastText" : "text.secondary",
                  fontSize: 11,
                  fontWeight: 500,
                }}
              >
                {day}
              </Box>

              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
                {dayEvents.slice(0, MAX_CHIPS_PER_DAY).map((evtItem) => (
                  <EventChip
                    key={`${evtItem.eventId}-${evtItem.begin}`}
                    event={evtItem}
                    color={colorFor(evtItem)}
                    onClick={() => onEventClick(evtItem)}
                    onDelete={() => onDeleteEvent(evtItem)}
                  />
                ))}
                {dayEvents.length > MAX_CHIPS_PER_DAY && (
                  <Box
                    component="button"
                    type="button"
                    onClick={(e: React.MouseEvent<HTMLButtonElement>) =>
                      setMore({ anchor: e.currentTarget, events: dayEvents })
                    }
                    sx={{
                      alignSelf: "flex-start",
                      border: "none",
                      bgcolor: "transparent",
                      cursor: "pointer",
                      p: 0,
                      pl: 0.5,
                      fontSize: 10,
                      fontWeight: 500,
                      color: "text.secondary",
                      "&:hover": { color: "text.primary", textDecoration: "underline" },
                    }}
                  >
                    +{dayEvents.length - MAX_CHIPS_PER_DAY} more
                  </Box>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      <Popover
        open={!!more}
        anchorEl={more?.anchor ?? null}
        onClose={() => setMore(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ p: 1, display: "flex", flexDirection: "column", gap: 0.5, minWidth: 200 }}>
          {more?.events.map((evtItem) => (
            <EventChip
              key={`${evtItem.eventId}-${evtItem.begin}`}
              event={evtItem}
              color={colorFor(evtItem)}
              onClick={() => {
                onEventClick(evtItem);
                setMore(null);
              }}
              onDelete={() => {
                onDeleteEvent(evtItem);
                setMore(null);
              }}
            />
          ))}
        </Box>
      </Popover>
    </Paper>
  );
}
