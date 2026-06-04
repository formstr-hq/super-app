import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

import { CalendarListView } from "./CalendarListView";

function futureEvt(over = {}) {
  const begin = Date.now() + 1000 * 60 * 60 * 24 * 2;
  return {
    id: "d1",
    eventId: "e1",
    title: "Future Sync",
    description: "",
    kind: 31923,
    begin,
    end: begin + 3600000,
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

describe("CalendarListView", () => {
  it("shows an empty state when there are no upcoming events", () => {
    render(<CalendarListView events={[]} onEventClick={vi.fn()} />);
    expect(screen.getByText(/no upcoming events/i)).toBeInTheDocument();
  });

  it("lists an upcoming event", () => {
    render(<CalendarListView events={[futureEvt()]} onEventClick={vi.fn()} />);
    expect(screen.getByText("Future Sync")).toBeInTheDocument();
  });
});
