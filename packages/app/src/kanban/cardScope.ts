import { KANBAN_KINDS, boardPointer, type KanbanBoard } from "@formstr/kanban-sdk";
import type { Filter } from "nostr-tools";

import { boardKey } from "./boardKey";

/**
 * What to watch while a board is open.
 *
 * The standing warm-up interests cover the user's board *list*, not any board's
 * contents, so without this a collaborator's card edit stays invisible until the
 * page is reloaded. This is the scope that makes the board itself live.
 *
 * Returns null for a private board whose view key the user does not hold or
 * cannot use: the pointer cards are found by is derived from that key, and the
 * cards could not be decrypted even if they arrived.
 */
export function cardScopeFilters(board: KanbanBoard): Filter[] | null {
  // Deletions arrive as tombstones rather than as edits to the card, so a card
  // removed by a maintainer would otherwise never invalidate the board.
  const deletions: Filter = {
    kinds: [KANBAN_KINDS.deletion],
    authors: [board.pubkey, ...board.maintainers],
  };

  if (!board.isPrivate) {
    return [{ kinds: [KANBAN_KINDS.publicCard], "#a": [boardKey(board)] }, deletions];
  }

  if (!board.viewKey) return null;
  try {
    return [
      { kinds: [KANBAN_KINDS.privateCard], "#b": [boardPointer(board, board.viewKey)] },
      deletions,
    ];
  } catch {
    // Pointer derivation decodes the key and throws on a malformed one. Going
    // without the live scope costs a refresh; throwing here would take down the
    // board the user just opened.
    return null;
  }
}
