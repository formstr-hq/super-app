import { KANBAN_KINDS, type KanbanBoard } from "@formstr/kanban-sdk";
import { generateSecretKey, nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import { boardKey } from "./boardKey";
import { cardScopeFilters } from "./cardScope";

const board = (overrides: Partial<KanbanBoard> = {}): KanbanBoard =>
  ({
    id: "b1",
    pubkey: "owner",
    eventId: "evt",
    title: "Board",
    description: "",
    columns: [],
    maintainers: [],
    members: [],
    noZap: false,
    isPrivate: false,
    createdAt: 1,
    ...overrides,
  }) as KanbanBoard;

describe("cardScopeFilters", () => {
  it("watches a public board's cards by its coordinate", () => {
    const b = board();
    const filters = cardScopeFilters(b)!;
    expect(filters[0]).toEqual({
      kinds: [KANBAN_KINDS.publicCard],
      "#a": [boardKey(b)],
    });
  });

  it("watches a private board's cards by their blinded pointer", () => {
    // Private cards carry no coordinate — they are found by a `b` tag derived
    // from the view key, so the raw coordinate would match nothing.
    const filters = cardScopeFilters(
      board({ isPrivate: true, viewKey: nip19.nsecEncode(generateSecretKey()) }),
    )!;
    expect(filters[0].kinds).toEqual([KANBAN_KINDS.privateCard]);
    expect(filters[0]["#a"]).toBeUndefined();
    expect(filters[0]["#b"]?.[0]).toBeTruthy();
  });

  it("declines to watch a private board whose key is unusable", () => {
    // A malformed key throws inside the pointer derivation. Opening a board
    // must not take the page down over a scope it can simply do without.
    expect(cardScopeFilters(board({ isPrivate: true, viewKey: "not-an-nsec" }))).toBeNull();
  });

  it("declines to watch a private board whose key is not held", () => {
    // Without the key the pointer cannot be derived, and the cards could not be
    // decrypted even if they arrived.
    expect(cardScopeFilters(board({ isPrivate: true, viewKey: undefined }))).toBeNull();
  });

  it("watches deletions by everyone allowed to write cards", () => {
    // A card removed by a maintainer is a change the board has to see, and it
    // arrives as a tombstone rather than as an edit to the card.
    const filters = cardScopeFilters(board({ maintainers: ["mA", "mB"] }))!;
    const deletions = filters.find((f) => f.kinds?.includes(KANBAN_KINDS.deletion))!;
    expect(deletions.authors).toEqual(["owner", "mA", "mB"]);
  });

  it("gives two boards different scopes", () => {
    const a = cardScopeFilters(board({ id: "b1" }))!;
    const b = cardScopeFilters(board({ id: "b2" }))!;
    expect(a[0]["#a"]).not.toEqual(b[0]["#a"]);
  });
});
