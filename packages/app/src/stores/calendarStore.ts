import type {
  CalendarEvent,
  CalendarList,
  CalendarEventDraft,
} from "@formstr/agent/services/calendar";
import { addBusyRange, removeBusyRange } from "@formstr/agent/services/calendar/busyList";
import * as calendarService from "@formstr/agent/services/calendar/service";
import { create } from "zustand";

import { useSettingsStore } from "./settingsStore";

/**
 * Best-effort kind-31926 busy-list upkeep. The hosted booking page
 * (calendar.formstr.app/schedule/…) computes slot availability from these, so
 * without them every super-app slot looks free to bookers. Recurring events
 * are skipped — public busy lists store only raw [start,end] ranges (upstream
 * behavior). Never blocks the event flow on relay roundtrips. Publishing is
 * gated on the device-local opt-out; retraction is NOT (deleting an event must
 * still clean up ranges published before the user opted out).
 */
function publishBusyRangeFor(event: CalendarEvent): void {
  if (!useSettingsStore.getState().publishBusyTimes) return;
  if (event.repeat.rrule) return;
  void addBusyRange({ start: event.begin, end: event.end }).catch(() => {});
}

function retractBusyRangeFor(event: CalendarEvent): void {
  if (event.repeat.rrule) return;
  void removeBusyRange({ start: event.begin, end: event.end }).catch(() => {});
}

interface CalendarStore {
  events: CalendarEvent[];
  calendars: CalendarList[];
  isLoadingEvents: boolean;
  isLoadingCalendars: boolean;
  error: string | null;
  selectedDate: Date;

  setSelectedDate(date: Date): void;
  fetchEvents(opts?: { authors?: string[]; since?: number; until?: number }): Promise<void>;
  fetchCalendars(): Promise<void>;
  createEvent(draft: CalendarEventDraft): Promise<CalendarEvent>;
  createCalendar(title: string, color: string, description?: string): Promise<CalendarList>;
  updateCalendar(calendar: CalendarList): Promise<CalendarList>;
  deleteCalendar(coordinate: string, id: string): Promise<void>;
  deleteEvent(id: string, coordinate?: string): Promise<void>;
  ingestEvent(event: CalendarEvent): void;
  updateEvent(draft: CalendarEventDraft): Promise<CalendarEvent>;
}

export const useCalendarStore = create<CalendarStore>((set, get) => ({
  events: [],
  calendars: [],
  isLoadingEvents: false,
  isLoadingCalendars: false,
  error: null,
  selectedDate: new Date(),

  setSelectedDate(date: Date) {
    set({ selectedDate: date });
  },

  async fetchEvents(opts) {
    set({ isLoadingEvents: true, error: null });
    try {
      // Pass the loaded calendar lists so private members (which carry their
      // viewKeys in eventRefs) are fetched + decrypted alongside direct events.
      const events = await calendarService.fetchCalendarEventsForUser(get().calendars, opts ?? {});
      set({ events, isLoadingEvents: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Failed to fetch events",
        isLoadingEvents: false,
      });
    }
  },

  async fetchCalendars() {
    set({ isLoadingCalendars: true, error: null });
    try {
      const calendars = await calendarService.fetchCalendarLists();
      set({ calendars, isLoadingCalendars: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Failed to fetch calendars",
        isLoadingCalendars: false,
      });
    }
  },

  ingestEvent(event) {
    set((state) =>
      state.events.some((e) => e.id === event.id) ? state : { events: [...state.events, event] },
    );
  },

  async updateEvent(draft) {
    set({ error: null });
    try {
      const previous = get().events.find((e) => e.id === draft.existingId);
      const event = draft.isPrivate
        ? await calendarService.publishPrivateCalendarEvent(draft, draft.calendarId ?? "default")
        : await calendarService.publishPublicCalendarEvent(draft);
      // Swap the public busy entry only when the times actually moved.
      if (previous && (previous.begin !== event.begin || previous.end !== event.end)) {
        retractBusyRangeFor(previous);
        publishBusyRangeFor(event);
      }
      set((state) => ({
        events: state.events.map((e) => (e.id === event.id ? event : e)),
      }));
      return event;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to update event" });
      throw e;
    }
  },

  async createEvent(draft) {
    set({ error: null });
    try {
      // A private event is encrypted with a per-event viewKey that only survives
      // a refresh if it is stored in a calendar list's eventRef (that is also how
      // calendar.formstr.app discovers + decrypts it). So a private event MUST
      // land in a calendar: use the chosen one, else the first existing calendar,
      // else auto-create a default. Public events stay self-decryptable and only
      // link when a calendar is explicitly chosen.
      let targetCalendarId = draft.calendarId;
      if (draft.isPrivate && !targetCalendarId) {
        const existing = get().calendars[0];
        targetCalendarId = existing
          ? existing.id
          : (await get().createCalendar("My Calendar", "#334155")).id;
      }

      const event = draft.isPrivate
        ? await calendarService.publishPrivateCalendarEvent(
            { ...draft, calendarId: targetCalendarId },
            targetCalendarId ?? "default",
          )
        : await calendarService.publishPublicCalendarEvent(draft);

      publishBusyRangeFor(event);

      // Add event ref to the resolved calendar list.
      // The ref is the bare coordinate (the codec re-adds the "a" tag prefix);
      // private events carry their shared viewKey so invitees can decrypt.
      if (targetCalendarId) {
        const calendar = get().calendars.find((c) => c.id === targetCalendarId);
        if (calendar) {
          const ref: string[] = [
            `${event.kind}:${event.user}:${event.id}`,
            event.relayHint ?? "",
            event.viewKey ?? "",
          ];
          try {
            const saved = await calendarService.addEventToCalendarList(calendar, ref);
            set((state) => ({
              calendars: state.calendars.map((c) => (c.id === saved.id ? saved : c)),
            }));
          } catch {
            // Calendar list update failed — event is still created, just not linked
          }
        }
      }

      set((state) => ({ events: [...state.events, event] }));
      return event;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to create event" });
      throw e;
    }
  },

  async createCalendar(title, color, description) {
    set({ error: null });
    try {
      const calendar = await calendarService.createCalendarList(title, color, description);
      set((state) => ({ calendars: [...state.calendars, calendar] }));
      return calendar;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to create calendar" });
      throw e;
    }
  },

  async updateCalendar(calendar) {
    set({ error: null });
    try {
      const saved = await calendarService.updateCalendarList(calendar);
      set((state) => ({
        calendars: state.calendars.map((c) => (c.id === saved.id ? saved : c)),
      }));
      return saved;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to update calendar" });
      throw e;
    }
  },

  async deleteCalendar(coordinate, id) {
    try {
      await calendarService.deleteCalendarList(coordinate);
      set((state) => ({ calendars: state.calendars.filter((c) => c.id !== id) }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to delete calendar" });
    }
  },

  async deleteEvent(id, coordinate) {
    try {
      const deleted = get().events.find((e) => e.id === id);
      await calendarService.deleteCalendarEvent(id, coordinate);
      if (deleted) retractBusyRangeFor(deleted);
      // Remove the event ref from whichever calendar list holds it, then
      // republish that list. Without this the ref survives on the relay and
      // the event re-appears on the next refresh.
      if (coordinate) {
        const owning = get().calendars.find((c) =>
          c.eventRefs.some((ref) => ref[0] === coordinate),
        );
        if (owning) {
          const updated = await calendarService.removeEventFromCalendarList(owning, coordinate);
          set((state) => ({
            calendars: state.calendars.map((c) => (c.id === updated.id ? updated : c)),
          }));
        }
      }
      set((state) => ({ events: state.events.filter((e) => e.id !== id) }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to delete event" });
    }
  },
}));
