import type { BoardInvitation } from "@formstr/kanban-sdk";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SnackbarProvider } from "notistack";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@formstr/agent/services/profile", () => ({
  fetchProfile: vi.fn().mockResolvedValue(null),
}));

const state = {
  invitations: [] as BoardInvitation[],
  isLoadingInvitations: false,
  busy: null as string | null,
  error: null as string | null,
  clearError: vi.fn(),
  loadInvitations: vi.fn().mockResolvedValue(undefined),
  acceptInvitation: vi.fn().mockResolvedValue("32301:owner:board-1"),
  dismissInvitation: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../stores/kanbanMembersStore", () => ({
  useKanbanMembersStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

import { resetProfileCache } from "../../lib/profileCache";

import { InvitationsView } from "./InvitationsView";

const INVITER = "a".repeat(64);

function makeInvitation(overrides: Partial<BoardInvitation> = {}): BoardInvitation {
  return {
    coordinate: "32301:owner:board-1",
    relayHint: "wss://relay.example",
    viewKey: "nsec1fake",
    role: "member",
    inviterPubkey: INVITER,
    message: "come help",
    wrapId: "wrap-1",
    createdAt: 10,
    ...overrides,
  };
}

function renderView() {
  const onBack = vi.fn();
  const onOpenBoard = vi.fn();
  render(
    <SnackbarProvider>
      <InvitationsView onBack={onBack} onOpenBoard={onOpenBoard} />
    </SnackbarProvider>,
  );
  return { onBack, onOpenBoard };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.invitations = [];
  state.busy = null;
  state.error = null;
  state.isLoadingInvitations = false;
  resetProfileCache();
});

afterEach(cleanup);

describe("InvitationsView", () => {
  it("loads on mount and shows an empty state", () => {
    renderView();

    expect(state.loadInvitations).toHaveBeenCalled();
    expect(screen.getByText("No pending invitations")).toBeInTheDocument();
  });

  it("names the inviter, the role offered, and the board it opens", () => {
    state.invitations = [makeInvitation()];
    renderView();

    expect(screen.getByText("Board invitations · 1")).toBeInTheDocument();
    expect(screen.getByText("Viewer")).toBeInTheDocument();
    expect(screen.getByText(/invited you to board board-1/)).toBeInTheDocument();
    expect(screen.getByText("“come help”")).toBeInTheDocument();
  });

  it("opens the board after accepting it", async () => {
    state.invitations = [makeInvitation()];
    const { onOpenBoard } = renderView();

    fireEvent.click(screen.getByText("Accept"));

    await waitFor(() => expect(onOpenBoard).toHaveBeenCalledWith("32301:owner:board-1"));
  });

  it("stays put when accepting fails", async () => {
    state.invitations = [makeInvitation()];
    state.acceptInvitation.mockResolvedValueOnce(null);
    const { onOpenBoard } = renderView();

    fireEvent.click(screen.getByText("Accept"));

    await waitFor(() => expect(state.acceptInvitation).toHaveBeenCalled());
    expect(onOpenBoard).not.toHaveBeenCalled();
  });

  it("dismisses through the store, which persists the opt-out", async () => {
    const invitation = makeInvitation();
    state.invitations = [invitation];
    renderView();

    fireEvent.click(screen.getByText("Dismiss"));

    await waitFor(() => expect(state.dismissInvitation).toHaveBeenCalledWith(invitation));
  });

  it("disables the row's actions while it is in flight", () => {
    state.invitations = [makeInvitation()];
    state.busy = "wrap-1";
    renderView();

    expect(screen.getByText("Accept").closest("button")).toBeDisabled();
    expect(screen.getByText("Dismiss").closest("button")).toBeDisabled();
  });

  it("surfaces the store's error", () => {
    state.error = "This invitation's key does not open that board.";
    renderView();
    expect(screen.getByText("This invitation's key does not open that board.")).toBeInTheDocument();
  });
});
