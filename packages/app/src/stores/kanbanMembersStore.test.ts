import { NotBoardOwnerError, type BoardInvitation } from "@formstr/kanban-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../kanban/sdk", () => ({
  kanbanSdk: {
    invite: vi.fn(),
    removeMember: vi.fn(),
    updateBoard: vi.fn(),
    fetchInvitations: vi.fn(),
    acceptInvitation: vi.fn(),
    dismissInvitation: vi.fn(),
    fetchRemovalNotices: vi.fn(),
    fetchBoards: vi.fn(),
    fetchPrivateBoards: vi.fn(),
    fetchCards: vi.fn(),
  },
}));

import { makeBoard } from "../kanban/boardFixture";
import { kanbanSdk } from "../kanban/sdk";

import { useKanbanMembersStore } from "./kanbanMembersStore";
import { useKanbanStore } from "./kanbanStore";

const sdk = vi.mocked(kanbanSdk);
const OWNER = "a".repeat(64);
const INVITEE = "b".repeat(64);

function makeInvitation(overrides: Partial<BoardInvitation> = {}): BoardInvitation {
  return {
    coordinate: "32301:owner:board-1",
    relayHint: "wss://relay.example",
    viewKey: "nsec1fake",
    role: "member",
    inviterPubkey: OWNER,
    message: "join us",
    wrapId: "wrap-1",
    createdAt: 10,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useKanbanMembersStore.getState().reset();
  useKanbanStore.setState({ boards: [], cardsByBoard: {}, error: null });
});

describe("invite", () => {
  it("gift-wraps the key on a private board and ingests the updated board", async () => {
    const board = makeBoard({ isPrivate: true });
    const updated = { ...board, members: [INVITEE], eventId: "evt-2" };
    sdk.invite.mockResolvedValue(updated);

    await useKanbanMembersStore.getState().invite(board, INVITEE, "member", "hi");

    expect(sdk.invite).toHaveBeenCalledWith(board, [{ pubkey: INVITEE, role: "member" }], "hi");
    expect(useKanbanStore.getState().boards).toEqual([updated]);
    expect(useKanbanMembersStore.getState().busy).toBeNull();
  });

  it("writes a plain maintainer tag on a public board — there is no key to deliver", async () => {
    const board = makeBoard({ isPrivate: false, maintainers: ["existing"] });
    const updated = { ...board, maintainers: ["existing", INVITEE] };
    sdk.updateBoard.mockResolvedValue(updated);

    await useKanbanMembersStore.getState().invite(board, INVITEE, "maintainer");

    expect(sdk.invite).not.toHaveBeenCalled();
    expect(sdk.updateBoard).toHaveBeenCalledWith(board, { maintainers: ["existing", INVITEE] });
    expect(useKanbanStore.getState().boards).toEqual([updated]);
  });

  it("maps NotBoardOwnerError to an owner-only message and rethrows", async () => {
    const board = makeBoard({ isPrivate: true });
    sdk.invite.mockRejectedValue(new NotBoardOwnerError("someone", "32301:owner:board-1"));

    await expect(
      useKanbanMembersStore.getState().invite(board, INVITEE, "member"),
    ).rejects.toThrow();

    expect(useKanbanMembersStore.getState().error).toBe("Only the board owner can manage members.");
    expect(useKanbanMembersStore.getState().busy).toBeNull();
  });
});

describe("setRole", () => {
  it("is the same invite call with the other role", async () => {
    const board = makeBoard({ isPrivate: true, members: [INVITEE] });
    sdk.invite.mockResolvedValue({ ...board, members: [], maintainers: [INVITEE] });

    await useKanbanMembersStore.getState().setRole(board, INVITEE, "maintainer");

    expect(sdk.invite).toHaveBeenCalledWith(
      board,
      [{ pubkey: INVITEE, role: "maintainer" }],
      undefined,
    );
  });
});

describe("removeMember", () => {
  it("rotates, ingests the rotated board, and refetches its now-stale cards", async () => {
    const board = makeBoard({ isPrivate: true, members: [INVITEE], viewKey: "nsec1old" });
    const rotated = { ...board, members: [], viewKey: "nsec1new", eventId: "evt-2" };
    sdk.removeMember.mockResolvedValue(rotated);
    sdk.fetchCards.mockResolvedValue([]);

    await useKanbanMembersStore.getState().removeMember(board, INVITEE);

    // No `{ rotate: false }` — an un-rotated removal revokes nothing.
    expect(sdk.removeMember).toHaveBeenCalledWith(board, INVITEE);
    expect(useKanbanStore.getState().boards).toEqual([rotated]);
    expect(sdk.fetchCards).toHaveBeenCalledWith(rotated);
  });

  it("refetches and warns that a failed rotation is not atomic", async () => {
    const board = makeBoard({ isPrivate: true, members: [INVITEE] });
    sdk.removeMember.mockRejectedValue(new Error("relay refused"));
    sdk.fetchBoards.mockResolvedValue([]);
    sdk.fetchPrivateBoards.mockResolvedValue([]);

    await expect(useKanbanMembersStore.getState().removeMember(board, INVITEE)).rejects.toThrow();

    expect(useKanbanMembersStore.getState().error).toContain("not atomic");
  });

  it("drops a maintainer tag on a public board without touching cards", async () => {
    const board = makeBoard({ isPrivate: false, maintainers: [INVITEE, "other"] });
    sdk.updateBoard.mockResolvedValue({ ...board, maintainers: ["other"] });

    await useKanbanMembersStore.getState().removeMember(board, INVITEE);

    expect(sdk.removeMember).not.toHaveBeenCalled();
    expect(sdk.updateBoard).toHaveBeenCalledWith(board, { maintainers: ["other"] });
    expect(sdk.fetchCards).not.toHaveBeenCalled();
  });
});

describe("invitations", () => {
  it("loads newest first", async () => {
    sdk.fetchInvitations.mockResolvedValue([
      makeInvitation({ wrapId: "old", createdAt: 1 }),
      makeInvitation({ wrapId: "new", createdAt: 9 }),
    ]);

    await useKanbanMembersStore.getState().loadInvitations();

    expect(useKanbanMembersStore.getState().invitations.map((i) => i.wrapId)).toEqual([
      "new",
      "old",
    ]);
  });

  it("accepting refetches boards, drops the row, and returns the coordinate", async () => {
    const invitation = makeInvitation();
    useKanbanMembersStore.setState({ invitations: [invitation] });
    sdk.acceptInvitation.mockResolvedValue({} as never);
    sdk.fetchBoards.mockResolvedValue([]);
    sdk.fetchPrivateBoards.mockResolvedValue([]);

    const coordinate = await useKanbanMembersStore.getState().acceptInvitation(invitation);

    expect(coordinate).toBe("32301:owner:board-1");
    expect(useKanbanMembersStore.getState().invitations).toEqual([]);
  });

  it("keeps a failed invitation listed so dismissing stays deliberate", async () => {
    const invitation = makeInvitation();
    useKanbanMembersStore.setState({ invitations: [invitation] });
    sdk.acceptInvitation.mockRejectedValue(new Error("board unreadable"));

    expect(await useKanbanMembersStore.getState().acceptInvitation(invitation)).toBeNull();
    expect(useKanbanMembersStore.getState().invitations).toEqual([invitation]);
    expect(useKanbanMembersStore.getState().error).toBe("board unreadable");
  });

  it("dismissing publishes the opt-out before dropping the row", async () => {
    const invitation = makeInvitation();
    useKanbanMembersStore.setState({ invitations: [invitation] });
    sdk.dismissInvitation.mockResolvedValue(undefined);

    await useKanbanMembersStore.getState().dismissInvitation(invitation);

    expect(sdk.dismissInvitation).toHaveBeenCalledWith(invitation);
    expect(useKanbanMembersStore.getState().invitations).toEqual([]);
  });
});

describe("removal notices", () => {
  it("records the coordinates we were removed from", async () => {
    sdk.fetchRemovalNotices.mockResolvedValue([
      { coordinate: "32301:owner:board-1", removedAt: 5 },
    ]);

    await useKanbanMembersStore.getState().loadRemovalNotices();

    expect(useKanbanMembersStore.getState().removedCoordinates).toEqual(["32301:owner:board-1"]);
  });

  it("stays quiet when the query fails — it is advisory", async () => {
    sdk.fetchRemovalNotices.mockRejectedValue(new Error("offline"));

    await useKanbanMembersStore.getState().loadRemovalNotices();

    expect(useKanbanMembersStore.getState().error).toBeNull();
  });
});
