import { fetchEventsForUser } from "@formstr/agent/services/calendar/discovery";
import { create } from "zustand";

import { getCalendarSdk } from "../lib/calendar/sdk";
import type { AppCalendarEvent, AppCalendarEventDraft, CalendarList } from "../lib/calendar/types";

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
function publishBusyRangeFor(event: AppCalendarEvent): void {
  if (!useSettingsStore.getState().publishBusyTimes) return;
  if (event.repeat.rrule) return;
  void (async () =>
    (await getCalendarSdk()).addBusyRange({ start: event.begin, end: event.end }))().catch(
    () => {},
  );
}

function retractBusyRangeFor(event: AppCalendarEvent): void {
  if (event.repeat.rrule) return;
  void (async () =>
    (await getCalendarSdk()).removeBusyRange({ start: event.begin, end: event.end }))().catch(
    () => {},
  );
}

interface CalendarStore {
  events: AppCalendarEvent[];
  calendars: CalendarList[];
  isLoadingEvents: boolean;
  isLoadingCalendars: boolean;
  error: string | null;
  selectedDate: Date;

  setSelectedDate(date: Date): void;
  fetchEvents(opts?: { authors?: string[]; since?: number; until?: number }): Promise<void>;
  fetchCalendars(): Promise<void>;
  createEvent(draft: AppCalendarEventDraft): Promise<AppCalendarEvent>;
  createCalendar(title: string, color: string, description?: string): Promise<CalendarList>;
  updateCalendar(calendar: CalendarList): Promise<CalendarList>;
  deleteCalendar(calendar: CalendarList): Promise<void>;
  deleteEvent(id: string, coordinate?: string): Promise<void>;
  ingestEvent(event: AppCalendarEvent): void;
  updateEvent(draft: AppCalendarEventDraft & { id: string }): Promise<AppCalendarEvent>;
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
      const events = await fetchEventsForUser({ calendars: get().calendars, ...(opts ?? {}) });
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
      const calendars = await (await getCalendarSdk()).fetchCalendars();
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
      const sdk = await getCalendarSdk();
      const previous = get().events.find((e) => e.id === draft.id);
      const isPrivate = draft.isPrivate ?? previous?.isPrivate ?? true;
      let event: AppCalendarEvent;
      if (isPrivate) {
        const published = await sdk.updatePrivateEvent(draft, {
          // Everyone already on the event holds an invitation; without this the
          // SDK re-wraps a fresh one for each of them on every edit.
          previousParticipants: previous?.participants ?? [],
          calendarId: draft.calendarId ?? previous?.calendarId,
          calendars: get().calendars,
          previousCreatedAt: previous?.createdAt,
        });
        event = { ...published.event, calendarId: draft.calendarId ?? previous?.calendarId };
      } else {
        const published = await sdk.publishPublicEvent(draft, {
          previousCreatedAt: previous?.createdAt,
        });
        event = { ...published.event, calendarId: draft.calendarId ?? previous?.calendarId };
      }
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
      const sdk = await getCalendarSdk();
      const isPrivate = draft.isPrivate ?? true;

      if (!isPrivate) {
        const { event, relayHint } = await sdk.publishPublicEvent(draft);
        // A public event needs no view key, but the list ref is what groups it
        // under the calendar the user picked — here and in every other client.
        // Best-effort: a failed link must not lose the published event.
        const target = draft.calendarId
          ? get().calendars.find((c) => c.id === draft.calendarId)
          : undefined;
        let linked: CalendarList | undefined;
        if (target) {
          try {
            linked = await sdk.linkEventToCalendar(target, [
              `${event.kind}:${event.user}:${event.id}`,
              relayHint ?? "",
              "",
            ]);
          } catch {
            // Keep the event; the calendar just misses its ref this round.
          }
        }
        const publicEvent: AppCalendarEvent = { ...event, calendarId: target?.id };
        publishBusyRangeFor(publicEvent);
        set((state) => ({
          events: [...state.events, publicEvent],
          calendars: linked
            ? state.calendars.map((c) => (c.id === linked.id ? linked : c))
            : state.calendars,
        }));
        return publicEvent;
      }

      // A private event's per-event viewKey only survives a refresh if it is
      // stored in a list's eventRef — that is also how calendar.formstr.app
      // discovers and decrypts it — so a private event MUST land in a calendar.
      const calendars = get().calendars;
      let list = draft.calendarId ? calendars.find((c) => c.id === draft.calendarId) : calendars[0];
      let known = calendars;
      if (!list) {
        list = await sdk.createCalendar({ title: "My Calendar", color: "#334155" });
        known = [...calendars, list];
      }

      const published = await sdk.publishPrivateEvent(draft, {
        calendarId: list.id,
        calendars: known,
      });
      const event: AppCalendarEvent = { ...published.event, calendarId: list.id };

      publishBusyRangeFor(event);

      set((state) => {
        const events = [...state.events, event];
        const exists = state.calendars.some((c) => c.id === list.id);
        return {
          events,
          calendars: exists ? state.calendars : [...state.calendars, list],
        };
      });
      return event;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to create event" });
      throw e;
    }
  },

  async createCalendar(title, color, description) {
    set({ error: null });
    try {
      const calendar = await (await getCalendarSdk()).createCalendar({ title, color, description });
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
      const saved = await (await getCalendarSdk()).updateCalendar(calendar);
      set((state) => ({
        calendars: state.calendars.map((c) => (c.id === saved.id ? saved : c)),
      }));
      return saved;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to update calendar" });
      throw e;
    }
  },

  async deleteCalendar(calendar) {
    try {
      await (await getCalendarSdk()).deleteCalendar(calendar);
      set((state) => ({ calendars: state.calendars.filter((c) => c.id !== calendar.id) }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to delete calendar" });
    }
  },

  async deleteEvent(id, coordinate) {
    try {
      const sdk = await getCalendarSdk();
      const deleted = get().events.find((e) => e.id === id);
      await sdk.deleteEvent({
        kind: deleted?.kind ?? 31923,
        coordinate,
        eventId: deleted?.eventId,
      });
      if (deleted) retractBusyRangeFor(deleted);
      // Remove the event ref from whichever calendar list holds it, then
      // republish that list. Without this the ref survives on the relay and
      // the event re-appears on the next refresh.
      if (coordinate) {
        const owning = get().calendars.find((c) =>
          c.eventRefs.some((ref) => ref[0] === coordinate),
        );
        if (owning) {
          const updated = await sdk.unlinkEventFromCalendar(owning, coordinate);
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
