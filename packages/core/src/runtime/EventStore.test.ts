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

  // ── NIP-09 deletion edge cases (parity with the standalone's EventStore) ──

  it("NIP-09: e-tag deletion of a cached event by a DIFFERENT author neither removes nor tombstones it", () => {
    const target = mkEvent({ id: "victim1", pubkey: "aa".repeat(32) });
    store.store(target);
    store.store(
      mkEvent({ id: "del2", kind: 5, pubkey: "bb".repeat(32), tags: [["e", "victim1"]] }),
    );
    expect(store.get("victim1")?.id).toBe("victim1");
  });

  it("NIP-09: a-tag deletion arriving BEFORE its target tombstones the coordinate", () => {
    const author = "aa".repeat(32);
    const coord = `31923:${author}:ev1`;
    store.store(
      mkEvent({ id: "del3", kind: 5, pubkey: author, created_at: 2000, tags: [["a", coord]] }),
    );
    const accepted = store.store(
      mkEvent({
        id: "late1",
        kind: 31923,
        pubkey: author,
        created_at: 1500,
        tags: [["d", "ev1"]],
      }),
    );
    expect(accepted).toBe(false);
    expect(store.get("late1")).toBeUndefined();
  });

  it("NIP-09: an addressable event REPUBLISHED after the deletion survives", () => {
    const author = "aa".repeat(32);
    const coord = `31923:${author}:ev2`;
    store.store(
      mkEvent({ id: "del4", kind: 5, pubkey: author, created_at: 2000, tags: [["a", coord]] }),
    );
    const accepted = store.store(
      mkEvent({
        id: "repub1",
        kind: 31923,
        pubkey: author,
        created_at: 3000,
        tags: [["d", "ev2"]],
      }),
    );
    expect(accepted).toBe(true);
    expect(store.get("repub1")?.id).toBe("repub1");
  });

  it("NIP-09: a-tag deletion whose coordinate author differs from the deleter is ignored", () => {
    const author = "aa".repeat(32);
    const forger = "bb".repeat(32);
    const coord = `31923:${author}:ev3`;
    store.store(
      mkEvent({ id: "del5", kind: 5, pubkey: forger, created_at: 2000, tags: [["a", coord]] }),
    );
    const accepted = store.store(
      mkEvent({
        id: "safe1",
        kind: 31923,
        pubkey: author,
        created_at: 1000,
        tags: [["d", "ev3"]],
      }),
    );
    expect(accepted).toBe(true);
  });

  // ── kind-84 participant removal (parity with the standalone's EventStore) ──

  it("kind 84: a participant removing themselves removes the event and blocks re-adding", () => {
    const remover = "cc".repeat(32);
    const event = mkEvent({ id: "wrap1", kind: 1052, tags: [["p", remover]] });
    store.store(event);
    store.store(mkEvent({ id: "rm1", kind: 84, pubkey: remover, tags: [["e", "wrap1"]] }));
    expect(store.get("wrap1")).toBeUndefined();
    expect(store.store(event)).toBe(false);
  });

  it("kind 84: a NON-participant's removal of a cached event is ignored", () => {
    const stranger = "dd".repeat(32);
    const event = mkEvent({ id: "wrap2", kind: 1052, tags: [["p", "ee".repeat(32)]] });
    store.store(event);
    store.store(mkEvent({ id: "rm2", kind: 84, pubkey: stranger, tags: [["e", "wrap2"]] }));
    expect(store.get("wrap2")?.id).toBe("wrap2");
  });

  it("kind 84: a-tag removal by a participant removes the matching addressable event", () => {
    const remover = "cc".repeat(32);
    const author = "aa".repeat(32);
    const coord = `31923:${author}:meet1`;
    store.store(
      mkEvent({
        id: "ev84",
        kind: 31923,
        pubkey: author,
        tags: [
          ["d", "meet1"],
          ["p", remover],
        ],
      }),
    );
    store.store(mkEvent({ id: "rm3", kind: 84, pubkey: remover, tags: [["a", coord]] }));
    expect(store.get("ev84")).toBeUndefined();
  });
});
