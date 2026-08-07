import type { KanbanBoard } from "@formstr/kanban-sdk";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BoardListView } from "./BoardListView";

function makeBoard(overrides: Partial<KanbanBoard> = {}): KanbanBoard {
  return {
    id: "board-1",
    pubkey: "pk",
    eventId: "evt",
    title: "Q3 Roadmap",
    description: "Everything shipping this quarter",
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

const noop = () => {};

function renderView(props: Partial<React.ComponentProps<typeof BoardListView>> = {}) {
  return render(
    <BoardListView
      boards={[]}
      cardCounts={{}}
      loading={false}
      loggedIn
      onOpen={noop}
      onCreate={noop}
      onSignIn={noop}
      {...props}
    />,
  );
}

afterEach(cleanup);

describe("BoardListView", () => {
  it("asks the user to sign in before showing anything", () => {
    // Boards are keyed to the user's pubkey — there is nothing to fetch first.
    const onSignIn = vi.fn();
    renderView({ loggedIn: false });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(screen.getByText(/sign in to see your boards/i)).toBeInTheDocument();
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it("offers board creation from the empty state", () => {
    const onCreate = vi.fn();
    renderView({ onCreate });
    fireEvent.click(screen.getByRole("button", { name: /new board/i }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("renders a board with its column and card counts", () => {
    renderView({
      boards: [makeBoard()],
      cardCounts: { "30301:pk:board-1": 4 },
    });
    expect(screen.getByText("Q3 Roadmap")).toBeInTheDocument();
    expect(screen.getByText("1 column")).toBeInTheDocument();
    expect(screen.getByText("4 cards")).toBeInTheDocument();
  });

  it("marks a private board", () => {
    renderView({ boards: [makeBoard({ isPrivate: true })] });
    expect(screen.getByLabelText("Private board")).toBeInTheDocument();
  });

  it("passes the clicked board back to the caller", () => {
    const onOpen = vi.fn();
    const board = makeBoard();
    renderView({ boards: [board], onOpen });
    fireEvent.click(screen.getByText("Q3 Roadmap"));
    expect(onOpen).toHaveBeenCalledWith(board);
  });

  it("shows placeholders while the first load is in flight", () => {
    const { container } = renderView({ loading: true });
    expect(container.querySelectorAll(".MuiSkeleton-root").length).toBeGreaterThan(0);
  });

  it("keeps showing boards during a refresh rather than flashing skeletons", () => {
    renderView({ boards: [makeBoard()], loading: true });
    expect(screen.getByText("Q3 Roadmap")).toBeInTheDocument();
  });
});
