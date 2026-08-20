import type { KanbanCard } from "@formstr/kanban-sdk";
import { describe, expect, it } from "vitest";

import {
  collectLabels,
  EMPTY_FILTER,
  filterCards,
  isFilterActive,
  unfilteredDropIndex,
} from "./cardFilter";

function makeCard(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: "card-1",
    pubkey: "pk",
    authorPubkey: "pk",
    rotated: false,
    eventId: "evt",
    boardCoordinate: "30301:pk:board",
    title: "Card",
    description: "",
    status: "todo",
    rank: 0,
    attachments: [],
    assignees: [],
    labels: [],
    links: [],
    binned: false,
    isPrivate: false,
    createdAt: 1,
    rawTags: [],
    ...overrides,
  };
}

describe("isFilterActive", () => {
  it("is false for the empty filter and for whitespace-only queries", () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, query: "   " })).toBe(false);
  });

  it("is true once any predicate is set", () => {
    expect(isFilterActive({ ...EMPTY_FILTER, query: "sdk" })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, assignedToMe: true })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, labels: ["bug"] })).toBe(true);
  });
});

describe("filterCards", () => {
  const cards = [
    makeCard({ id: "a", title: "Publish the SDK", assignees: ["me"], labels: ["release"] }),
    makeCard({ id: "b", title: "Fix drift", description: "recurrence in UTC", labels: ["bug"] }),
    makeCard({ id: "c", title: "Review PR", assignees: ["other"], labels: ["bug", "release"] }),
  ];

  it("returns everything when nothing is set", () => {
    expect(filterCards(cards, EMPTY_FILTER, "me")).toHaveLength(3);
  });

  it("matches the query against title and description, case-insensitively", () => {
    expect(filterCards(cards, { ...EMPTY_FILTER, query: "sdk" }, "me").map((c) => c.id)).toEqual([
      "a",
    ]);
    expect(
      filterCards(cards, { ...EMPTY_FILTER, query: "RECURRENCE" }, "me").map((c) => c.id),
    ).toEqual(["b"]);
  });

  it("narrows to the signed-in user's cards", () => {
    expect(
      filterCards(cards, { ...EMPTY_FILTER, assignedToMe: true }, "me").map((c) => c.id),
    ).toEqual(["a"]);
  });

  it("ignores assignedToMe when there is no signed-in key", () => {
    expect(filterCards(cards, { ...EMPTY_FILTER, assignedToMe: true }, null)).toHaveLength(3);
  });

  it("ORs the two assignee chips together", () => {
    const both = { ...EMPTY_FILTER, assignedToMe: true, unassigned: true };
    expect(filterCards(cards, both, "me").map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("ORs labels with each other and ANDs them with the rest", () => {
    expect(filterCards(cards, { ...EMPTY_FILTER, labels: ["bug"] }, "me").map((c) => c.id)).toEqual(
      ["b", "c"],
    );
    expect(
      filterCards(cards, { ...EMPTY_FILTER, labels: ["bug"], unassigned: true }, "me").map(
        (c) => c.id,
      ),
    ).toEqual(["b"]);
  });
});

describe("unfilteredDropIndex", () => {
  const full = [
    makeCard({ id: "a" }),
    makeCard({ id: "hidden-1" }),
    makeCard({ id: "b" }),
    makeCard({ id: "hidden-2" }),
    makeCard({ id: "c" }),
  ];
  const visible = [full[0], full[2], full[4]];

  it("is the identity when nothing is hidden", () => {
    expect(unfilteredDropIndex(full, full, 3)).toBe(3);
  });

  it("maps a visible slot onto the position of the card it was dropped above", () => {
    expect(unfilteredDropIndex(full, visible, 0)).toBe(0);
    expect(unfilteredDropIndex(full, visible, 1)).toBe(2);
    expect(unfilteredDropIndex(full, visible, 2)).toBe(4);
  });

  it("appends when dropped past the last visible card", () => {
    expect(unfilteredDropIndex(full, visible, 3)).toBe(5);
  });

  it("appends when the visible column is empty", () => {
    expect(unfilteredDropIndex(full, [], 0)).toBe(5);
  });

  it("appends when the anchor is not in the full column", () => {
    expect(unfilteredDropIndex(full, [makeCard({ id: "ghost" })], 0)).toBe(5);
  });
});

describe("collectLabels", () => {
  it("orders by frequency, then alphabetically, and skips binned cards", () => {
    const cards = [
      makeCard({ labels: ["bug", "release"] }),
      makeCard({ labels: ["bug"] }),
      makeCard({ labels: ["app"] }),
      makeCard({ labels: ["ghost"], binned: true }),
    ];
    expect(collectLabels(cards)).toEqual(["bug", "app", "release"]);
  });
});
