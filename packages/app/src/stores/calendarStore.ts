import { create } from "zustand";

import type { CalendarEvent, CalendarList, CalendarEventDraft } from "../services/calendar";
import * as calendarService from "../services/calendar/service";

interface CalendarStore {
  events: CalendarEvent[];
  calendars: CalendarList[];
  isLoadingEvents: boolean;
  isLoadingCalendars: boolean;
  error: string | null;
  selectedDate: Date;

  setSelectedDate(date: Date): void;
  fetchEvents(params?: calendarService.FetchCalendarEventsParams): Promise<void>;
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

  async fetchEvents(params) {
    set({ isLoadingEvents: true, error: null });
    try {
      const events = await calendarService.fetchCalendarEventsSync(params ?? {});
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
      const event = draft.isPrivate
        ? await calendarService.publishPrivateCalendarEvent(draft, draft.calendarId ?? "default")
        : await calendarService.publishPublicCalendarEvent(draft);
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
      const event = draft.isPrivate
        ? await calendarService.publishPrivateCalendarEvent(draft, draft.calendarId ?? "default")
        : await calendarService.publishPublicCalendarEvent(draft);

      // Add event ref to the calendar list if a calendarId was specified.
      // The ref is the bare coordinate (the codec re-adds the "a" tag prefix);
      // private events carry their shared viewKey so invitees can decrypt.
      if (draft.calendarId) {
        const calendar = get().calendars.find((c) => c.id === draft.calendarId);
        if (calendar) {
          const ref: string[] = [
            `${event.kind}:${event.user}:${event.id}`,
            "",
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
      await calendarService.deleteCalendarEvent(id, coordinate);
      set((state) => ({ events: state.events.filter((e) => e.id !== id) }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to delete event" });
    }
  },
}));
