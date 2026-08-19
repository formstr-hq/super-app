import type { KanbanBoard } from "@formstr/kanban-sdk";

/**
 * A minimal board, for tests only — nothing in the app imports this.
 *
 * The membership surface spans a store, four components, and two pure modules,
 * all of which need a board to talk about; a shared builder keeps a change to
 * `KanbanBoard` a one-file fix instead of a six-file one.
 */
export function makeBoard(overrides: Partial<KanbanBoard> = {}): KanbanBoard {
  return {
    id: "board-1",
    pubkey: "owner",
    eventId: "evt",
    title: "Board",
    description: "",
    columns: [
      { id: "todo", name: "To Do", order: 0 },
      { id: "doing", name: "In Progress", order: 1 },
    ],
    maintainers: [],
    members: [],
    noZap: false,
    createdAt: 1,
    isPrivate: true,
    legacy: false,
    rawTags: [],
    ...overrides,
  };
}
