import type { CalendarList } from "@formstr/agent/services/calendar";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { CalendarManageDialog } from "./CalendarManageDialog";

const cal = (over: Partial<CalendarList> = {}): CalendarList => ({
  id: "c1",
  eventId: "e1",
  title: "Work",
  description: "",
  color: "#4285f4",
  eventRefs: [],
  createdAt: 0,
  isVisible: true,
  ...over,
});

describe("CalendarManageDialog", () => {
  it("renders name, description and color swatches", () => {
    render(<CalendarManageDialog open onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^color/i }).length).toBe(8);
  });

  it("Save fires onSave with the entered values", () => {
    const onSave = vi.fn();
    render(<CalendarManageDialog open onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Personal" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Personal" }));
  });

  it("does not show a Delete button in create mode", () => {
    render(<CalendarManageDialog open onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("edit mode prefills fields and Delete fires onDelete", () => {
    const onDelete = vi.fn();
    const calendar = cal({ title: "Team", description: "shared", color: "#0b8043" });
    render(
      <CalendarManageDialog
        open
        calendar={calendar}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByLabelText(/name/i)).toHaveValue("Team");
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith(calendar);
  });
});
