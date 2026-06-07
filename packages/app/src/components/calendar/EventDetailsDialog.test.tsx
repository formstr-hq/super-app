import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/agent/services/calendar/rsvp", () => ({
  fetchRsvpsForEvent: vi.fn().mockResolvedValue([]),
  rsvpToEvent: vi.fn().mockResolvedValue(undefined),
}));

import { fetchRsvpsForEvent, rsvpToEvent } from "@formstr/agent/services/calendar/rsvp";

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
    website: "",
    user: "me",
    isPrivate: false,
    repeat: { rrule: null },
    ...over,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  (fetchRsvpsForEvent as ReturnType<typeof vi.fn>).mockResolvedValue([]);
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
      expect(rsvpToEvent).toHaveBeenCalledWith(
        "31923:someone-else:d1",
        "accepted",
        false,
        expect.objectContaining({ status: "accepted" }),
        undefined, // viewKey — public event has none
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
            isVisible: true,
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
    (fetchRsvpsForEvent as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        pubkey: "abcd1234ef",
        status: "tentative",
        eventCoordinate: "31923:me:d1",
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
