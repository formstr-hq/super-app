import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

import { CalendarHeader } from "./CalendarHeader";

afterEach(() => cleanup());

function setup(over = {}) {
  const props = {
    monthLabel: "June 2026",
    viewMode: "month" as const,
    onViewModeChange: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onToday: vi.fn(),
    onNewEvent: vi.fn(),
    ...over,
  };
  render(<CalendarHeader {...props} />);
  return props;
}

describe("CalendarHeader", () => {
  it("shows the month label", () => {
    setup();
    expect(screen.getByText("June 2026")).toBeInTheDocument();
  });

  it("fires onPrev / onNext / onToday", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /previous month/i }));
    fireEvent.click(screen.getByRole("button", { name: /next month/i }));
    fireEvent.click(screen.getByRole("button", { name: /today/i }));
    expect(p.onPrev).toHaveBeenCalledOnce();
    expect(p.onNext).toHaveBeenCalledOnce();
    expect(p.onToday).toHaveBeenCalledOnce();
  });

  it("fires onNewEvent", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /new event/i }));
    expect(p.onNewEvent).toHaveBeenCalledOnce();
  });

  it("switches the view mode", () => {
    const p = setup({ viewMode: "month" });
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(p.onViewModeChange).toHaveBeenCalledWith("list");
  });
});
