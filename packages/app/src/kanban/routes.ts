/**
 * The kanban pane sentinel for the invitation inbox.
 *
 * `KanbanPage` reads its open pane from the catch-all route segment, which is
 * otherwise a board's `naddr` (see `boardKey.ts`) — an `naddr1…` bech32
 * string, so a bare word cannot collide with one and the inbox needs no
 * route of its own.
 */
export const INVITATIONS_KEY = "invitations";
