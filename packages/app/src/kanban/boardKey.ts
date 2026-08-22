import { KANBAN_KINDS, type KanbanBoard } from "@formstr/kanban-sdk";
import { nip19 } from "nostr-tools";

/**
 * A board's stable identity: its replaceable-event coordinate,
 * `kind:pubkey:d`. The `d` tag alone is not unique — a public and a private
 * board can share one, and two authors certainly can. This is the internal
 * key used everywhere boards and cards are stored and looked up; what goes in
 * a URL is `naddrForBoard`.
 */
export function boardKey(board: KanbanBoard): string {
  const kind = board.isPrivate ? KANBAN_KINDS.privateBoard : KANBAN_KINDS.publicBoard;
  return `${kind}:${board.pubkey}:${board.id}`;
}

/**
 * Encode a board coordinate (`boardKey` shape) as a NIP-19 `naddr` for a URL.
 *
 * A coordinate that is not a real address — a non-hex pubkey, no `d` at all —
 * falls back to the raw coordinate, percent-encoded. `naddrEncode` throws on
 * those, and the coordinates reaching here are not all ours: an accepted
 * invitation carries whatever the gift wrap's `a` tag said. The fallback
 * survives the round trip because `coordinateFromNaddr` hands an undecodable
 * segment back to its caller unchanged.
 */
export function naddrForCoordinate(coordinate: string, relays?: string[]): string {
  const [kindStr, pubkey, ...rest] = coordinate.split(":");
  try {
    return nip19.naddrEncode({
      kind: Number(kindStr),
      pubkey,
      identifier: rest.join(":"),
      relays,
    });
  } catch {
    return encodeURIComponent(coordinate);
  }
}

/**
 * The board's URL path segment: its coordinate encoded as `naddr`, carrying
 * the relay that accepted the board when we know it. The hint is what lets a
 * shared link resolve for someone whose relay set does not already overlap
 * ours; this app's own reader ignores it, since `fetchBoardByCoordinate` takes
 * no relay override.
 */
export function naddrForBoard(board: KanbanBoard): string {
  return naddrForCoordinate(boardKey(board), board.relayHint ? [board.relayHint] : undefined);
}

/**
 * Decode a URL path segment back to a board coordinate, or null when the
 * segment is not an `naddr` at all — a route sentinel such as `invitations`,
 * a raw `kind:pubkey:d` coordinate from a link predating naddr URLs, or junk.
 * Telling those apart is the caller's job.
 */
export function coordinateFromNaddr(segment: string): string | null {
  try {
    const decoded = nip19.decode(segment);
    if (decoded.type !== "naddr") return null;
    const ptr = decoded.data;
    return `${ptr.kind}:${ptr.pubkey}:${ptr.identifier}`;
  } catch {
    return null;
  }
}
