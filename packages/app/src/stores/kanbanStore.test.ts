import type { KanbanBoard, KanbanCard } from "@formstr/kanban-sdk";

import type { LiveScope } from "../lib/live/liveSync";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../kanban/sdk", () => ({
  kanbanSdk: {
    relays: ["wss://kanban.test"],
    fetchBoards: vi.fn(),
    fetchPrivateBoards: vi.fn(),
    fetchBoardLists: vi.fn(),
    fetchCards: vi.fn(),
    fetchBoardByCoordinate: vi.fn(),
    createBoard: vi.fn(),
    updateBoard: vi.fn(),
    deleteBoard: vi.fn(),
    createCard: vi.fn(),
    updateCard: vi.fn(),
    deleteCard: vi.fn(),
    moveCard: vi.fn(),
  },
}));

const { liveSync, closers } = vi.hoisted(() => {
  const closers: Array<ReturnType<typeof vi.fn>> = [];
  return {
    closers,
    liveSync: {
      open: vi.fn((_scope: LiveScope) => {
        const close = vi.fn();
        closers.push(close);
        return close;
      }),
    },
  };
});

// The bus opens real subscriptions through the runtime. Record the scopes
// instead — what the store owes it is which board is open, nothing more.
vi.mock("../lib/live/controller", () => ({
  currentLiveSync: () => liveSync,
}));

import { boardKey } from "../kanban/boardKey";
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
  closers.length = 0;
  useKanbanStore.getState().reset();
  useAuthStore.setState({ pubkey: "pk" });
});

describe("resolveBoardLink", () => {
  it("fetches a public board that is not in the user's own list", async () => {
    // A shared `naddr` names a board nobody put in this account's lists, so
    // `fetchBoards` will never return it. Without this the link dead-ends.
    const shared = makeBoard({ pubkey: "someone-else" });
    sdk.fetchBoardByCoordinate.mockResolvedValue(shared);

    await useKanbanStore.getState().resolveBoardLink("30301:someone-else:board-1");

    expect(sdk.fetchBoardByCoordinate).toHaveBeenCalledWith("30301:someone-else:board-1");
    expect(useKanbanStore.getState().linkedBoard).toBe(shared);
  });

  it("leaves a private coordinate alone, having no view key to read it with", async () => {
    // A 32301 board is encrypted under a view key that only reaches this
    // account through a board list or an invitation — both of which would have
    // put the board in `boards` already. Asking would spend a round trip on a
    // payload that cannot be decrypted.
    await useKanbanStore.getState().resolveBoardLink("32301:someone-else:board-1");

    expect(sdk.fetchBoardByCoordinate).not.toHaveBeenCalled();
    expect(useKanbanStore.getState().linkedBoard).toBeNull();
  });

  it("does not go to the relays for a board already in the list", async () => {
    useKanbanStore.setState({ boards: [makeBoard()] });

    await useKanbanStore.getState().resolveBoardLink(BOARD_KEY);

    expect(sdk.fetchBoardByCoordinate).not.toHaveBeenCalled();
  });

  it("asks once per coordinate, however often the open board is re-read", async () => {
    sdk.fetchBoardByCoordinate.mockResolvedValue(null);

    await useKanbanStore.getState().resolveBoardLink("30301:someone-else:board-1");
    await useKanbanStore.getState().resolveBoardLink("30301:someone-else:board-1");

    expect(sdk.fetchBoardByCoordinate).toHaveBeenCalledTimes(1);
  });

  it("drops a board resolved for a different link", async () => {
    sdk.fetchBoardByCoordinate.mockResolvedValueOnce(makeBoard({ pubkey: "someone-else" }));
    await useKanbanStore.getState().resolveBoardLink("30301:someone-else:board-1");

    sdk.fetchBoardByCoordinate.mockResolvedValueOnce(null);
    await useKanbanStore.getState().resolveBoardLink("30301:someone-else:board-2");

    expect(useKanbanStore.getState().linkedBoard).toBeNull();
  });

  it("reports a failed lookup as a missing board, not an error banner", async () => {
    // The coordinate came out of a URL: an unreachable board is a bad link,
    // which `MissingBoard` already explains better than a red alert.
    sdk.fetchBoardByCoordinate.mockRejectedValue(new Error("relay down"));

    await useKanbanStore.getState().resolveBoardLink("30301:someone-else:board-1");

    expect(useKanbanStore.getState().linkedBoard).toBeNull();
    expect(useKanbanStore.getState().error).toBeNull();
    expect(useKanbanStore.getState().isResolvingLink).toBe(false);
  });

  it("is cleared on sign-out", async () => {
    sdk.fetchBoardByCoordinate.mockResolvedValue(makeBoard({ pubkey: "someone-else" }));
    await useKanbanStore.getState().resolveBoardLink("30301:someone-else:board-1");

    useKanbanStore.getState().reset();

    expect(useKanbanStore.getState().linkedBoard).toBeNull();
  });
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

describe("optimistic writes vs. a live refetch", () => {
  // Found live: the local relay echoes a publish back to its own observers, so
  // the reactive refetch can land BEFORE the SDK call the user made resolves.
  // A blind append then adds a second copy of a board the list already holds.
  it("does not duplicate a board the refetch already brought in", async () => {
    const board = makeBoard();
    sdk.createBoard.mockImplementation(async () => {
      // The refetch beats the publish's own resolution.
      useKanbanStore.setState({ boards: [board] });
      return board;
    });

    await useKanbanStore.getState().createBoard({ title: "Board" } as never);

    expect(useKanbanStore.getState().boards).toHaveLength(1);
  });

  it("does not duplicate a card the refetch already brought in", async () => {
    const board = makeBoard();
    const card = makeCard("c1", "todo", 100);
    sdk.createCard.mockImplementation(async () => {
      useKanbanStore.setState({ cardsByBoard: { [BOARD_KEY]: [card] } });
      return card;
    });

    await useKanbanStore.getState().createCard(board, { title: "Card" } as never);

    expect(useKanbanStore.getState().cardsByBoard[BOARD_KEY]).toHaveLength(1);
  });

  it("keeps the newly created board when the refetch has not landed yet", async () => {
    const board = makeBoard();
    sdk.createBoard.mockResolvedValue(board);
    await useKanbanStore.getState().createBoard({ title: "Board" } as never);
    expect(useKanbanStore.getState().boards).toEqual([board]);
  });
});

describe("live card scope", () => {
  it("watches the open board's cards", async () => {
    const board = makeBoard();
    sdk.fetchCards.mockResolvedValue([]);
    await useKanbanStore.getState().fetchCards(board);

    expect(liveSync.open).toHaveBeenCalledTimes(1);
    const scope = liveSync.open.mock.calls[0][0];
    expect(scope.key).toBe(`cards:${boardKey(board)}`);
    expect(scope.filters[0]["#a"]).toEqual([boardKey(board)]);
  });

  it("drops the previous board's scope when another is opened", async () => {
    sdk.fetchCards.mockResolvedValue([]);
    await useKanbanStore.getState().fetchCards(makeBoard({ id: "b1" }));
    await useKanbanStore.getState().fetchCards(makeBoard({ id: "b2" }));

    // Keyed per board, so the bus closes the first scope itself; opening the
    // same board twice must not stack two subscriptions either.
    const keys = liveSync.open.mock.calls.map((c) => c[0].key);
    expect(new Set(keys).size).toBe(2);
    expect(closers[0]).toHaveBeenCalledTimes(1);
  });

  it("routes the scope to the kanban relays", async () => {
    sdk.fetchCards.mockResolvedValue([]);
    await useKanbanStore.getState().fetchCards(makeBoard());
    expect(liveSync.open.mock.calls[0][0].relays).toEqual(["wss://kanban.test"]);
  });

  it("does not resubscribe when the same board is re-read", async () => {
    // The scope's own onChange re-runs fetchCards. Reopening the scope there
    // would tear down the subscription that just fired and rebuild it on every
    // single card edit.
    const board = makeBoard();
    sdk.fetchCards.mockResolvedValue([]);
    await useKanbanStore.getState().fetchCards(board);
    await useKanbanStore.getState().fetchCards(board);

    expect(liveSync.open).toHaveBeenCalledTimes(1);
    expect(closers[0]).not.toHaveBeenCalled();
  });

  it("re-reads the board's cards when the scope changes", async () => {
    const board = makeBoard();
    sdk.fetchCards.mockResolvedValue([]);
    await useKanbanStore.getState().fetchCards(board);
    sdk.fetchCards.mockClear();

    await liveSync.open.mock.calls[0][0].onChange();

    expect(sdk.fetchCards).toHaveBeenCalledWith(board);
  });

  it("stops watching on reset", async () => {
    sdk.fetchCards.mockResolvedValue([]);
    await useKanbanStore.getState().fetchCards(makeBoard());
    useKanbanStore.getState().reset();

    // reset runs on sign-out. A scope left open would keep refetching a board
    // for an account that no longer has a signer to decrypt it.
    expect(closers[0]).toHaveBeenCalledTimes(1);
  });

  it("still loads a private board whose key it cannot use", async () => {
    sdk.fetchCards.mockResolvedValue([]);
    await useKanbanStore.getState().fetchCards(makeBoard({ isPrivate: true, viewKey: undefined }));

    expect(sdk.fetchCards).toHaveBeenCalled();
    expect(liveSync.open).not.toHaveBeenCalled();
  });
});
