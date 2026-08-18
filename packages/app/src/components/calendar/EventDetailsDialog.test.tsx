import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchRsvps = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const rsvp = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../lib/calendar/sdk", () => ({
  getCalendarSdk: vi.fn(async () => ({ fetchRsvps, rsvp })),
}));

import { EventDetailsDialog } from "./EventDetailsDialog";

function evt(over = {}) {
  return {
    id: "d1",
    eventId: "e1",
    title: "Standup",
    description: "",
    kind: 31923,
    begin: new Date(2026, 5, 10, 9, 0).getTime(),
    end: new Date(2026, 5, 10, 10, 0).getTime(),
    createdAt: 0,
    categories: [],
    participants: [],
    location: [],
    user: "me",
    isPrivate: false,
    repeat: { rrule: null },
    ...over,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchRsvps.mockResolvedValue([]);
  rsvp.mockClear();
});

describe("EventDetailsDialog", () => {
  it("shows Edit/Delete for the author", () => {
    render(
      <EventDetailsDialog
        event={evt({ user: "me" })}
        currentUserPubkey="me"
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("shows the RSVP bar for everyone, including the author", () => {
    render(
      <EventDetailsDialog
        event={evt({ user: "me" })}
        currentUserPubkey="me"
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/will you be attending/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
  });

  it("submits an RSVP carrying the questionnaire payload", async () => {
    render(
      <EventDetailsDialog
        event={evt({ user: "someone-else", isPrivate: false })}
        currentUserPubkey="me"
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() =>
      expect(rsvp).toHaveBeenCalledWith(
        expect.objectContaining({
          coordinate: "31923:someone-else:d1",
          payload: expect.objectContaining({ status: "accepted" }),
          // A public event carries no view key.
          viewKey: undefined,
        }),
      ),
    );
  });

  it("shows a combined When row, Where, and the event's calendar by name", () => {
    render(
      <EventDetailsDialog
        event={evt({ calendarId: "work", location: ["Signal call"] })}
        calendars={[
          {
            id: "work",
            eventId: "e",
            title: "Work",
            description: "",
            color: "#4285f4",
            eventRefs: [],
            createdAt: 0,
          },
        ]}
        currentUserPubkey="me"
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("When")).toBeInTheDocument();
    expect(screen.getByText("Where")).toBeInTheDocument();
    expect(screen.getByText("Signal call")).toBeInTheDocument();
    expect(screen.getByText("Calendar")).toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
  });

  it("renders an attendee's status, note and suggested time", async () => {
    fetchRsvps.mockResolvedValue([
      {
        pubkey: "abcd1234ef",
        status: "tentative",
        eventCoord: "31923:me:d1",
        createdAt: 5,
        suggestedStart: Math.floor(new Date(2026, 5, 10, 9, 30).getTime() / 1000),
        suggestedEnd: Math.floor(new Date(2026, 5, 10, 10, 30).getTime() / 1000),
        comment: "can we push 30 min?",
      },
    ]);
    render(
      <EventDetailsDialog
        event={evt()}
        currentUserPubkey="me"
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(await screen.findByText(/can we push 30 min/i)).toBeInTheDocument();
    expect(screen.getByText(/tentative/i)).toBeInTheDocument();
    // The suggested-time proposal surfaces somewhere in the attendee row.
    expect(screen.getByText(/suggests/i)).toBeInTheDocument();
  });
});
