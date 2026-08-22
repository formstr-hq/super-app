import type { KanbanBoard, KanbanCard } from "@formstr/kanban-sdk";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const moveCard = vi.hoisted(() => vi.fn(async () => {}));
const fetchBoards = vi.hoisted(() => vi.fn(async () => {}));
const fetchCards = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../kanban/sdk", () => ({ kanbanSdk: {} }));
vi.mock("../components/MobileRailDrawer", () => ({ MobileRailDrawer: () => null }));

// A stand-in board that reports the cards it was handed and lets a test fire a
// drop at a chosen index in *that* (already filtered) list.
const seen = vi.hoisted(() => ({ cards: [] as KanbanCard[] }));
vi.mock("../components/kanban/BoardView", () => ({
  BoardView: ({
    cards,
    onMoveCard,
  }: {
    cards: KanbanCard[];
    onMoveCard: (cardId: string, status: string, index: number) => void;
  }) => {
    seen.cards = cards;
    return (
      <button onClick={() => onMoveCard("dragged", "To Do", 1)}>drop dragged at visible 1</button>
    );
  },
}));

import { naddrForCoordinate } from "../kanban/boardKey";
import { useAuthStore, useKanbanStore } from "../stores";

import { KanbanPage } from "./KanbanPage";

const ME = "a".repeat(64);
const BOARD_KEY = `30301:${ME}:board-1`;

const BOARD: KanbanBoard = {
  id: "board-1",
  pubkey: ME,
  eventId: "evt",
  title: "Roadmap",
  description: "",
  columns: [{ id: "todo", name: "To Do", order: 0 }],
  maintainers: [],
  members: [],
  noZap: false,
  createdAt: 1,
  isPrivate: false,
  legacy: false,
  rawTags: [],
};

function makeCard(id: string, rank: number, overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id,
    pubkey: ME,
    authorPubkey: ME,
    rotated: false,
    eventId: `evt-${id}`,
    boardCoordinate: BOARD_KEY,
    title: id,
    description: "",
    status: "To Do",
    rank,
    attachments: [],
    assignees: [],
    labels: [],
    links: [],
    binned: false,
    isPrivate: false,
    createdAt: 1,
    rawTags: [],
    ...overrides,
  };
}

const CARDS = [
  makeCard("mine-1", 10, { assignees: [ME], labels: ["app"] }),
  makeCard("theirs", 20, { assignees: ["other-pk"] }),
  makeCard("mine-2", 30, { assignees: [ME] }),
  makeCard("dragged", 40, { assignees: [ME] }),
];

function renderPage() {
  useAuthStore.setState({ pubkey: ME, openAuthModal: vi.fn() } as never);
  useKanbanStore.setState({
    boards: [BOARD],
    cardsByBoard: { [BOARD_KEY]: CARDS },
    isLoadingBoards: false,
    isLoadingCards: false,
    error: null,
    fetchBoards,
    fetchCards,
    moveCard,
  } as never);

  return render(
    <MemoryRouter initialEntries={[`/kanban/${naddrForCoordinate(BOARD_KEY)}`]}>
      <Routes>
        <Route path="/kanban/*" element={<KanbanPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("KanbanPage filtering", () => {
  it("passes every card to the board until a filter is set", () => {
    renderPage();
    expect(seen.cards.map((c) => c.id)).toEqual(["mine-1", "theirs", "mine-2", "dragged"]);
    expect(screen.queryByText(/of 4/)).not.toBeInTheDocument();
  });

  it("narrows the board and reports the match count", () => {
    renderPage();
    fireEvent.click(screen.getByText("Assigned to me"));
    expect(seen.cards.map((c) => c.id)).toEqual(["mine-1", "mine-2", "dragged"]);
    expect(screen.getByText("3 of 4")).toBeInTheDocument();
  });

  it("searches title text", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Search cards"), { target: { value: "theirs" } });
    expect(seen.cards.map((c) => c.id)).toEqual(["theirs"]);
  });

  it("translates a drop index past the cards a filter is hiding", () => {
    renderPage();
    fireEvent.click(screen.getByText("Assigned to me"));

    // Visible column minus the dragged card is [mine-1, mine-2]; dropping at
    // visible index 1 means "above mine-2", which is index 2 of the full column
    // [mine-1, theirs, mine-2] — not index 1, which would put it above `theirs`.
    fireEvent.click(screen.getByText("drop dragged at visible 1"));
    expect(moveCard).toHaveBeenCalledWith(BOARD, "dragged", "To Do", 2);
  });

  it("uses the visible index unchanged when no filter is on", () => {
    renderPage();
    fireEvent.click(screen.getByText("drop dragged at visible 1"));
    expect(moveCard).toHaveBeenCalledWith(BOARD, "dragged", "To Do", 1);
  });
});
