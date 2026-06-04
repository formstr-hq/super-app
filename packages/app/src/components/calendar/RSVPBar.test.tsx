import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { RSVPBar } from "./RSVPBar";

// begin/end are ms timestamps, as on CalendarEvent.
const event = { begin: 1717491600000, end: 1717495200000 } as never;

describe("RSVPBar", () => {
  it("submits the chosen status", () => {
    const onSubmit = vi.fn();
    render(<RSVPBar event={event} onSubmit={onSubmit} isSubmitting={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: "accepted" }));
  });

  it("includes a comment when a note is added", () => {
    const onSubmit = vi.fn();
    render(<RSVPBar event={event} onSubmit={onSubmit} isSubmitting={false} />);
    fireEvent.click(screen.getByText(/add a note/i));
    fireEvent.change(screen.getByPlaceholderText(/note/i), {
      target: { value: "running late" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Maybe" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ status: "tentative", comment: "running late" }),
    );
  });

  it("emits a suggested time only when changed from the event's own times", () => {
    const onSubmit = vi.fn();
    render(<RSVPBar event={event} onSubmit={onSubmit} isSubmitting={false} />);
    // Without touching the suggested-time inputs, No carries no suggestion.
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "declined", suggestedStart: undefined }),
    );

    // Reveal the suggest-a-new-time inputs and change the start.
    fireEvent.click(screen.getByText(/suggest a new time/i));
    const startInput = screen.getByLabelText(/new start/i);
    fireEvent.change(startInput, { target: { value: "2024-06-04T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    const payload = onSubmit.mock.calls.at(-1)![0];
    expect(payload.status).toBe("accepted");
    expect(payload.suggestedStart).toBe(Math.floor(new Date("2024-06-04T12:00").getTime() / 1000));
  });
});
