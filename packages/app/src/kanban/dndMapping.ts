/**
 * Translating a drag gesture into the SDK's move arguments.
 *
 * Kept pure and free of dnd-kit types so the index arithmetic — the part that
 * actually breaks — is unit-testable without a DOM.
 */

/** Droppable id for an empty (or under-full) column region. */
export const COLUMN_DROPPABLE_PREFIX = "column:";

export function columnDroppableId(columnId: string): string {
  return `${COLUMN_DROPPABLE_PREFIX}${columnId}`;
}

export interface DropTarget {
  columnId: string;
  /**
   * Insertion index within the destination column **excluding the dragged
   * card** — the coordinate space `computeRank(sortedRanks, targetIndex)`
   * expects, since it is handed the column's ranks minus the card being moved.
   */
  index: number;
}

export interface ResolveDropArgs {
  /** The card being dragged. */
  activeId: string;
  /** What it was dropped on: another card's id, or a column droppable id. */
  overId: string | null;
  /** Card ids per column id, each already in display (rank-ascending) order. */
  cardIdsByColumn: Record<string, string[]>;
}

/**
 * Resolve where a drag ended. Returns null when the gesture is a no-op: dropped
 * outside any target, onto itself, or back into the exact slot it came from —
 * all of which would otherwise publish a pointless card revision.
 */
export function resolveDropTarget({
  activeId,
  overId,
  cardIdsByColumn,
}: ResolveDropArgs): DropTarget | null {
  if (!overId || overId === activeId) return null;

  const sourceColumnId = findColumnOf(activeId, cardIdsByColumn);

  const targetColumnId = overId.startsWith(COLUMN_DROPPABLE_PREFIX)
    ? overId.slice(COLUMN_DROPPABLE_PREFIX.length)
    : findColumnOf(overId, cardIdsByColumn);

  if (targetColumnId === null || !(targetColumnId in cardIdsByColumn)) return null;

  // The destination as it will look once the card is lifted out of it.
  const without = cardIdsByColumn[targetColumnId].filter((id) => id !== activeId);

  const index = overId.startsWith(COLUMN_DROPPABLE_PREFIX)
    ? without.length // dropped on the column body — append
    : without.indexOf(overId);

  if (index < 0) return null;

  // Same column, same slot: nothing moved.
  if (sourceColumnId === targetColumnId) {
    const from = cardIdsByColumn[targetColumnId].indexOf(activeId);
    const settled = [...without];
    settled.splice(index, 0, activeId);
    if (from === settled.indexOf(activeId)) return null;
  }

  return { columnId: targetColumnId, index };
}

function findColumnOf(cardId: string, cardIdsByColumn: Record<string, string[]>): string | null {
  for (const [columnId, ids] of Object.entries(cardIdsByColumn)) {
    if (ids.includes(cardId)) return columnId;
  }
  return null;
}
