import type { Event } from "nostr-tools";
import { beforeEach, describe, expect, it } from "vitest";

import { EventStore } from "./EventStore";

function mkEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    pubkey: overrides.pubkey ?? "00".repeat(32),
    kind: overrides.kind ?? 1,
    created_at: overrides.created_at ?? Math.floor(Date.now() / 1000),
    tags: overrides.tags ?? [],
    content: overrides.content ?? "",
    sig: "00".repeat(64),
    ...overrides,
  };
}

describe("EventStore", () => {
  let store: EventStore;

  beforeEach(() => {
    store = new EventStore();
  });

  it("stores and retrieves by id", () => {
    const e = mkEvent({ id: "deadbeef" });
    store.store(e);
    expect(store.get("deadbeef")?.id).toBe("deadbeef");
  });

  it("query filters by kind+author", () => {
    store.store(mkEvent({ id: "a", kind: 1, pubkey: "p1" }));
    store.store(mkEvent({ id: "b", kind: 1, pubkey: "p2" }));
    store.store(mkEvent({ id: "c", kind: 7, pubkey: "p1" }));
    const result = store.query({ kinds: [1], authors: ["p1"] });
    expect(result.map((e) => e.id).sort()).toEqual(["a"]);
  });

  it("replaceable events: newer overrides older for same kind+pubkey+d-tag", () => {
    const older = mkEvent({
      id: "old",
      kind: 30168,
      pubkey: "p1",
      created_at: 1000,
      tags: [["d", "doc-1"]],
    });
    const newer = mkEvent({
      id: "new",
      kind: 30168,
      pubkey: "p1",
      created_at: 2000,
      tags: [["d", "doc-1"]],
    });
    store.store(older);
    store.store(newer);
    const result = store.query({ kinds: [30168], authors: ["p1"] });
    expect(result.map((e) => e.id)).toEqual(["new"]);
  });
});
