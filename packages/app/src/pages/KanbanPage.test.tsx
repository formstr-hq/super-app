import type { KanbanBoard } from "@formstr/kanban-sdk";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteBoard = vi.hoisted(() => vi.fn(async () => {}));
const resolveBoardLink = vi.hoisted(() => vi.fn(async () => {}));
const fetchBoards = vi.hoisted(() => vi.fn(async () => {}));
const fetchCards = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../kanban/sdk", () => ({ kanbanSdk: {} }));

// The board-list and board surfaces are covered by their own component tests;
// this file is about the page's ownership gate around deletion.
vi.mock("../components/kanban/BoardView", () => ({ BoardView: () => <div>board view</div> }));
vi.mock("../components/kanban/BoardListView", () => ({
  BoardListView: () => <div>board list</div>,
}));
vi.mock("../components/MobileRailDrawer", () => ({ MobileRailDrawer: () => null }));

import { naddrForCoordinate } from "../kanban/boardKey";
import { useAuthStore, useKanbanStore } from "../stores";

import { KanbanPage } from "./KanbanPage";

const OWNER = "a".repeat(64);
const BOARD_KEY = `30301:${OWNER}:board-1`;

function makeBoard(overrides: Partial<KanbanBoard> = {}): KanbanBoard {
  return {
    id: "board-1",
    pubkey: OWNER,
    eventId: "evt",
    title: "Q3 Roadmap",
    description: "",
    columns: [{ id: "todo", name: "To Do", order: 0 }],
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

function renderAtBoard(board: KanbanBoard, pubkey: string | null, segment?: string) {
  useAuthStore.setState({ pubkey, openAuthModal: vi.fn() } as never);
  useKanbanStore.setState({
    boards: [board],
    cardsByBoard: { [BOARD_KEY]: [] },
    isLoadingBoards: false,
    isLoadingCards: false,
    error: null,
    fetchBoards,
    fetchCards,
    deleteBoard,
    resolveBoardLink,
  } as never);

  return render(
    <MemoryRouter initialEntries={[`/kanban/${segment ?? naddrForCoordinate(BOARD_KEY)}`]}>
      <Routes>
        <Route path="/kanban/*" element={<KanbanPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("KanbanPage board routing", () => {
  it("opens the board an naddr segment points at", () => {
    renderAtBoard(makeBoard(), OWNER);
    expect(screen.getByRole("button", { name: /delete board/i })).toBeInTheDocument();
  });

  it("still opens a board from a pre-naddr raw coordinate link", () => {
    // Those URLs were shipped, so they exist in the wild. An undecodable
    // segment is handed through untouched, and a raw coordinate is exactly a
    // board key, so the old links keep resolving.
    renderAtBoard(makeBoard(), OWNER, encodeURIComponent(BOARD_KEY));
    expect(screen.getByRole("button", { name: /delete board/i })).toBeInTheDocument();
  });

  it("looks up a board the naddr names but the user's own list has not got", async () => {
    // The point of routing on an naddr: it carries the whole address, so a
    // link shared by someone who never invited you still opens.
    const shared = `30301:${"b".repeat(64)}:shared-board`;
    renderAtBoard(makeBoard(), OWNER, naddrForCoordinate(shared));

    await waitFor(() => expect(resolveBoardLink).toHaveBeenCalledWith(shared));
  });

  it("opens the board that lookup found, without adding it to the list", async () => {
    const shared = makeBoard({ pubkey: "b".repeat(64), id: "shared-board", title: "Shared" });
    useKanbanStore.setState({ boards: [], linkedBoard: shared } as never);
    renderAtBoard(makeBoard(), OWNER, naddrForCoordinate(`30301:${"b".repeat(64)}:shared-board`));
    useKanbanStore.setState({ boards: [], linkedBoard: shared } as never);

    await waitFor(() => expect(screen.getByText("board view")).toBeInTheDocument());
    expect(screen.queryByText(/not in your list/i)).not.toBeInTheDocument();
  });

  it("opens a shared public board for a signed-out visitor, read-only", async () => {
    // Nothing on the public read path touches the signer, so a shared link must
    // not trip the login modal on the way in — the mistake the calendar module
    // made with its own "show all public" surface.
    const openAuthModal = vi.fn();
    const shared = makeBoard({ pubkey: "b".repeat(64), id: "shared-board" });
    renderAtBoard(makeBoard(), null, naddrForCoordinate(`30301:${"b".repeat(64)}:shared-board`));
    useAuthStore.setState({ pubkey: null, openAuthModal } as never);
    useKanbanStore.setState({ boards: [], linkedBoard: shared } as never);

    await waitFor(() => expect(screen.getByText("board view")).toBeInTheDocument());
    expect(openAuthModal).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /add card/i })).not.toBeInTheDocument();
  });

  it("does not look up a board it already has", async () => {
    renderAtBoard(makeBoard(), OWNER);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /delete board/i })).toBeVisible(),
    );
    expect(resolveBoardLink).not.toHaveBeenCalled();
  });

  it("reports a missing board for a segment that resolves to nothing", () => {
    renderAtBoard(makeBoard(), OWNER, "naddr1nonsense");
    expect(screen.getByText(/could not find that board/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete board/i })).not.toBeInTheDocument();
  });

  it("blames the view key only for a private board, which is the one it explains", () => {
    // A public board that did not resolve was looked for on the relays and was
    // not there; saying "not in your list" would send the user hunting for the
    // wrong thing.
    const priv = `32301:${"b".repeat(64)}:secret`;
    renderAtBoard(makeBoard(), OWNER, naddrForCoordinate(priv));
    expect(screen.getByText(/view key/i)).toBeInTheDocument();
  });
});

describe("KanbanPage board deletion", () => {
  it("offers delete to the board owner", () => {
    renderAtBoard(makeBoard(), OWNER);
    expect(screen.getByRole("button", { name: /delete board/i })).toBeInTheDocument();
  });

  it("withholds delete from a maintainer who can still edit cards", () => {
    // A NIP-09 tombstone is only honored from the event's own author, so a
    // maintainer's deletion would be signed by the wrong key and ignored by
    // relays — showing the button would promise something that cannot happen.
    renderAtBoard(makeBoard({ maintainers: ["helper-pk"] }), "helper-pk");
    expect(screen.queryByRole("button", { name: /delete board/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/not a maintainer/i)).not.toBeInTheDocument();
  });

  it("withholds delete from a stranger and marks the board read-only", () => {
    renderAtBoard(makeBoard(), "stranger-pk");
    expect(screen.queryByRole("button", { name: /delete board/i })).not.toBeInTheDocument();
    expect(screen.getByText(/not a maintainer/i)).toBeInTheDocument();
  });

  it("confirms before deleting, and warns that a Nostr deletion is a request", () => {
    renderAtBoard(makeBoard(), OWNER);
    fireEvent.click(screen.getByRole("button", { name: /delete board/i }));

    expect(screen.getByText(/delete this board\?/i)).toBeInTheDocument();
    expect(screen.getByText(/is a request, not an erasure/i)).toBeInTheDocument();
    expect(deleteBoard).not.toHaveBeenCalled();
  });

  it("deletes only once the confirm is accepted", async () => {
    const board = makeBoard();
    renderAtBoard(board, OWNER);
    fireEvent.click(screen.getByRole("button", { name: /delete board/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete board$/i, hidden: false }));

    await waitFor(() => expect(deleteBoard).toHaveBeenCalledWith(board));
  });

  it("abandons the delete on cancel", () => {
    renderAtBoard(makeBoard(), OWNER);
    fireEvent.click(screen.getByRole("button", { name: /delete board/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(deleteBoard).not.toHaveBeenCalled();
  });
});
