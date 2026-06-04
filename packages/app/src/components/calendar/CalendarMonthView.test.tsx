import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

import { CalendarMonthView } from "./CalendarMonthView";

function evt(over = {}) {
  return {
    id: "d1",
    eventId: "e1",
    title: "Demo",
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

describe("CalendarMonthView", () => {
  it("renders an event chip and fires onEventClick", () => {
    const onEventClick = vi.fn();
    render(
      <CalendarMonthView
        events={[evt()]}
        year={2026}
        month={5}
        calendars={[]}
        onEventClick={onEventClick}
        onDeleteEvent={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Demo"));
    expect(onEventClick).toHaveBeenCalledWith(expect.objectContaining({ title: "Demo" }));
  });

  it("renders weekday headers", () => {
    render(
      <CalendarMonthView
        events={[]}
        year={2026}
        month={5}
        calendars={[]}
        onEventClick={vi.fn()}
        onDeleteEvent={vi.fn()}
      />,
    );
    expect(screen.getByText("Wed")).toBeInTheDocument();
  });
});
