import type { KanbanBoard } from "@formstr/kanban-sdk";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteBoard = vi.hoisted(() => vi.fn(async () => {}));
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

import { useAuthStore, useKanbanStore } from "../stores";

import { KanbanPage } from "./KanbanPage";

const OWNER = "owner-pk";
const BOARD_KEY = "30301:owner-pk:board-1";

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

function renderAtBoard(board: KanbanBoard, pubkey: string | null) {
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
  } as never);

  return render(
    <MemoryRouter initialEntries={[`/kanban/${encodeURIComponent(BOARD_KEY)}`]}>
      <Routes>
        <Route path="/kanban/*" element={<KanbanPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

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
