import type { KanbanBoard, KanbanCard } from "@formstr/kanban-sdk";
import { describe, expect, it } from "vitest";

import { columnForCard, groupCardsByColumn, sortedColumns, statusFor } from "./columns";

const COLUMNS = [
  { id: "todo", name: "To Do", order: 0 },
  { id: "doing", name: "In Progress", order: 1 },
];

function makeBoard(isPrivate: boolean): KanbanBoard {
  return {
    id: "board-1",
    pubkey: "pk",
    eventId: "evt",
    title: "Board",
    description: "",
    columns: COLUMNS,
    maintainers: [],
    members: [],
    noZap: false,
    createdAt: 1,
    isPrivate,
    legacy: false,
    rawTags: [],
  };
}

function makeCard(id: string, status: string, rank: number, binned = false): KanbanCard {
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
    binned,
    isPrivate: false,
    createdAt: 1,
    rawTags: [],
  };
}

describe("statusFor", () => {
  it("uses the column name on a public board and the id on a private one", () => {
    // The two codecs genuinely differ (SDK types.ts, KanbanCard.status). Getting
    // this backwards puts every card in a column that matches nothing.
    expect(statusFor(makeBoard(false), COLUMNS[0])).toBe("To Do");
    expect(statusFor(makeBoard(true), COLUMNS[0])).toBe("todo");
  });
});

describe("columnForCard", () => {
  it("resolves through the public name", () => {
    const board = makeBoard(false);
    expect(columnForCard(board, makeCard("a", "To Do", 10))?.id).toBe("todo");
  });

  it("resolves through the private id", () => {
    const board = makeBoard(true);
    expect(columnForCard(board, makeCard("a", "todo", 10))?.id).toBe("todo");
  });

  it("returns undefined for a status matching no column", () => {
    expect(columnForCard(makeBoard(false), makeCard("a", "Archive", 10))).toBeUndefined();
  });
});

describe("sortedColumns", () => {
  it("orders by the order field, not array position", () => {
    const board = makeBoard(false);
    board.columns = [
      { id: "b", name: "B", order: 1 },
      { id: "a", name: "A", order: 0 },
    ];
    expect(sortedColumns(board).map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("groupCardsByColumn", () => {
  it("groups by column and sorts each group by ascending rank", () => {
    const board = makeBoard(false);
    const grouped = groupCardsByColumn(board, [
      makeCard("second", "To Do", 20),
      makeCard("first", "To Do", 10),
      makeCard("other", "In Progress", 5),
    ]);
    expect(grouped.todo.map((c) => c.id)).toEqual(["first", "second"]);
    expect(grouped.doing.map((c) => c.id)).toEqual(["other"]);
  });

  it("gives every column a bucket even when empty", () => {
    const grouped = groupCardsByColumn(makeBoard(false), []);
    expect(Object.keys(grouped).sort()).toEqual(["doing", "todo"]);
  });

  it("drops binned cards", () => {
    const grouped = groupCardsByColumn(makeBoard(false), [makeCard("gone", "To Do", 10, true)]);
    expect(grouped.todo).toEqual([]);
  });

  it("drops cards whose status matches no column rather than misfiling them", () => {
    // Showing an orphan under the wrong heading invites a drag that rewrites
    // the wrong rank.
    const grouped = groupCardsByColumn(makeBoard(false), [makeCard("orphan", "Archive", 10)]);
    expect(grouped.todo).toEqual([]);
    expect(grouped.doing).toEqual([]);
  });
});
