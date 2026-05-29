import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid2 as Grid,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  TextField,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { ChevronLeft, ChevronRight, Lock, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { CalendarEvent, CalendarEventDraft, CalendarList } from "../services/calendar";
import { useCalendarStore, useAuthStore } from "../stores";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function CalendarPage() {
  const {
    events,
    calendars,
    isLoadingEvents,
    error,
    selectedDate,
    setSelectedDate,
    fetchEvents,
    fetchCalendars,
    createEvent,
    createCalendar,
    deleteEvent,
  } = useCalendarStore();
  const pubkey = useAuthStore((s) => s.pubkey);
  const pubkeyRef = useRef(pubkey);
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [createCalOpen, setCreateCalOpen] = useState(false);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<Set<string>>(new Set());
  const [showAllPublic, setShowAllPublic] = useState(false);
  const theme = useTheme();

  useEffect(() => {
    pubkeyRef.current = pubkey;
  }, [pubkey]);
  useEffect(() => {
    fetchCalendars();
  }, [fetchCalendars]);
  useEffect(() => {
    if (calendars.length > 0 && visibleCalendarIds.size === 0) {
      setVisibleCalendarIds(new Set(calendars.map((c) => c.id)));
    }
  }, [calendars, visibleCalendarIds.size]);

  useEffect(() => {
    if (!showAllPublic && !pubkeyRef.current) return;
    const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const end = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
    const params: Parameters<typeof fetchEvents>[0] = {
      since: Math.floor(start.getTime() / 1000),
      until: Math.floor(end.getTime() / 1000),
    };
    if (!showAllPublic && pubkeyRef.current) params.authors = [pubkeyRef.current];
    fetchEvents(params);
  }, [selectedDate, fetchEvents, showAllPublic]);

  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const toggleCalendar = (calId: string) => {
    setVisibleCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(calId)) next.delete(calId);
      else next.add(calId);
      return next;
    });
  };

  const filteredEvents = events.filter(
    (e) => !e.calendarId || visibleCalendarIds.has(e.calendarId),
  );

  const getEventsForDay = (day: number) => {
    const dayStart = new Date(year, month, day).getTime();
    const dayEnd = dayStart + 86400000;
    return filteredEvents.filter((e) => e.begin >= dayStart && e.begin < dayEnd);
  };

  const upcomingEvents = filteredEvents
    .filter((e) => e.begin >= Date.now())
    .sort((a, b) => a.begin - b.begin)
    .slice(0, 9);

  return (
    <Box sx={{ display: "flex", gap: 0, mx: { xs: -2, sm: -3, lg: -4 } }}>
      {/* Calendar sidebar */}
      <Box
        component="aside"
        sx={{
          width: 208,
          flexShrink: 0,
          borderRight: `1px solid ${theme.palette.divider}`,
          px: 1.5,
          py: 2,
          display: { xs: "none", sm: "block" },
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "text.secondary",
            px: 0.5,
            mb: 1,
            display: "block",
          }}
        >
          My Calendars
        </Typography>

        <Box
          sx={{
            maxHeight: 256,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 0.25,
            mb: 1,
          }}
        >
          {calendars.map((cal) => (
            <Box
              key={cal.id}
              component="label"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 0.5,
                py: 0.75,
                borderRadius: 1,
                cursor: "pointer",
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Checkbox
                size="small"
                checked={visibleCalendarIds.has(cal.id)}
                onChange={() => toggleCalendar(cal.id)}
                sx={{ p: 0 }}
              />
              <Box
                component="span"
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  flexShrink: 0,
                  bgcolor: cal.color || "primary.main",
                }}
              />
              <Typography variant="caption" noWrap>
                {cal.title || "Untitled"}
              </Typography>
            </Box>
          ))}
          {calendars.length === 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
              No calendars yet
            </Typography>
          )}
        </Box>

        <Button
          size="small"
          variant="text"
          startIcon={<Plus size={12} />}
          onClick={() => setCreateCalOpen(true)}
          sx={{
            color: "text.secondary",
            fontSize: 12,
            justifyContent: "flex-start",
            px: 0.5,
            mb: 0.5,
          }}
        >
          New Calendar
        </Button>

        <Divider sx={{ my: 0.75 }} />

        <Box
          component="label"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 0.5,
            py: 0.75,
            borderRadius: 1,
            cursor: "pointer",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <Checkbox
            size="small"
            checked={showAllPublic}
            onChange={(e) => setShowAllPublic(e.target.checked)}
            sx={{ p: 0 }}
          />
          <Typography variant="caption">Show All Public</Typography>
        </Box>
      </Box>

      {/* Main content */}
      <Box sx={{ flex: 1, minWidth: 0, px: { xs: 2, sm: 3, lg: 4 } }}>
        {/* Header */}
        <Box
          sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2.5 }}
        >
          <Typography variant="h6" fontWeight={600}>
            Calendar
          </Typography>
          <Button
            variant="contained"
            size="small"
            startIcon={<Plus size={16} />}
            onClick={() => setCreateEventOpen(true)}
          >
            New Event
          </Button>
        </Box>

        {error && (
          <Typography variant="body2" color="error" sx={{ mb: 2 }}>
            {error}
          </Typography>
        )}

        {/* Month navigation */}
        <Box
          sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1.5, mb: 2 }}
        >
          <IconButton size="small" onClick={() => setSelectedDate(new Date(year, month - 1, 1))}>
            <ChevronLeft size={18} />
          </IconButton>
          <Typography variant="body1" fontWeight={600} sx={{ width: 144, textAlign: "center" }}>
            {MONTHS[month]} {year}
          </Typography>
          <IconButton size="small" onClick={() => setSelectedDate(new Date(year, month + 1, 1))}>
            <ChevronRight size={18} />
          </IconButton>
        </Box>

        {/* Calendar grid */}
        {isLoadingEvents ? (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "1px" }}>
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} variant="rectangular" height={80} />
            ))}
          </Box>
        ) : (
          <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: "hidden" }}>
            {/* Day headers */}
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

            {/* Weeks */}
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
              {/* Empty leading cells */}
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

              {/* Day cells */}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const dayEvents = getEventsForDay(day);
                const isToday =
                  day === today.getDate() &&
                  month === today.getMonth() &&
                  year === today.getFullYear();
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
                      {dayEvents.slice(0, 2).map((evt) => {
                        const calColor = evt.calendarId
                          ? calendars.find((c) => c.id === evt.calendarId)?.color ||
                            theme.palette.primary.main
                          : theme.palette.primary.main;
                        return (
                          <Box
                            key={evt.eventId}
                            onClick={() => setDetailEvent(evt)}
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
                            {evt.isPrivate && <Lock size={8} />}
                            <Box
                              component="span"
                              sx={{
                                flex: 1,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {evt.title}
                            </Box>
                            <Box
                              className="evt-del"
                              component="button"
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                deleteEvent(evt.eventId);
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
        )}

        {/* Upcoming Events */}
        {upcomingEvents.length > 0 && (
          <Box sx={{ mt: 4 }}>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1.5 }}>
              Upcoming Events
            </Typography>
            <Grid container spacing={1.5}>
              {upcomingEvents.map((evt) => (
                <Grid key={evt.eventId} size={{ xs: 12, sm: 6, lg: 4 }}>
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      borderRadius: 1.5,
                      cursor: "pointer",
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                    onClick={() => setDetailEvent(evt)}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 1,
                      }}
                    >
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
                        {evt.isPrivate && <Lock size={12} color={theme.palette.text.secondary} />}
                        <Typography variant="body2" fontWeight={500} noWrap>
                          {evt.title}
                        </Typography>
                      </Box>
                      {evt.isPrivate && <Chip label="Private" size="small" />}
                    </Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                      sx={{ mt: 0.5 }}
                    >
                      {new Date(evt.begin).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Typography>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}
      </Box>

      <CreateEventDialog
        open={createEventOpen}
        onClose={() => setCreateEventOpen(false)}
        onCreate={createEvent}
        calendars={calendars}
      />
      <CreateCalendarDialog
        open={createCalOpen}
        onClose={() => setCreateCalOpen(false)}
        onCreate={createCalendar}
      />
      <EventDetailDialog
        event={detailEvent}
        onClose={() => setDetailEvent(null)}
        onDelete={(id) => {
          deleteEvent(id);
          setDetailEvent(null);
        }}
      />
    </Box>
  );
}

// ── Create Event Dialog ───────────────────────────────────

function CreateEventDialog({
  open,
  onClose,
  onCreate,
  calendars,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (draft: CalendarEventDraft) => Promise<unknown>;
  calendars: CalendarList[];
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [begin, setBegin] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState("");
  const [calendarId, setCalendarId] = useState("none");
  const [isPrivate, setIsPrivate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!title || !begin || !end) return;
    setIsSubmitting(true);
    try {
      await onCreate({
        title,
        description,
        begin: new Date(begin),
        end: new Date(end),
        location: location || undefined,
        calendarId: calendarId === "none" ? undefined : calendarId,
        isPrivate,
      });
      setTitle("");
      setDescription("");
      setBegin("");
      setEnd("");
      setLocation("");
      setCalendarId("none");
      setIsPrivate(false);
      onClose();
    } catch {
      /* handled by store */
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>New Event</DialogTitle>
      <DialogContentText sx={{ px: 3, pb: 0 }}>
        Schedule an event on the Nostr network.
      </DialogContentText>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 2 }}>
        <TextField
          label="Title"
          size="small"
          fullWidth
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
          <TextField
            label="Start"
            size="small"
            type="datetime-local"
            value={begin}
            onChange={(e) => setBegin(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="End"
            size="small"
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Box>
        <TextField
          label="Location (optional)"
          size="small"
          fullWidth
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <TextField
          label="Description (optional)"
          size="small"
          fullWidth
          multiline
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {calendars.length > 0 && (
          <FormControl size="small" fullWidth>
            <Select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              <MenuItem value="none">None</MenuItem>
              {calendars.map((cal) => (
                <MenuItem key={cal.id} value={cal.id}>
                  {cal.title || "Untitled"}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
          }
          label={
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Lock size={12} />
              <Typography variant="body2">Private (encrypted)</Typography>
            </Box>
          }
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={!title || !begin || !end || isSubmitting}
        >
          {isSubmitting ? "Creating…" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Create Calendar Dialog ────────────────────────────────

function CreateCalendarDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string, color: string) => Promise<unknown>;
}) {
  const [title, setTitle] = useState("");
  const [color, setColor] = useState("#334155");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!title) return;
    setIsSubmitting(true);
    try {
      await onCreate(title, color);
      setTitle("");
      setColor("#334155");
      onClose();
    } catch {
      /* handled */
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>New Calendar</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 2 }}>
        <TextField
          label="Calendar name"
          size="small"
          fullWidth
          placeholder="My Calendar"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
            Color
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box
              component="input"
              type="color"
              value={color}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setColor(e.target.value)}
              sx={{
                width: 48,
                height: 32,
                borderRadius: 1,
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "transparent",
                cursor: "pointer",
                p: 0.25,
              }}
            />
            <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
              {color}
            </Typography>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleCreate} disabled={!title || isSubmitting}>
          {isSubmitting ? "Creating…" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Event Detail Dialog ───────────────────────────────────

function EventDetailDialog({
  event,
  onClose,
  onDelete,
}: {
  event: CalendarEvent | null;
  onClose: () => void;
  onDelete: (eventId: string) => void;
}) {
  if (!event) return null;
  const formatDate = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <Dialog open={!!event} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {event.isPrivate && <Lock size={16} />}
        {event.title}
      </DialogTitle>
      {event.description && (
        <DialogContentText sx={{ px: 3, pb: 0 }}>{event.description}</DialogContentText>
      )}
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {[
            { label: "Start", value: formatDate(event.begin) },
            { label: "End", value: formatDate(event.end) },
            ...(event.location.length > 0
              ? [{ label: "Location", value: event.location.join(", ") }]
              : []),
          ].map((row) => (
            <Box key={row.label} sx={{ display: "flex", gap: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ width: 60, flexShrink: 0 }}>
                {row.label}
              </Typography>
              <Typography variant="body2">{row.value}</Typography>
            </Box>
          ))}
          {event.categories.length > 0 && (
            <Box sx={{ display: "flex", gap: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ width: 60, flexShrink: 0 }}>
                Tags
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {event.categories.map((cat) => (
                  <Chip key={cat} label={cat} size="small" />
                ))}
              </Box>
            </Box>
          )}
          {event.isPrivate && (
            <Chip
              icon={<Lock size={11} />}
              label="Private / Encrypted"
              size="small"
              variant="outlined"
              sx={{ alignSelf: "flex-start" }}
            />
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button color="error" variant="outlined" onClick={() => onDelete(event.eventId)}>
          Delete
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
