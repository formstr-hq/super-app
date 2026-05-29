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

  it("query by ids returns matching events", () => {
    const e1 = mkEvent({ id: "id1" });
    const e2 = mkEvent({ id: "id2" });
    store.store(e1);
    store.store(e2);
    const result = store.query({ ids: ["id1"] });
    expect(result.map((e) => e.id)).toEqual(["id1"]);
  });

  it("query with no filter returns all events", () => {
    store.store(mkEvent({ id: "a" }));
    store.store(mkEvent({ id: "b" }));
    const result = store.query({});
    expect(result.length).toBe(2);
  });

  it("remove() removes an event by id", () => {
    const e = mkEvent({ id: "rm1" });
    store.store(e);
    expect(store.get("rm1")).toBeDefined();
    store.remove("rm1");
    expect(store.get("rm1")).toBeUndefined();
  });

  it("NIP-09 deletion: same-author deletion removes target", () => {
    const author = "aa".repeat(32);
    const target = mkEvent({ id: "target1", pubkey: author });
    store.store(target);
    const deletion = mkEvent({
      id: "del1",
      kind: 5,
      pubkey: author,
      tags: [["e", "target1"]],
    });
    store.store(deletion);
    expect(store.get("target1")).toBeUndefined();
  });

  it("subscribe() notifies on matching new events", () => {
    const received: string[] = [];
    const unsub = store.subscribe({ kinds: [1] }, (e) => received.push(e.id));
    store.store(mkEvent({ id: "sub1", kind: 1 }));
    store.store(mkEvent({ id: "sub2", kind: 7 }));
    unsub();
    store.store(mkEvent({ id: "sub3", kind: 1 }));
    expect(received).toEqual(["sub1"]);
  });

  it("clear() wipes all state", () => {
    store.store(mkEvent({ id: "clr1" }));
    expect(store.size).toBe(1);
    store.clear();
    expect(store.size).toBe(0);
    expect(store.get("clr1")).toBeUndefined();
  });

  it("older replaceable event does not replace newer", () => {
    const newer = mkEvent({
      id: "n1",
      kind: 30168,
      pubkey: "p1",
      created_at: 2000,
      tags: [["d", "d1"]],
    });
    const older = mkEvent({
      id: "o1",
      kind: 30168,
      pubkey: "p1",
      created_at: 1000,
      tags: [["d", "d1"]],
    });
    store.store(newer);
    const accepted = store.store(older);
    expect(accepted).toBe(false);
    const result = store.query({ kinds: [30168] });
    expect(result.map((e) => e.id)).toEqual(["n1"]);
  });

  it("duplicate event is not stored twice", () => {
    const e = mkEvent({ id: "dup1" });
    store.store(e);
    const result = store.store(e);
    expect(result).toBe(false);
    expect(store.size).toBe(1);
  });
});
