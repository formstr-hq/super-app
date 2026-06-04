import { render, screen, cleanup } from "@testing-library/react";
import { SnackbarProvider } from "notistack";
import { afterEach, describe, it, expect, vi } from "vitest";

vi.mock("../../services/calendar/rsvp", () => ({
  rsvpToEvent: vi.fn().mockResolvedValue(undefined),
}));

const state = {
  invitations: [
    {
      wrapId: "w1",
      eventCoordinate: "31923:author:d1",
      authorPubkey: "author",
      kind: 31923,
      receivedAt: 0,
      event: { title: "Launch Party", begin: Date.now() + 3600000 },
    },
  ],
  start: vi.fn(),
  markRsvp: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("../../stores/invitationsStore", () => ({
  useInvitationsStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

import { InvitationInbox } from "./InvitationInbox";

afterEach(() => cleanup());

describe("InvitationInbox", () => {
  it("lists a pending invitation with an Accept action", () => {
    render(
      <SnackbarProvider>
        <InvitationInbox />
      </SnackbarProvider>,
    );
    expect(screen.getByText("Launch Party")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });
});
