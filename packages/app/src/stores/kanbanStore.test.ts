import type { KanbanBoard, KanbanCard } from "@formstr/kanban-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../kanban/sdk", () => ({
  kanbanSdk: {
    fetchBoards: vi.fn(),
    fetchPrivateBoards: vi.fn(),
    fetchBoardLists: vi.fn(),
    fetchCards: vi.fn(),
    createBoard: vi.fn(),
    updateBoard: vi.fn(),
    deleteBoard: vi.fn(),
    createCard: vi.fn(),
    updateCard: vi.fn(),
    deleteCard: vi.fn(),
    moveCard: vi.fn(),
  },
}));

import { kanbanSdk } from "../kanban/sdk";

import { useAuthStore } from "./authStore";
import { useKanbanStore } from "./kanbanStore";

const sdk = vi.mocked(kanbanSdk);

function makeBoard(overrides: Partial<KanbanBoard> = {}): KanbanBoard {
  return {
    id: "board-1",
    pubkey: "pk",
    eventId: "evt",
    title: "Board",
    description: "",
    columns: [
      { id: "todo", name: "To Do", order: 0 },
      { id: "doing", name: "In Progress", order: 1 },
    ],
    maintainers: [],
    members: [],
    noZap: false,
    createdAt: 1,
    isPrivate: false,
    legacy: false,
    rawTags: [],
    ...overrides,
  };
}

function makeCard(id: string, status: string, rank: number): KanbanCard {
  return {
    id,
    pubkey: "pk",
    authorPubkey: "pk",
    rotated: false,
    eventId: `evt-${id}`,
    boardCoordinate: "30301:pk:board-1",
    title: id,
    description: "",
    status,
    rank,
    attachments: [],
    assignees: [],
    labels: [],
    links: [],
    binned: false,
    isPrivate: false,
    createdAt: 1,
    rawTags: [],
  };
}

const BOARD_KEY = "30301:pk:board-1";

beforeEach(() => {
  vi.clearAllMocks();
  useKanbanStore.getState().reset();
  useAuthStore.setState({ pubkey: "pk" });
});

describe("fetchBoards", () => {
  it("does nothing without a pubkey", async () => {
    useAuthStore.setState({ pubkey: null });
    await useKanbanStore.getState().fetchBoards();
    expect(sdk.fetchBoards).not.toHaveBeenCalled();
    expect(useKanbanStore.getState().boards).toEqual([]);
  });

  it("merges owned, maintained and private boards without duplicating", async () => {
    // A board the user both authored and maintains comes back from two queries.
    const shared = makeBoard();
    const priv = makeBoard({ id: "board-2", isPrivate: true, createdAt: 5 });
    sdk.fetchBoards.mockResolvedValueOnce([shared]).mockResolvedValueOnce([shared]);
    sdk.fetchPrivateBoards.mockResolvedValue([priv]);

    await useKanbanStore.getState().fetchBoards();

    const { boards } = useKanbanStore.getState();
    expect(boards).toHaveLength(2);
    // Newest first.
    expect(boards[0].id).toBe("board-2");
  });

  it("records the error and stops loading on failure", async () => {
    sdk.fetchBoards.mockRejectedValue(new Error("relay down"));
    sdk.fetchPrivateBoards.mockResolvedValue([]);

    await useKanbanStore.getState().fetchBoards();

    expect(useKanbanStore.getState().error).toBe("relay down");
    expect(useKanbanStore.getState().isLoadingBoards).toBe(false);
  });

  it("does not query board lists separately", async () => {
    // fetchPrivateBoards reads them itself to recover each view key. Asking
    // again is a second round trip for a value nothing in this app reads.
    sdk.fetchBoards.mockResolvedValue([]);
    sdk.fetchPrivateBoards.mockResolvedValue([]);

    await useKanbanStore.getState().fetchBoards();

    expect(sdk.fetchBoardLists).not.toHaveBeenCalled();
  });
});

describe("moveCard", () => {
  const board = makeBoard();

  beforeEach(() => {
    useKanbanStore.setState({
      cardsByBoard: {
        [BOARD_KEY]: [makeCard("a", "To Do", 10), makeCard("b", "To Do", 20)],
      },
    });
  });

  it("re-ranks optimistically before the relay roundtrip resolves", async () => {
    let release: (card: KanbanCard) => void = () => {};
    sdk.moveCard.mockReturnValue(
      new Promise<KanbanCard>((resolve) => {
        release = resolve;
      }),
    );

    const pending = useKanbanStore.getState().moveCard(board, "b", "In Progress", 0);

    // Already moved locally — the board must not snap back under the pointer.
    const optimistic = useKanbanStore.getState().cardsByBoard[BOARD_KEY].find((c) => c.id === "b");
    expect(optimistic?.status).toBe("In Progress");

    release(makeCard("b", "In Progress", 10));
    await pending;

    expect(useKanbanStore.getState().cardsByBoard[BOARD_KEY].find((c) => c.id === "b")?.rank).toBe(
      10,
    );
  });

  it("restores the pre-drag order when the publish fails", async () => {
    // Leaving the optimistic order in place would show an order the relays
    // do not have.
    sdk.moveCard.mockRejectedValue(new Error("publish failed"));

    await useKanbanStore.getState().moveCard(board, "b", "In Progress", 0);

    const cards = useKanbanStore.getState().cardsByBoard[BOARD_KEY];
    expect(cards.find((c) => c.id === "b")).toMatchObject({ status: "To Do", rank: 20 });
    expect(useKanbanStore.getState().error).toBe("publish failed");
  });

  it("ignores a move for a card it does not hold", async () => {
    await useKanbanStore.getState().moveCard(board, "missing", "To Do", 0);
    expect(sdk.moveCard).not.toHaveBeenCalled();
  });

  it("passes the pre-move card list to the SDK", async () => {
    // moveCard computes ranks from the list it is handed; giving it the
    // already-optimistic copy would double-apply the move.
    sdk.moveCard.mockResolvedValue(makeCard("b", "In Progress", 10));
    await useKanbanStore.getState().moveCard(board, "b", "In Progress", 0);

    const [, cards] = sdk.moveCard.mock.calls[0];
    expect(cards.find((c: KanbanCard) => c.id === "b")).toMatchObject({ status: "To Do" });
  });
});

describe("card writes", () => {
  const board = makeBoard();

  it("appends a created card to the board's list", async () => {
    sdk.createCard.mockResolvedValue(makeCard("new", "To Do", 10));
    await useKanbanStore.getState().createCard(board, { title: "new" });
    expect(useKanbanStore.getState().cardsByBoard[BOARD_KEY]).toHaveLength(1);
  });

  it("removes a deleted card", async () => {
    useKanbanStore.setState({ cardsByBoard: { [BOARD_KEY]: [makeCard("a", "To Do", 10)] } });
    sdk.deleteCard.mockResolvedValue(undefined);
    await useKanbanStore.getState().deleteCard(board, makeCard("a", "To Do", 10));
    expect(useKanbanStore.getState().cardsByBoard[BOARD_KEY]).toEqual([]);
  });

  it("rethrows a write failure so the dialog can keep the draft", async () => {
    sdk.createCard.mockRejectedValue(new Error("nope"));
    await expect(useKanbanStore.getState().createCard(board, { title: "x" })).rejects.toThrow(
      "nope",
    );
    expect(useKanbanStore.getState().error).toBe("nope");
  });
});

describe("board writes", () => {
  it("keys boards by coordinate, so a public and private board can share a d tag", async () => {
    const pub = makeBoard();
    const priv = makeBoard({ isPrivate: true });
    sdk.fetchBoards.mockResolvedValue([pub]);
    sdk.fetchPrivateBoards.mockResolvedValue([priv]);

    await useKanbanStore.getState().fetchBoards();

    expect(useKanbanStore.getState().boards).toHaveLength(2);
  });

  it("drops a deleted board's cached cards", async () => {
    const board = makeBoard();
    useKanbanStore.setState({
      boards: [board],
      cardsByBoard: { [BOARD_KEY]: [makeCard("a", "To Do", 10)] },
    });
    sdk.deleteBoard.mockResolvedValue(undefined);

    await useKanbanStore.getState().deleteBoard(board);

    expect(useKanbanStore.getState().boards).toEqual([]);
    expect(useKanbanStore.getState().cardsByBoard[BOARD_KEY]).toBeUndefined();
  });
});
