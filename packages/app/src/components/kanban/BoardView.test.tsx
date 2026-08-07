import type { KanbanBoard, KanbanCard } from "@formstr/kanban-sdk";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BoardView } from "./BoardView";

function makeBoard(overrides: Partial<KanbanBoard> = {}): KanbanBoard {
  return {
    id: "board-1",
    pubkey: "pk",
    eventId: "evt",
    title: "Board",
    description: "",
    columns: [
      { id: "doing", name: "In Progress", order: 1 },
      { id: "todo", name: "To Do", order: 0 },
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

const noop = () => {};

function renderBoard(props: Partial<React.ComponentProps<typeof BoardView>> = {}) {
  return render(
    <BoardView
      board={makeBoard()}
      cards={[]}
      readOnly={false}
      onMoveCard={noop}
      onAddCard={noop}
      onOpenCard={noop}
      {...props}
    />,
  );
}

afterEach(cleanup);

describe("BoardView", () => {
  it("renders columns in `order`, not array order", () => {
    renderBoard();
    const headings = screen.getAllByText(/To Do|In Progress/).map((el) => el.textContent);
    expect(headings).toEqual(["To Do", "In Progress"]);
  });

  it("places cards in the column their status names and sorts by rank", () => {
    renderBoard({
      cards: [makeCard("second", "To Do", 20), makeCard("first", "To Do", 10)],
    });
    const titles = screen.getAllByText(/first|second/).map((el) => el.textContent);
    expect(titles).toEqual(["first", "second"]);
  });

  it("hides the add-card affordance for a non-maintainer", () => {
    renderBoard({ readOnly: true });
    expect(screen.queryByRole("button", { name: /add card/i })).not.toBeInTheDocument();
  });

  it("reports which column an add-card click came from", () => {
    const onAddCard = vi.fn();
    renderBoard({ onAddCard });
    fireEvent.click(screen.getAllByRole("button", { name: /add card/i })[0]);
    expect(onAddCard).toHaveBeenCalledWith(expect.objectContaining({ id: "todo" }));
  });

  it("opens the card that was clicked", () => {
    const onOpenCard = vi.fn();
    const card = makeCard("a", "To Do", 10);
    renderBoard({ cards: [card], onOpenCard });
    fireEvent.click(screen.getByText("a"));
    expect(onOpenCard).toHaveBeenCalledWith(card);
  });

  it("explains a board with no columns instead of rendering an empty strip", () => {
    renderBoard({ board: makeBoard({ columns: [] }) });
    expect(screen.getByText(/no columns/i)).toBeInTheDocument();
  });

  it("omits a card whose status matches no column", () => {
    // Its column was renamed or removed; showing it under the wrong heading
    // would invite a drag that rewrites the wrong rank.
    renderBoard({ cards: [makeCard("orphan", "Archive", 10)] });
    expect(screen.queryByText("orphan")).not.toBeInTheDocument();
  });
});
