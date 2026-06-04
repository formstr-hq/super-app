import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

vi.mock("../../services/calendar/rsvp", () => ({
  fetchRsvpsForEvent: vi.fn().mockResolvedValue([]),
  rsvpToEvent: vi.fn().mockResolvedValue(undefined),
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
    website: "",
    user: "me",
    isPrivate: false,
    repeat: { rrule: null },
    ...over,
  } as any;
}

afterEach(() => cleanup());

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

  it("shows RSVP buttons for non-authors", () => {
    render(
      <EventDetailsDialog
        event={evt({ user: "someone-else" })}
        currentUserPubkey="me"
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });
});
