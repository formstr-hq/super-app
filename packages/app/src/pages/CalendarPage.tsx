import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useCalendarStore, useAuthStore } from "../stores";
import type { CalendarEvent, CalendarEventDraft, CalendarList } from "../services/calendar";

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
    // Guard: when not showing all public, require a pubkey to avoid fetching everything
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

  const filteredEvents = events.filter((e) => {
    if (!e.calendarId) return true;
    return visibleCalendarIds.has(e.calendarId);
  });

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
    <div className="flex gap-0 -mx-4 sm:-mx-6 lg:-mx-8">
      {/* Calendar sidebar */}
      <aside className="w-56 shrink-0 border-r border-border px-3 py-4 space-y-1 hidden sm:block">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-2">
          My Calendars
        </p>

        <ScrollArea className="max-h-64">
          <div className="space-y-0.5">
            {calendars.map((cal) => (
              <label
                key={cal.id}
                className="flex items-center gap-2 px-1 py-1 rounded-md hover:bg-accent cursor-pointer transition-colors duration-150"
              >
                <Checkbox
                  checked={visibleCalendarIds.has(cal.id)}
                  onCheckedChange={() => toggleCalendar(cal.id)}
                  className="h-3.5 w-3.5"
                />
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: cal.color || "hsl(var(--primary))" }}
                />
                <span className="text-xs text-foreground truncate">{cal.title || "Untitled"}</span>
              </label>
            ))}
            {calendars.length === 0 && (
              <p className="text-xs text-muted-foreground px-1">No calendars yet</p>
            )}
          </div>
        </ScrollArea>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCreateCalOpen(true)}
          className="gap-1.5 h-7 text-xs w-full justify-start px-1 text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          New Calendar
        </Button>

        <Separator className="my-1" />

        <label className="flex items-center gap-2 px-1 py-1 rounded-md hover:bg-accent cursor-pointer transition-colors duration-150">
          <Checkbox
            checked={showAllPublic}
            onCheckedChange={(v) => setShowAllPublic(!!v)}
            className="h-3.5 w-3.5"
          />
          <span className="text-xs text-foreground">Show All Public</span>
        </label>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-foreground">Calendar</h1>
          <Button size="sm" onClick={() => setCreateEventOpen(true)} className="gap-1.5 h-8">
            <Plus className="h-3.5 w-3.5" />
            New Event
          </Button>
        </div>

        {error && <p className="text-sm text-destructive mb-3">{error}</p>}

        {/* Month navigation */}
        <div className="flex items-center justify-center gap-3 mb-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setSelectedDate(new Date(year, month - 1, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-base font-semibold w-36 text-center">
            {MONTHS[month]} {year}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setSelectedDate(new Date(year, month + 1, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Calendar grid */}
        {isLoadingEvents ? (
          <div className="grid grid-cols-7 gap-px">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-none" />
            ))}
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-border bg-muted/40">
              {DAYS.map((day) => (
                <div
                  key={day}
                  className="py-2 text-center text-xs font-medium text-muted-foreground"
                >
                  <span className="hidden sm:inline">{day}</span>
                  <span className="sm:hidden">{day[0]}</span>
                </div>
              ))}
            </div>

            {/* Weeks */}
            <div className="grid grid-cols-7">
              {/* Empty cells */}
              {Array.from({ length: firstDay }, (_, i) => (
                <div
                  key={`pre-${i}`}
                  className="min-h-18 border-b border-r border-border bg-muted/20"
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
                  <div
                    key={day}
                    className={cn(
                      "min-h-18 border-border p-1.5",
                      "border-r border-b last:border-r-0",
                      isLastRow && "border-b-0",
                      (cellIndex + 1) % 7 === 0 && "border-r-0",
                    )}
                  >
                    <span
                      className={cn(
                        "text-xs font-medium flex h-5 w-5 items-center justify-center rounded-full mb-1",
                        isToday
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {day}
                    </span>

                    <div className="space-y-0.5">
                      {dayEvents.slice(0, 2).map((evt) => (
                        <div
                          key={evt.eventId}
                          className="group/evt flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium leading-tight cursor-pointer"
                          onClick={() => setDetailEvent(evt)}
                          style={{
                            backgroundColor: evt.calendarId
                              ? (calendars.find((c) => c.id === evt.calendarId)?.color ||
                                  "hsl(var(--primary))") + "22"
                              : "hsl(var(--primary) / 0.15)",
                            color: evt.calendarId
                              ? calendars.find((c) => c.id === evt.calendarId)?.color ||
                                "hsl(var(--primary))"
                              : "hsl(var(--primary))",
                          }}
                        >
                          {evt.isPrivate && <Lock className="h-2 w-2 shrink-0" />}
                          <span className="truncate flex-1">{evt.title}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteEvent(evt.eventId);
                            }}
                            className="opacity-0 group-hover/evt:opacity-100 transition-opacity shrink-0"
                            aria-label="Delete event"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <span className="text-[10px] text-muted-foreground px-1">
                          +{dayEvents.length - 2} more
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Upcoming Events */}
        {upcomingEvents.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-foreground mb-3">Upcoming Events</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {upcomingEvents.map((evt) => (
                <Card
                  key={evt.eventId}
                  className="border-border cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => setDetailEvent(evt)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {evt.isPrivate && (
                          <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                        <p className="text-sm font-medium text-foreground truncate">{evt.title}</p>
                      </div>
                      {evt.isPrivate && (
                        <Badge variant="secondary" className="text-xs shrink-0 h-4 py-0">
                          Private
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(evt.begin).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

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
        onDelete={(eventId) => {
          deleteEvent(eventId);
          setDetailEvent(null);
        }}
      />
    </div>
  );
}

// ── Create Event Dialog ───────────────────────────────────────

interface CreateEventDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (draft: CalendarEventDraft) => Promise<unknown>;
  calendars: CalendarList[];
}

function CreateEventDialog({ open, onClose, onCreate, calendars }: CreateEventDialogProps) {
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
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Event</DialogTitle>
          <DialogDescription>Schedule an event on the Nostr network.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="evt-title" className="text-xs">
              Title
            </Label>
            <Input
              id="evt-title"
              placeholder="Event title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="evt-begin" className="text-xs">
                Start
              </Label>
              <Input
                id="evt-begin"
                type="datetime-local"
                value={begin}
                onChange={(e) => setBegin(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="evt-end" className="text-xs">
                End
              </Label>
              <Input
                id="evt-end"
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="evt-location" className="text-xs">
              Location (optional)
            </Label>
            <Input
              id="evt-location"
              placeholder="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="evt-desc" className="text-xs">
              Description (optional)
            </Label>
            <textarea
              id="evt-desc"
              rows={2}
              placeholder="Description…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {calendars.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Calendar</Label>
              <Select value={calendarId} onValueChange={setCalendarId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {calendars.map((cal) => (
                    <SelectItem key={cal.id} value={cal.id}>
                      {cal.title || "Untitled"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={isPrivate}
              onCheckedChange={(v) => setIsPrivate(!!v)}
              className="h-4 w-4"
            />
            <div className="flex items-center gap-1.5">
              <Lock className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-foreground">Private (encrypted)</span>
            </div>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!title || !begin || !end || isSubmitting}
          >
            {isSubmitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Calendar Dialog ────────────────────────────────────

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
      /* handled by store */
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>New Calendar</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cal-name" className="text-xs">
              Calendar name
            </Label>
            <Input
              id="cal-name"
              placeholder="My Calendar"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cal-color" className="text-xs">
              Color
            </Label>
            <div className="flex items-center gap-2">
              <input
                id="cal-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-14 rounded border border-input bg-background cursor-pointer p-1"
              />
              <span className="text-xs text-muted-foreground font-mono">{color}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleCreate} disabled={!title || isSubmitting}>
            {isSubmitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Event Detail Dialog ───────────────────────────────────────

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
    <Dialog open={!!event} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {event.isPrivate && <Lock className="h-4 w-4 text-muted-foreground" />}
            {event.title}
          </DialogTitle>
          {event.description && <DialogDescription>{event.description}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-3">
            <span className="text-muted-foreground w-16 shrink-0">Start</span>
            <span className="text-foreground">{formatDate(event.begin)}</span>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-muted-foreground w-16 shrink-0">End</span>
            <span className="text-foreground">{formatDate(event.end)}</span>
          </div>
          {event.location.length > 0 && (
            <div className="flex items-start gap-3">
              <span className="text-muted-foreground w-16 shrink-0">Location</span>
              <span className="text-foreground">{event.location.join(", ")}</span>
            </div>
          )}
          {event.categories.length > 0 && (
            <div className="flex items-start gap-3">
              <span className="text-muted-foreground w-16 shrink-0">Tags</span>
              <div className="flex flex-wrap gap-1">
                {event.categories.map((cat) => (
                  <Badge key={cat} variant="secondary" className="text-xs">
                    {cat}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {event.isPrivate && (
            <Badge variant="outline" className="text-xs gap-1">
              <Lock className="h-2.5 w-2.5" />
              Private / Encrypted
            </Badge>
          )}
        </div>

        <DialogFooter>
          <Button variant="destructive" size="sm" onClick={() => onDelete(event.eventId)}>
            Delete
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
