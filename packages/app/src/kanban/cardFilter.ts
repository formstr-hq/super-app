import type { KanbanCard } from "@formstr/kanban-sdk";

/**
 * Board toolbar state. Every predicate runs client-side over the cards the
 * store already holds — relays cannot filter for us, and a board small enough
 * to fetch is small enough to scan.
 */
export interface CardFilter {
  /** Free text over title and description. */
  query: string;
  /** Cards where the signed-in pubkey is an assignee. */
  assignedToMe: boolean;
  /** Cards with no assignee at all. */
  unassigned: boolean;
  /** Cards carrying any one of these labels. */
  labels: string[];
}

export const EMPTY_FILTER: CardFilter = {
  query: "",
  assignedToMe: false,
  unassigned: false,
  labels: [],
};

export function isFilterActive(filter: CardFilter): boolean {
  return (
    filter.query.trim() !== "" ||
    filter.assignedToMe ||
    filter.unassigned ||
    filter.labels.length > 0
  );
}

/**
 * Assignee chips OR with each other (both on = "mine or nobody's"), labels OR
 * with each other, and the three groups AND together — the arrangement Jira's
 * quick filters use, and the one that makes "my unassigned bugs" impossible to
 * ask for by accident.
 */
export function filterCards(
  cards: KanbanCard[],
  filter: CardFilter,
  selfPubkey: string | null,
): KanbanCard[] {
  const query = filter.query.trim().toLowerCase();
  // Without a key there is no "me", so the chip cannot narrow anything.
  const byMine = filter.assignedToMe && Boolean(selfPubkey);
  const wanted = new Set(filter.labels);

  return cards.filter((card) => {
    if (query) {
      const haystack = `${card.title} ${card.description}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    if (byMine || filter.unassigned) {
      const mine = byMine && selfPubkey ? card.assignees.includes(selfPubkey) : false;
      const nobodys = filter.unassigned ? card.assignees.length === 0 : false;
      if (!mine && !nobodys) return false;
    }

    if (wanted.size > 0 && !card.labels.some((label) => wanted.has(label))) return false;

    return true;
  });
}

/**
 * Translate a drop index measured against the *filtered* column into one the
 * store can rank against the whole column. Both lists are rank-ascending and
 * already exclude the dragged card. The card lands immediately before whatever
 * it was dropped above on screen, so a hidden neighbour never swallows it.
 */
export function unfilteredDropIndex(
  fullColumn: KanbanCard[],
  visibleColumn: KanbanCard[],
  visibleIndex: number,
): number {
  if (visibleIndex >= visibleColumn.length) return fullColumn.length;
  const anchor = visibleColumn[visibleIndex];
  const index = fullColumn.findIndex((c) => c.id === anchor.id);
  return index >= 0 ? index : fullColumn.length;
}

/** Labels present on the board, most-used first, ties broken alphabetically. */
export function collectLabels(cards: KanbanCard[]): string[] {
  const counts = new Map<string, number>();
  for (const card of cards) {
    if (card.binned) continue;
    for (const label of card.labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => label);
}
