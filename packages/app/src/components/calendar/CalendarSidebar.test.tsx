import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import type { CalendarList } from "../../services/calendar";

import { CalendarSidebar } from "./CalendarSidebar";

const cal = (over: Partial<CalendarList> = {}): CalendarList => ({
  id: "work",
  eventId: "e",
  title: "Work",
  description: "",
  color: "#4285f4",
  eventRefs: [],
  createdAt: 0,
  isVisible: true,
  ...over,
});

function renderSidebar(overrides: Partial<React.ComponentProps<typeof CalendarSidebar>> = {}) {
  const props = {
    calendars: [cal()],
    visibleCalendarIds: new Set(["work"]),
    onToggleCalendar: vi.fn(),
    onNewCalendar: vi.fn(),
    onEditCalendar: vi.fn(),
    showAllPublic: false,
    onToggleShowAllPublic: vi.fn(),
    ...overrides,
  };
  render(<CalendarSidebar {...props} />);
  return props;
}

describe("CalendarSidebar (My Calendars panel)", () => {
  it("renders each calendar by name", () => {
    renderSidebar();
    expect(screen.getByText("Work")).toBeInTheDocument();
  });

  it("toggles visibility when the row is clicked", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByText("Work"));
    expect(props.onToggleCalendar).toHaveBeenCalledWith("work");
  });

  it("fires onEditCalendar from the per-row edit control", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /edit work/i }));
    expect(props.onEditCalendar).toHaveBeenCalledWith(props.calendars[0]);
  });

  it("fires onNewCalendar from the header add button", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /new calendar/i }));
    expect(props.onNewCalendar).toHaveBeenCalled();
  });

  it("toggles Show all public", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByText(/show all public/i));
    expect(props.onToggleShowAllPublic).toHaveBeenCalledWith(true);
  });
});
