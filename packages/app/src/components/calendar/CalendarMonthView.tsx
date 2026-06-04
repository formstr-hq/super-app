import { Box, Paper, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Lock, X } from "lucide-react";

import { expandEvents } from "../../lib/rrule";
import type { CalendarEvent, CalendarList } from "../../services/calendar";

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

  const expanded = expandEvents(
    events,
    new Date(year, month, 1),
    new Date(year, month + 1, 0, 23, 59, 59),
  );

  const eventsForDay = (day: number) => {
    const dayStart = new Date(year, month, day).getTime();
    const dayEnd = dayStart + 86400000;
    return expanded.filter((e) => e.begin >= dayStart && e.begin < dayEnd);
  };
  const colorFor = (e: CalendarEvent) =>
    (e.calendarId ? calendars.find((c) => c.id === e.calendarId)?.color : undefined) ??
    theme.palette.primary.main;

  return (
    <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: "hidden" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          borderBottom: `1px solid ${theme.palette.divider}`,
          bgcolor: "action.hover",
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

      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
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
                {dayEvents.slice(0, 2).map((evtItem) => {
                  const calColor = colorFor(evtItem);
                  return (
                    <Box
                      key={`${evtItem.eventId}-${evtItem.begin}`}
                      onClick={() => onEventClick(evtItem)}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.25,
                        borderRadius: 0.5,
                        px: 0.5,
                        py: 0.25,
                        fontSize: 10,
                        fontWeight: 500,
                        lineHeight: 1.3,
                        cursor: "pointer",
                        bgcolor: calColor + "22",
                        color: calColor,
                        "&:hover .evt-del": { opacity: 1 },
                      }}
                    >
                      {evtItem.isPrivate && <Lock size={8} />}
                      <Box
                        component="span"
                        sx={{
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {evtItem.title}
                      </Box>
                      <Box
                        className="evt-del"
                        component="button"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          onDeleteEvent(evtItem);
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
                })}
                {dayEvents.length > 2 && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontSize: 10, pl: 0.5 }}
                  >
                    +{dayEvents.length - 2} more
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}
