import { KANBAN_KINDS, type KanbanBoard } from "@formstr/kanban-sdk";

/**
 * A board's stable identity: its replaceable-event coordinate,
 * `kind:pubkey:d`. The `d` tag alone is not unique — a public and a private
 * board can share one, and two authors certainly can.
 */
export function boardKey(board: KanbanBoard): string {
  const kind = board.isPrivate ? KANBAN_KINDS.privateBoard : KANBAN_KINDS.publicBoard;
  return `${kind}:${board.pubkey}:${board.id}`;
}

/** The board key as it appears in a URL path segment. */
export function encodeBoardKey(board: KanbanBoard): string {
  return encodeURIComponent(boardKey(board));
}
