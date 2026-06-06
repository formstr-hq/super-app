import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SnackbarProvider } from "notistack";
import { afterEach, describe, it, expect, vi } from "vitest";

const calStore = {
  events: [],
  calendars: [],
  error: null,
  selectedDate: new Date(2026, 5, 1),
  setSelectedDate: vi.fn(),
  fetchEvents: vi.fn(),
  fetchCalendars: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  createCalendar: vi.fn(),
  updateCalendar: vi.fn(),
  deleteCalendar: vi.fn(),
  deleteEvent: vi.fn(),
};

const bookingState = {
  schedulingPages: [],
  requests: [] as Array<{ status: string }>,
  fetchAll: vi.fn(),
};

vi.mock("../stores", () => ({
  useCalendarStore: (sel?: (s: typeof calStore) => unknown) => (sel ? sel(calStore) : calStore),
  useAuthStore: (sel: (s: { pubkey: string }) => unknown) => sel({ pubkey: "pk" }),
  useBookingStore: (sel: (s: typeof bookingState) => unknown) => sel(bookingState),
}));

const invState = {
  invitations: [
    {
      wrapId: "w1",
      eventCoordinate: "31923:a:d",
      authorPubkey: "a",
      kind: 31923,
      receivedAt: 0,
      rsvp: undefined,
      event: { title: "Team Sync", begin: Date.now() + 3600000 },
    },
  ],
  start: vi.fn(),
  markRsvp: vi.fn(),
  dismiss: vi.fn(),
};
vi.mock("../stores/invitationsStore", () => ({
  useInvitationsStore: (sel: (s: typeof invState) => unknown) => sel(invState),
}));

import { CalendarPage } from "./CalendarPage";

const renderPage = () =>
  render(
    <SnackbarProvider>
      <CalendarPage />
    </SnackbarProvider>,
  );

afterEach(() => cleanup());

describe("CalendarPage view switching", () => {
  it("shows the calendar by default (not the invitation list)", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /new event/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /back to calendar/i })).toBeNull();
  });

  it("opens the invitations view from the rail and returns", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /invitations/i }));
    expect(screen.getByText(/invitations · 1/i)).toBeInTheDocument();
    expect(screen.getByText("Team Sync")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new event/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /back to calendar/i }));
    expect(screen.getByRole("button", { name: /new event/i })).toBeInTheDocument();
  });
});
