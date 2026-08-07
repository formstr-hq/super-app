import { describe, expect, it } from "vitest";

import { columnDroppableId, resolveDropTarget } from "./dndMapping";

const board = {
  todo: ["a", "b", "c"],
  doing: ["x", "y"],
  done: [] as string[],
};

describe("resolveDropTarget", () => {
  it("returns null when the drag ended outside any target", () => {
    expect(resolveDropTarget({ activeId: "a", overId: null, cardIdsByColumn: board })).toBeNull();
  });

  it("returns null when a card is dropped on itself", () => {
    expect(resolveDropTarget({ activeId: "a", overId: "a", cardIdsByColumn: board })).toBeNull();
  });

  it("returns null when a card lands back in the slot it came from", () => {
    // Dropping `b` on `c` reads as "put b where c is", which in the list without
    // b — [a, c] — is index 1. b was already at index 1, so nothing moved.
    expect(resolveDropTarget({ activeId: "b", overId: "c", cardIdsByColumn: board })).toBeNull();
  });

  it("indexes into the destination column with the dragged card removed", () => {
    // This is the coordinate space computeRank() expects: it is handed the
    // column's ranks minus the card being moved.
    expect(resolveDropTarget({ activeId: "c", overId: "a", cardIdsByColumn: board })).toEqual({
      columnId: "todo",
      index: 0,
    });
    expect(resolveDropTarget({ activeId: "a", overId: "c", cardIdsByColumn: board })).toEqual({
      columnId: "todo",
      index: 1,
    });
  });

  it("moves a card across columns at the target card's position", () => {
    expect(resolveDropTarget({ activeId: "a", overId: "y", cardIdsByColumn: board })).toEqual({
      columnId: "doing",
      index: 1,
    });
  });

  it("appends when dropped on a column body rather than a card", () => {
    expect(
      resolveDropTarget({
        activeId: "a",
        overId: columnDroppableId("doing"),
        cardIdsByColumn: board,
      }),
    ).toEqual({ columnId: "doing", index: 2 });
  });

  it("appends at index 0 for an empty column", () => {
    expect(
      resolveDropTarget({
        activeId: "a",
        overId: columnDroppableId("done"),
        cardIdsByColumn: board,
      }),
    ).toEqual({ columnId: "done", index: 0 });
  });

  it("excludes the dragged card when appending to its own column", () => {
    // [a, b, c] minus a is [b, c] — appending puts it at index 2, not 3.
    expect(
      resolveDropTarget({
        activeId: "a",
        overId: columnDroppableId("todo"),
        cardIdsByColumn: board,
      }),
    ).toEqual({ columnId: "todo", index: 2 });
  });

  it("returns null for a column that is not on the board", () => {
    expect(
      resolveDropTarget({
        activeId: "a",
        overId: columnDroppableId("nope"),
        cardIdsByColumn: board,
      }),
    ).toBeNull();
  });
});
