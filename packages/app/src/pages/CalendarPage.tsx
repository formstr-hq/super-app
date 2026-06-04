import {
  Box,
  Button,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CalendarListView } from "../components/calendar/CalendarListView";
import { CalendarMonthView } from "../components/calendar/CalendarMonthView";
import { CalendarSidebar } from "../components/calendar/CalendarSidebar";
import { CreateCalendarDialog } from "../components/calendar/CreateCalendarDialog";
import { EventDetailsDialog } from "../components/calendar/EventDetailsDialog";
import { EventDialog } from "../components/calendar/EventDialog";
import { InvitationInbox } from "../components/calendar/InvitationInbox";
import type { CalendarEvent } from "../services/calendar";
import { useAuthStore, useCalendarStore } from "../stores";

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
    error,
    selectedDate,
    setSelectedDate,
    fetchEvents,
    fetchCalendars,
    createEvent,
    updateEvent,
    createCalendar,
    deleteEvent,
  } = useCalendarStore();
  const pubkey = useAuthStore((s) => s.pubkey);
  const pubkeyRef = useRef(pubkey);

  const [viewMode, setViewMode] = useState<"month" | "list">("month");
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [createCalOpen, setCreateCalOpen] = useState(false);
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<Set<string>>(new Set());
  const [showAllPublic, setShowAllPublic] = useState(false);

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

  const toggleCalendar = (calId: string) =>
    setVisibleCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(calId)) next.delete(calId);
      else next.add(calId);
      return next;
    });

  const filteredEvents = events.filter(
    (e) => !e.calendarId || visibleCalendarIds.has(e.calendarId),
  );

  const handleDelete = (event: CalendarEvent) => {
    deleteEvent(event.id, `${event.kind}:${event.user}:${event.id}`);
    setDetailEvent(null);
  };

  const openCreate = () => {
    setEditEvent(null);
    setEventDialogOpen(true);
  };
  const openEdit = (event: CalendarEvent) => {
    setDetailEvent(null);
    setEditEvent(event);
    setEventDialogOpen(true);
  };

  return (
    <Box sx={{ display: "flex", gap: 0, mx: { xs: -2, sm: -3, lg: -4 } }}>
      <CalendarSidebar
        calendars={calendars}
        visibleCalendarIds={visibleCalendarIds}
        onToggleCalendar={toggleCalendar}
        onNewCalendar={() => setCreateCalOpen(true)}
        showAllPublic={showAllPublic}
        onToggleShowAllPublic={setShowAllPublic}
      />

      <Box sx={{ flex: 1, minWidth: 0, px: { xs: 2, sm: 3, lg: 4 } }}>
        <Box
          sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2.5 }}
        >
          <Typography variant="h6" fontWeight={600}>
            Calendar
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={viewMode}
              onChange={(_, v) => v && setViewMode(v)}
            >
              <ToggleButton value="month">Month</ToggleButton>
              <ToggleButton value="list">List</ToggleButton>
            </ToggleButtonGroup>
            <Button
              variant="contained"
              size="small"
              startIcon={<Plus size={16} />}
              onClick={openCreate}
            >
              New Event
            </Button>
          </Box>
        </Box>

        {error && (
          <Typography variant="body2" color="error" sx={{ mb: 2 }}>
            {error}
          </Typography>
        )}

        <InvitationInbox />

        {viewMode === "month" && (
          <>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 1.5,
                mb: 2,
              }}
            >
              <IconButton
                size="small"
                onClick={() => setSelectedDate(new Date(year, month - 1, 1))}
              >
                <ChevronLeft size={18} />
              </IconButton>
              <Typography variant="body1" fontWeight={600} sx={{ width: 144, textAlign: "center" }}>
                {MONTHS[month]} {year}
              </Typography>
              <IconButton
                size="small"
                onClick={() => setSelectedDate(new Date(year, month + 1, 1))}
              >
                <ChevronRight size={18} />
              </IconButton>
            </Box>
            <CalendarMonthView
              events={filteredEvents}
              year={year}
              month={month}
              calendars={calendars}
              onEventClick={setDetailEvent}
              onDeleteEvent={handleDelete}
            />
          </>
        )}

        {viewMode === "list" && (
          <CalendarListView events={filteredEvents} onEventClick={setDetailEvent} />
        )}
      </Box>

      <EventDialog
        open={eventDialogOpen}
        onClose={() => setEventDialogOpen(false)}
        onSubmit={(draft) => (draft.existingId ? updateEvent(draft) : createEvent(draft))}
        calendars={calendars}
        event={editEvent}
      />
      <CreateCalendarDialog
        open={createCalOpen}
        onClose={() => setCreateCalOpen(false)}
        onCreate={createCalendar}
      />
      <EventDetailsDialog
        event={detailEvent}
        currentUserPubkey={pubkey}
        onClose={() => setDetailEvent(null)}
        onEdit={openEdit}
        onDelete={handleDelete}
      />
    </Box>
  );
}
