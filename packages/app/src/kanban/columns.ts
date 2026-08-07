import type { Column, KanbanBoard, KanbanCard } from "@formstr/kanban-sdk";

/**
 * A card's `status` is the column **name** on a public board and the column
 * **id** on a private one — the two codecs differ (see the SDK's `KanbanCard`).
 * Every read or write of `card.status` in this app goes through this file so
 * that branch exists exactly once.
 */
export function statusFor(board: KanbanBoard, column: Column): string {
  return board.isPrivate ? column.id : column.name;
}

/** The column a card currently sits in, or undefined when its status is stale. */
export function columnForCard(board: KanbanBoard, card: KanbanCard): Column | undefined {
  return board.columns.find((c) => statusFor(board, c) === card.status);
}

/** Board columns in display order. */
export function sortedColumns(board: KanbanBoard): Column[] {
  return [...board.columns].sort((a, b) => a.order - b.order);
}

/**
 * Cards grouped by column id, each group sorted by ascending rank. Cards whose
 * status matches no column are dropped rather than silently piled into the
 * first one — they belong to a column that was renamed or removed, and showing
 * them under the wrong heading would invite a move that rewrites the wrong rank.
 */
export function groupCardsByColumn(
  board: KanbanBoard,
  cards: KanbanCard[],
): Record<string, KanbanCard[]> {
  const groups: Record<string, KanbanCard[]> = {};
  for (const column of board.columns) groups[column.id] = [];

  for (const card of cards) {
    if (card.binned) continue;
    const column = columnForCard(board, card);
    if (column) groups[column.id].push(card);
  }

  for (const id of Object.keys(groups)) {
    groups[id].sort((a, b) => a.rank - b.rank);
  }
  return groups;
}
