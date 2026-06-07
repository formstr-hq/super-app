import {
  approveBookingRequest,
  declineBookingRequest,
  fetchBookingRequests,
  fetchSchedulingPages,
  type BookingRequest,
  type SchedulingPage,
} from "@formstr/agent/services/calendar/booking";
import type { CalendarList } from "@formstr/agent/services/calendar/types";
import { create } from "zustand";

import { useCalendarStore } from "./calendarStore";

/**
 * Booking links (appointment scheduling) store — display + approve.
 *
 * Relays carry only incoming booking requests; whether *we* approved/declined a
 * request is local knowledge, so responded statuses are cached in localStorage
 * and overlaid onto the freshly-fetched (always "pending") requests.
 */

const STATUS_KEY = "cal:booking_statuses";

type CachedStatus = {
  status: "approved" | "declined";
  respondedAt: number;
  declineReason?: string;
};

function loadStatuses(): Record<string, CachedStatus> {
  try {
    return JSON.parse(localStorage.getItem(STATUS_KEY) ?? "{}") as Record<string, CachedStatus>;
  } catch {
    return {};
  }
}

function saveStatus(id: string, value: CachedStatus) {
  const all = loadStatuses();
  all[id] = value;
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable — status stays in-memory only */
  }
}

interface BookingStore {
  schedulingPages: SchedulingPage[];
  requests: BookingRequest[];
  isLoading: boolean;
  error: string | null;
  fetchAll(): Promise<void>;
  approve(requestId: string, calendar: CalendarList): Promise<void>;
  decline(requestId: string, reason?: string): Promise<void>;
  pendingCount(): number;
}

export const useBookingStore = create<BookingStore>((set, get) => ({
  schedulingPages: [],
  requests: [],
  isLoading: false,
  error: null,

  async fetchAll() {
    set({ isLoading: true, error: null });
    try {
      const [schedulingPages, fetched] = await Promise.all([
        fetchSchedulingPages(),
        fetchBookingRequests(),
      ]);
      const cached = loadStatuses();
      const requests = fetched.map((r) =>
        cached[r.id]
          ? {
              ...r,
              status: cached[r.id].status,
              respondedAt: cached[r.id].respondedAt,
              declineReason: cached[r.id].declineReason,
            }
          : r,
      );
      set({ schedulingPages, requests, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to load bookings", isLoading: false });
    }
  },

  async approve(requestId, calendar) {
    const request = get().requests.find((r) => r.id === requestId);
    if (!request || request.status !== "pending") return;
    try {
      const { event, calendar: updated } = await approveBookingRequest(request, calendar);
      // Surface the appointment on the host's calendar immediately.
      useCalendarStore.getState().ingestEvent(event);
      useCalendarStore.setState((s) => ({
        calendars: s.calendars.map((c) => (c.id === updated.id ? updated : c)),
      }));
      const respondedAt = Date.now();
      saveStatus(requestId, { status: "approved", respondedAt });
      set((state) => ({
        requests: state.requests.map((r) =>
          r.id === requestId ? { ...r, status: "approved", respondedAt } : r,
        ),
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to approve booking" });
    }
  },

  async decline(requestId, reason) {
    const request = get().requests.find((r) => r.id === requestId);
    if (!request || request.status !== "pending") return;
    try {
      await declineBookingRequest(request, reason);
      const respondedAt = Date.now();
      saveStatus(requestId, { status: "declined", respondedAt, declineReason: reason });
      set((state) => ({
        requests: state.requests.map((r) =>
          r.id === requestId ? { ...r, status: "declined", respondedAt, declineReason: reason } : r,
        ),
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to decline booking" });
    }
  },

  pendingCount() {
    return get().requests.filter((r) => r.status === "pending").length;
  },
}));
