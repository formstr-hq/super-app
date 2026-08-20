/**
 * The kanban pane sentinel for the invitation inbox.
 *
 * `KanbanPage` reads its open pane from the catch-all route segment, which is
 * otherwise a `boardKey` — a replaceable-event coordinate, `kind:pubkey:d`.
 * Every one of those contains colons, so a bare word cannot collide with a
 * board and the inbox needs no route of its own.
 */
export const INVITATIONS_KEY = "invitations";
