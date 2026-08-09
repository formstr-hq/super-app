import type { BoardMember, BoardRole, KanbanBoard } from "@formstr/kanban-sdk";

import { npubToHex } from "../lib/npub";

/**
 * The board's roster, owner first.
 *
 * The same derivation the SDK's `fetchMembers` performs — membership lives in
 * the board's own tags and takes no network — done synchronously so a member
 * list needs no loading state and no cache to go stale.
 */
export function boardMembers(board: KanbanBoard): BoardMember[] {
  return [
    { pubkey: board.pubkey, role: "owner" },
    ...board.maintainers.map((pubkey): BoardMember => ({ pubkey, role: "maintainer" })),
    ...board.members.map((pubkey): BoardMember => ({ pubkey, role: "member" })),
  ];
}

/**
 * The role a pubkey holds on a board, or null for a stranger.
 *
 * Derived from the board's own tags, which is what the SDK's `fetchMembers`
 * does too — membership takes no network, so there is nothing to cache.
 */
export function roleOf(board: KanbanBoard, pubkey: string | null): BoardRole | null {
  if (!pubkey) return null;
  if (board.pubkey === pubkey) return "owner";
  if (board.maintainers.includes(pubkey)) return "maintainer";
  if (board.members.includes(pubkey)) return "member";
  return null;
}

/**
 * Only the board's author may invite, change a role, or revoke.
 *
 * Not a UI preference: `invite` and `removeMember` publish through
 * `updatePrivateBoard`, and `rotateBoardKey` guards directly — all three throw
 * `NotBoardOwnerError` for anyone else. A maintainer may write cards and still
 * gets a read-only roster.
 */
export function canManageMembers(board: KanbanBoard, pubkey: string | null): boolean {
  return Boolean(pubkey) && board.pubkey === pubkey;
}

/**
 * Roles that can be handed out on this board.
 *
 * `member` means "holds the view key but is read-only by client convention",
 * which only means anything where there is a key to hold. A public board is
 * world-readable, so it offers maintainer alone.
 */
export function assignableRoles(board: KanbanBoard): Exclude<BoardRole, "owner">[] {
  return board.isPrivate ? ["maintainer", "member"] : ["maintainer"];
}

export function roleLabel(role: BoardRole): string {
  if (role === "owner") return "Owner";
  if (role === "maintainer") return "Editor";
  return "Viewer";
}

export function roleHelp(role: BoardRole): string {
  if (role === "owner") return "Created the board. Manages members and can do everything else.";
  if (role === "maintainer") return "Can add, edit, move, and delete cards.";
  return "Holds the board key and can read it. Cannot change cards.";
}

export type InviteeResult = { pubkey: string } | { error: string };

/**
 * Validate one invite-field entry against the board it is destined for.
 *
 * Accepts an npub or a raw 64-char hex pubkey. Rejects the signer's own key
 * (the owner is already the owner) and anyone the board already lists, because
 * `invite` would happily re-send them a wrap and read as a no-op.
 */
export function parseInvitee(
  input: string,
  board: KanbanBoard,
  self: string | null,
): InviteeResult {
  const trimmed = input.trim();
  if (!trimmed) return { error: "Enter an npub or a hex public key." };

  const pubkey = npubToHex(trimmed);
  if (!pubkey) return { error: "That is not a valid npub or 64-character hex public key." };

  if (pubkey === board.pubkey) {
    return { error: pubkey === self ? "That is you — you own this board." : "That is the owner." };
  }
  if (board.maintainers.includes(pubkey)) return { error: "Already an editor on this board." };
  if (board.members.includes(pubkey)) return { error: "Already a viewer on this board." };

  return { pubkey };
}
