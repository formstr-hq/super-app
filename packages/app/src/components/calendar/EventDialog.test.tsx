import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

import { EventDialog } from "./EventDialog";

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

describe("EventDialog", () => {
  it("submits a draft with the entered title", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<EventDialog open onClose={vi.fn()} onSubmit={onSubmit} calendars={[]} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Launch" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ title: "Launch" });
  });

  it("prefills the title and uses a Save label in edit mode", () => {
    render(<EventDialog open onClose={vi.fn()} onSubmit={vi.fn()} calendars={[]} event={evt()} />);
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Standup");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("reveals the recurrence selector under Advanced", () => {
    render(<EventDialog open onClose={vi.fn()} onSubmit={vi.fn()} calendars={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    // The recurrence dropdown defaults to "Does not repeat" (standalone parity).
    expect(screen.getByText("Does not repeat")).toBeInTheDocument();
  });
});
