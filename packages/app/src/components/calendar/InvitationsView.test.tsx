import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SnackbarProvider } from "notistack";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const rsvpToEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("../../services/calendar/rsvp", () => ({
  rsvpToEvent: (...args: unknown[]) => rsvpToEvent(...args),
}));

const state: {
  invitations: unknown[];
  start: () => void;
  markRsvp: ReturnType<typeof vi.fn>;
  dismiss: ReturnType<typeof vi.fn>;
} = { invitations: [], start: vi.fn(), markRsvp: vi.fn(), dismiss: vi.fn() };

vi.mock("../../stores/invitationsStore", () => ({
  useInvitationsStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

import { InvitationsView } from "./InvitationsView";

const pending = {
  wrapId: "w1",
  eventCoordinate: "31923:author:d1",
  authorPubkey: "author",
  kind: 31923,
  receivedAt: 0,
  event: { title: "Launch Party", begin: Date.now() + 3600000 },
};

const renderView = (onBack = vi.fn()) => {
  render(
    <SnackbarProvider>
      <InvitationsView onBack={onBack} />
    </SnackbarProvider>,
  );
  return onBack;
};

beforeEach(() => {
  rsvpToEvent.mockClear();
  state.invitations = [pending];
  state.markRsvp = vi.fn();
});
afterEach(() => cleanup());

describe("InvitationsView", () => {
  it("lists a pending invitation with an Accept action", () => {
    renderView();
    expect(screen.getByText("Launch Party")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });

  it("fires onBack from the back control", () => {
    const onBack = renderView();
    fireEvent.click(screen.getByRole("button", { name: /back to calendar/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it("Accept sends the RSVP and marks it locally", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    await waitFor(() =>
      expect(rsvpToEvent).toHaveBeenCalledWith("31923:author:d1", "accepted", false),
    );
    await waitFor(() => expect(state.markRsvp).toHaveBeenCalledWith("31923:author:d1", "accepted"));
  });

  it("shows an empty state when there are no pending invitations", () => {
    state.invitations = [];
    renderView();
    expect(screen.getByText(/no pending invitations/i)).toBeInTheDocument();
  });
});
