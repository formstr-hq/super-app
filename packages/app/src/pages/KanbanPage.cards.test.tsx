import type { KanbanBoard, KanbanCard } from "@formstr/kanban-sdk";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchBoards = vi.hoisted(() => vi.fn(async () => {}));
const fetchCards = vi.hoisted(() => vi.fn(async () => {}));
const deleteCard = vi.hoisted(() => vi.fn(async () => {}));
const binCard = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../kanban/sdk", () => ({ kanbanSdk: {} }));
vi.mock("@formstr/agent/services/profile", () => ({
  fetchProfile: vi.fn().mockResolvedValue(null),
}));

// A stand-in board that just opens the one card, so the page's card gate can be
// exercised without dragging dnd-kit into the test.
vi.mock("../components/kanban/BoardView", () => ({
  BoardView: ({
    cards,
    onOpenCard,
  }: {
    cards: KanbanCard[];
    onOpenCard: (c: KanbanCard) => void;
  }) =>
    cards.map((card) => (
      <button key={card.id} onClick={() => onOpenCard(card)}>
        open {card.title}
      </button>
    )),
}));
vi.mock("../components/kanban/BoardListView", () => ({
  BoardListView: () => <div>board list</div>,
}));
vi.mock("../components/MobileRailDrawer", () => ({ MobileRailDrawer: () => null }));

import { naddrForCoordinate } from "../kanban/boardKey";
import { useAuthStore, useKanbanStore } from "../stores";

import { KanbanPage } from "./KanbanPage";

const OWNER = "a".repeat(64);
const HELPER = "helper-pk";
const BOARD_KEY = `30301:${OWNER}:board-1`;

function makeBoard(overrides: Partial<KanbanBoard> = {}): KanbanBoard {
  return {
    id: "board-1",
    pubkey: OWNER,
    eventId: "evt",
    title: "Q3 Roadmap",
    description: "",
    columns: [{ id: "todo", name: "To Do", order: 0 }],
    maintainers: [HELPER],
    members: [],
    noZap: false,
    createdAt: 1,
    isPrivate: false,
    legacy: false,
    rawTags: [],
    ...overrides,
  };
}

/** `pubkey` is who signed this version of the card — what NIP-09 binds. */
function makeCard(pubkey: string): KanbanCard {
  return {
    id: "card-1",
    pubkey,
    authorPubkey: pubkey,
    rotated: false,
    eventId: "card-evt",
    boardCoordinate: BOARD_KEY,
    title: "Ship it",
    description: "",
    // Column NAME, because this is a public board — see kanban/columns.ts.
    status: "To Do",
    rank: 10,
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

function renderAtBoard(
  board: KanbanBoard,
  card: KanbanCard,
  pubkey: string | null,
  /** Cards on the board the test does not open — they still supply labels. */
  otherCards: KanbanCard[] = [],
) {
  useAuthStore.setState({ pubkey, openAuthModal: vi.fn() } as never);
  useKanbanStore.setState({
    boards: [board],
    cardsByBoard: { [BOARD_KEY]: [card, ...otherCards] },
    isLoadingBoards: false,
    isLoadingCards: false,
    error: null,
    fetchBoards,
    fetchCards,
    deleteCard,
    binCard,
  } as never);

  return render(
    <MemoryRouter initialEntries={[`/kanban/${naddrForCoordinate(BOARD_KEY)}`]}>
      <Routes>
        <Route path="/kanban/*" element={<KanbanPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const openTheCard = () => fireEvent.click(screen.getByRole("button", { name: /open ship it/i }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("KanbanPage card permissions", () => {
  it("lets a viewer read a card but not change or remove it", () => {
    renderAtBoard(makeBoard(), makeCard(OWNER), "stranger-pk");
    openTheCard();

    expect(screen.getByLabelText("Title")).toHaveValue("Ship it");
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /bin/i })).not.toBeInTheDocument();
  });

  it("offers delete on a card the signer wrote", async () => {
    const card = makeCard(HELPER);
    renderAtBoard(makeBoard(), card, HELPER);
    openTheCard();

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(deleteCard).toHaveBeenCalledWith(expect.anything(), card));
    expect(binCard).not.toHaveBeenCalled();
  });

  it("offers bin, not delete, on a card somebody else wrote", async () => {
    // A tombstone the maintainer signs for the owner's event is ignored by every
    // reader, so the only honest control is the one that actually works.
    const card = makeCard(OWNER);
    renderAtBoard(makeBoard(), card, HELPER);
    openTheCard();

    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /bin/i }));
    await waitFor(() => expect(binCard).toHaveBeenCalledWith(expect.anything(), card));
    expect(deleteCard).not.toHaveBeenCalled();
  });
});

describe("KanbanPage board editing", () => {
  it("offers the board edit button to the owner", () => {
    renderAtBoard(makeBoard(), makeCard(OWNER), OWNER);
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
  });

  it("withholds it from a maintainer, whose edit would fork the board", () => {
    renderAtBoard(makeBoard(), makeCard(OWNER), HELPER);
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });
});

describe("KanbanPage card pickers", () => {
  const openPicker = (field: string) =>
    fireEvent.keyDown(screen.getByRole("combobox", { name: field }), { key: "ArrowDown" });

  it("offers labels already used elsewhere on the board", () => {
    const other = { ...makeCard(OWNER), id: "card-2", title: "Other", labels: ["release"] };
    renderAtBoard(makeBoard(), makeCard(OWNER), OWNER, [other]);
    openTheCard();

    openPicker("Labels");
    expect(screen.getByRole("option", { name: "release" })).toBeInTheDocument();
  });

  it("offers the board's roster as assignees", () => {
    // Owner plus the one maintainer the fixture lists.
    renderAtBoard(makeBoard(), makeCard(OWNER), OWNER);
    openTheCard();

    openPicker("Assignees");
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("has nothing to offer on a board with no cards and no members", () => {
    renderAtBoard(makeBoard({ maintainers: [] }), makeCard(OWNER), OWNER);
    openTheCard();

    openPicker("Labels");
    // The owner is always assignable; labels start empty.
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});
