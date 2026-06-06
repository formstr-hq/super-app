import { Box, Typography } from "@mui/material";
import { useEffect, useState } from "react";

import { BookingsView } from "../components/calendar/BookingsView";
import { CalendarHeader } from "../components/calendar/CalendarHeader";
import { CalendarListView } from "../components/calendar/CalendarListView";
import { CalendarManageDialog } from "../components/calendar/CalendarManageDialog";
import { CalendarMonthView } from "../components/calendar/CalendarMonthView";
import { CalendarSidebar } from "../components/calendar/CalendarSidebar";
import { EventDetailsDialog } from "../components/calendar/EventDetailsDialog";
import { EventDialog } from "../components/calendar/EventDialog";
import { InvitationsView } from "../components/calendar/InvitationsView";
import { filterEventsByCalendarVisibility } from "../lib/calendarMembership";
import type { CalendarEvent, CalendarList } from "../services/calendar";
import { CALENDAR_KINDS } from "../services/calendar";
import { useAuthStore, useBookingStore, useCalendarStore } from "../stores";
import { useInvitationsStore } from "../stores/invitationsStore";

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
    updateCalendar,
    deleteCalendar,
    deleteEvent,
  } = useCalendarStore();
  const pubkey = useAuthStore((s) => s.pubkey);
  const pendingInvitations = useInvitationsStore(
    (s) => s.invitations.filter((i) => !i.rsvp).length,
  );
  const schedulingPages = useBookingStore((s) => s.schedulingPages);
  const pendingBookings = useBookingStore(
    (s) => s.requests.filter((r) => r.status === "pending").length,
  );
  const fetchBookings = useBookingStore((s) => s.fetchAll);

  const [view, setView] = useState<"calendar" | "invitations" | "bookings">("calendar");
  const [viewMode, setViewMode] = useState<"month" | "list">("month");
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [editCalendar, setEditCalendar] = useState<CalendarList | null>(null);
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<Set<string>>(new Set());
  const [showAllPublic, setShowAllPublic] = useState(false);

  useEffect(() => {
    fetchCalendars();
  }, [fetchCalendars]);
  useEffect(() => {
    if (pubkey) fetchBookings();
  }, [pubkey, fetchBookings]);
  useEffect(() => {
    if (calendars.length > 0 && visibleCalendarIds.size === 0) {
      setVisibleCalendarIds(new Set(calendars.map((c) => c.id)));
    }
  }, [calendars, visibleCalendarIds.size]);
  // Fetch events independent of the viewed month: relays filter `since`/`until`
  // on publish time, not the event's start, so a month-coupled window drops
  // events created in a different month than they occur. We fetch the user's
  // events broadly (+ private members once calendars load) and the views filter
  // by date client-side. Month navigation is purely client-side. "Show all
  // public" browses a recent window of public events instead.
  useEffect(() => {
    if (!showAllPublic && !pubkey) return;
    const opts = showAllPublic
      ? { since: Math.floor((Date.now() - 1000 * 60 * 60 * 24 * 90) / 1000) }
      : { authors: [pubkey!] };
    fetchEvents(opts);
  }, [fetchEvents, showAllPublic, pubkey, calendars.length]);

  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const monthLabel = selectedDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const toggleCalendar = (calId: string) =>
    setVisibleCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(calId)) next.delete(calId);
      else next.add(calId);
      return next;
    });

  const filteredEvents = filterEventsByCalendarVisibility(events, calendars, visibleCalendarIds);

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
  const openNewCalendar = () => {
    setEditCalendar(null);
    setManageOpen(true);
  };
  const openEditCalendar = (calendar: CalendarList) => {
    setEditCalendar(calendar);
    setManageOpen(true);
  };

  return (
    <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
      <CalendarSidebar
        calendars={calendars}
        visibleCalendarIds={visibleCalendarIds}
        onToggleCalendar={toggleCalendar}
        onNewCalendar={openNewCalendar}
        onEditCalendar={openEditCalendar}
        showAllPublic={showAllPublic}
        onToggleShowAllPublic={setShowAllPublic}
        pendingInvitations={pendingInvitations}
        view={view}
        onOpenInvitations={() => setView("invitations")}
        schedulingPages={schedulingPages}
        pendingBookings={pendingBookings}
        onOpenBookings={() => setView("bookings")}
      />

      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          p: { xs: 2, sm: 3 },
        }}
      >
        {view === "invitations" ? (
          <InvitationsView onBack={() => setView("calendar")} />
        ) : view === "bookings" ? (
          <BookingsView onBack={() => setView("calendar")} />
        ) : (
          <>
            <CalendarHeader
              monthLabel={monthLabel}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onPrev={() => setSelectedDate(new Date(year, month - 1, 1))}
              onNext={() => setSelectedDate(new Date(year, month + 1, 1))}
              onToday={() => setSelectedDate(new Date())}
              onNewEvent={openCreate}
            />

            {error && (
              <Typography variant="body2" color="error" sx={{ mb: 2 }}>
                {error}
              </Typography>
            )}

            {viewMode === "month" && (
              <CalendarMonthView
                events={filteredEvents}
                year={year}
                month={month}
                calendars={calendars}
                onEventClick={setDetailEvent}
                onDeleteEvent={handleDelete}
              />
            )}

            {viewMode === "list" && (
              <CalendarListView
                events={filteredEvents}
                year={year}
                month={month}
                calendars={calendars}
                onEventClick={setDetailEvent}
              />
            )}
          </>
        )}
      </Box>

      <EventDialog
        open={eventDialogOpen}
        onClose={() => setEventDialogOpen(false)}
        onSubmit={(draft) => (draft.existingId ? updateEvent(draft) : createEvent(draft))}
        calendars={calendars}
        event={editEvent}
      />
      <CalendarManageDialog
        open={manageOpen}
        calendar={editCalendar}
        onClose={() => setManageOpen(false)}
        onSave={({ id, title, color, description }) =>
          id && editCalendar
            ? updateCalendar({ ...editCalendar, title, color, description })
            : createCalendar(title, color, description)
        }
        onDelete={
          editCalendar
            ? (cal) => {
                deleteCalendar(`${CALENDAR_KINDS.calendarList}:${pubkey}:${cal.id}`, cal.id);
                setManageOpen(false);
              }
            : undefined
        }
      />
      <EventDetailsDialog
        event={detailEvent}
        currentUserPubkey={pubkey}
        calendars={calendars}
        onClose={() => setDetailEvent(null)}
        onEdit={openEdit}
        onDelete={handleDelete}
      />
    </Box>
  );
}
