import type { KanbanBoard } from "@formstr/kanban-sdk";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchBoards = vi.hoisted(() => vi.fn(async () => {}));
const fetchCards = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../kanban/sdk", () => ({ kanbanSdk: {} }));
vi.mock("@formstr/agent/services/profile", () => ({
  fetchProfile: vi.fn().mockResolvedValue(null),
}));

vi.mock("../components/kanban/BoardView", () => ({ BoardView: () => <div>board view</div> }));
vi.mock("../components/kanban/BoardListView", () => ({
  BoardListView: () => <div>board list</div>,
}));
vi.mock("../components/kanban/InvitationsView", () => ({
  InvitationsView: () => <div>invitations pane</div>,
}));
vi.mock("../components/MobileRailDrawer", () => ({ MobileRailDrawer: () => null }));

import { makeBoard as makeFixtureBoard } from "../kanban/boardFixture";
import { useAuthStore, useKanbanMembersStore, useKanbanStore } from "../stores";

import { KanbanPage } from "./KanbanPage";

const OWNER = "a".repeat(64);
const BOARD_KEY = `32301:${OWNER}:board-1`;

function makeBoard(overrides: Partial<KanbanBoard> = {}) {
  return makeFixtureBoard({ pubkey: OWNER, isPrivate: true, ...overrides });
}

function renderKanban(
  path: string,
  board: KanbanBoard,
  pubkey: string | null,
  members: Partial<ReturnType<typeof useKanbanMembersStore.getState>> = {},
) {
  useAuthStore.setState({ pubkey, openAuthModal: vi.fn() } as never);
  useKanbanStore.setState({
    boards: [board],
    cardsByBoard: { [BOARD_KEY]: [] },
    isLoadingBoards: false,
    isLoadingCards: false,
    error: null,
    fetchBoards,
    fetchCards,
  } as never);
  useKanbanMembersStore.setState({
    invitations: [],
    removedCoordinates: [],
    loadInvitations: vi.fn(async () => {}),
    loadRemovalNotices: vi.fn(async () => {}),
    reset: vi.fn(),
    ...members,
  } as never);

  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/kanban/*" element={<KanbanPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("KanbanPage membership", () => {
  it("opens the members dialog from the board header", () => {
    renderKanban(`/kanban/${encodeURIComponent(BOARD_KEY)}`, makeBoard(), OWNER);

    fireEvent.click(screen.getByRole("button", { name: "Members" }));

    expect(screen.getByText("Members · 1")).toBeInTheDocument();
  });

  it("offers the members dialog to a non-owner too, read-only", () => {
    const board = makeBoard({ members: ["b".repeat(64)] });
    renderKanban(`/kanban/${encodeURIComponent(BOARD_KEY)}`, board, "b".repeat(64));

    fireEvent.click(screen.getByRole("button", { name: "Members" }));

    expect(screen.getByText("Only the board owner can change members.")).toBeInTheDocument();
  });

  it("counts pending invitations in the rail", () => {
    renderKanban(`/kanban/${encodeURIComponent(BOARD_KEY)}`, makeBoard(), OWNER, {
      invitations: [{ wrapId: "w1" }, { wrapId: "w2" }] as never,
    });

    const row = screen.getByText("Invitations").closest("[role='button']");
    expect(row).toHaveTextContent("2");
  });

  it("renders the inbox at the invitations sentinel, not a missing board", () => {
    renderKanban("/kanban/invitations", makeBoard(), OWNER);

    expect(screen.getByText("invitations pane")).toBeInTheDocument();
    expect(screen.queryByText(/not in your list/)).not.toBeInTheDocument();
  });

  it("warns on a board whose owner published a removal notice", () => {
    renderKanban(`/kanban/${encodeURIComponent(BOARD_KEY)}`, makeBoard(), "b".repeat(64), {
      removedCoordinates: [BOARD_KEY],
    });

    expect(screen.getByText(/The owner removed you from this board/)).toBeInTheDocument();
  });

  it("stays quiet on a board with no notice", () => {
    renderKanban(`/kanban/${encodeURIComponent(BOARD_KEY)}`, makeBoard(), OWNER, {
      removedCoordinates: ["32301:someone:other"],
    });

    expect(screen.queryByText(/The owner removed you/)).not.toBeInTheDocument();
  });
});
