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
  createCalendar(title: string, color: string): Promise<CalendarList>;
  deleteEvent(eventId: string, coordinate?: string): Promise<void>;
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

  async createEvent(draft) {
    set({ error: null });
    try {
      const event = draft.isPrivate
        ? await calendarService.publishPrivateCalendarEvent(draft, draft.calendarId ?? "default")
        : await calendarService.publishPublicCalendarEvent(draft);

      // Add event ref to the calendar list if a calendarId was specified
      if (draft.calendarId) {
        const calendar = get().calendars.find((c) => c.id === draft.calendarId);
        if (calendar) {
          const ref: string[] = ["a", `${event.kind}:${event.user}:${event.id}`, "", ""];
          const updatedCalendar = {
            ...calendar,
            eventRefs: [...calendar.eventRefs, ref],
          };
          try {
            const saved = await calendarService.updateCalendarList(updatedCalendar);
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

  async createCalendar(title, color) {
    set({ error: null });
    try {
      const calendar = await calendarService.createCalendarList(title, color);
      set((state) => ({ calendars: [...state.calendars, calendar] }));
      return calendar;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to create calendar" });
      throw e;
    }
  },

  async deleteEvent(eventId, coordinate) {
    try {
      await calendarService.deleteCalendarEvent(eventId, coordinate);
      set((state) => ({ events: state.events.filter((e) => e.eventId !== eventId) }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to delete event" });
    }
  },
}));
