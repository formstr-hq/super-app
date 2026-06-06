import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

import { CalendarListView } from "./CalendarListView";

// A fixed month the assertions target, independent of "now".
const YEAR = 2026;
const MONTH = 5; // June (0-indexed)

function evt(over = {}) {
  const begin = new Date(YEAR, MONTH, 15, 10, 0, 0).getTime();
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
  it("shows an empty state when there are no events this month", () => {
    render(<CalendarListView events={[]} year={YEAR} month={MONTH} onEventClick={vi.fn()} />);
    expect(screen.getByText(/no events this month/i)).toBeInTheDocument();
  });

  it("lists an event that falls in the selected month", () => {
    render(<CalendarListView events={[evt()]} year={YEAR} month={MONTH} onEventClick={vi.fn()} />);
    expect(screen.getByText("Future Sync")).toBeInTheDocument();
  });
});
