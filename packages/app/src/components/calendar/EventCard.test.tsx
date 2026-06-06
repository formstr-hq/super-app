import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

import { EventCard } from "./EventCard";

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

describe("EventCard", () => {
  it("shows the title and fires onClick", () => {
    const onClick = vi.fn();
    render(<EventCard event={evt()} onClick={onClick} />);
    fireEvent.click(screen.getByText("Standup"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows a lock for private events", () => {
    render(<EventCard event={evt({ isPrivate: true })} onClick={vi.fn()} />);
    expect(screen.getByLabelText(/private/i)).toBeInTheDocument();
  });

  it("shows the start time", () => {
    render(<EventCard event={evt()} onClick={vi.fn()} />);
    expect(screen.getByText(/9:00/)).toBeInTheDocument();
  });

  it("applies the calendar color as a left accent", () => {
    render(<EventCard event={evt()} onClick={vi.fn()} color="#4285f4" />);
    expect(screen.getByRole("button")).toHaveStyle({ borderLeftColor: "#4285f4" });
  });
});
