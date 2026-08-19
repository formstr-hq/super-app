import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { nip19 } from "nostr-tools";
import { SnackbarProvider } from "notistack";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@formstr/agent/services/profile", () => ({
  fetchProfile: vi.fn().mockResolvedValue(null),
}));

const state = {
  busy: null as string | null,
  error: null as string | null,
  clearError: vi.fn(),
  invite: vi.fn().mockResolvedValue(undefined),
  setRole: vi.fn().mockResolvedValue(undefined),
  removeMember: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../stores/kanbanMembersStore", () => ({
  useKanbanMembersStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

import { makeBoard } from "../../kanban/boardFixture";
import { resetProfileCache } from "../../lib/profileCache";

import { MembersDialog } from "./MembersDialog";

const OWNER = "a".repeat(64);
const EDITOR = "b".repeat(64);
const VIEWER = "c".repeat(64);
const STRANGER = "d".repeat(64);

function renderDialog(props: Partial<React.ComponentProps<typeof MembersDialog>> = {}) {
  const board = makeBoard({
    pubkey: OWNER,
    maintainers: [EDITOR],
    members: [VIEWER],
    isPrivate: true,
  });
  render(
    <SnackbarProvider>
      <MembersDialog open board={board} self={OWNER} cardCount={4} onClose={vi.fn()} {...props} />
    </SnackbarProvider>,
  );
  return board;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.busy = null;
  state.error = null;
  resetProfileCache();
});

afterEach(cleanup);

describe("MembersDialog", () => {
  it("lists the whole roster with the owner's role fixed", () => {
    renderDialog();

    expect(screen.getByText("Members · 3")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    // Editor and viewer get a role control; the owner does not.
    expect(screen.getAllByRole("combobox")).toHaveLength(3); // 2 rows + the invite form
  });

  it("gives a non-owner the roster and no controls", () => {
    renderDialog({ self: EDITOR });

    expect(screen.getByText("Only the board owner can change members.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("npub or hex public key")).not.toBeInTheDocument();
  });

  it("invites an npub with the chosen role", async () => {
    const board = renderDialog();

    fireEvent.change(screen.getByLabelText("npub or hex public key"), {
      target: { value: nip19.npubEncode(STRANGER) },
    });
    fireEvent.click(screen.getByText("Invite"));

    await waitFor(() =>
      expect(state.invite).toHaveBeenCalledWith(board, STRANGER, "maintainer", undefined),
    );
  });

  it("refuses an invalid key without calling the store", async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("npub or hex public key"), {
      target: { value: "not-a-key" },
    });
    fireEvent.click(screen.getByText("Invite"));

    await screen.findByText("That is not a valid npub or 64-character hex public key.");
    expect(state.invite).not.toHaveBeenCalled();
  });

  it("refuses someone already on the board", async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("npub or hex public key"), {
      target: { value: EDITOR },
    });
    fireEvent.click(screen.getByText("Invite"));

    await screen.findByText("Already an editor on this board.");
    expect(state.invite).not.toHaveBeenCalled();
  });

  it("offers no viewer role on a public board", () => {
    renderDialog({
      board: makeBoard({ pubkey: OWNER, maintainers: [EDITOR], isPrivate: false }),
    });

    fireEvent.mouseDown(screen.getByLabelText(`Role for ${formatShort(EDITOR)}`));
    expect(screen.queryByRole("option", { name: "Viewer" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Editor" })).toBeInTheDocument();
  });

  it("shows the store's error", () => {
    state.error = "Only the board owner can manage members.";
    renderDialog();
    expect(screen.getByText("Only the board owner can manage members.")).toBeInTheDocument();
  });

  it("confirms before revoking, then calls the store once", async () => {
    const board = renderDialog();

    fireEvent.click(screen.getByLabelText(`Remove ${formatShort(VIEWER)}`));
    expect(await screen.findByText("Revoke access?")).toBeInTheDocument();
    expect(state.removeMember).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Revoke and rotate key"));
    await waitFor(() => expect(state.removeMember).toHaveBeenCalledWith(board, VIEWER));
  });
});

function formatShort(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
}
