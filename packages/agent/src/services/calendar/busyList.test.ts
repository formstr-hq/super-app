import { signerManager, nostrRuntime } from "@formstr/core";
import type { Event } from "nostr-tools";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { publish: vi.fn(), querySync: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.test"]) },
}));

import {
  busyListMonthKey,
  busyListMonthKeysForRange,
  busyListToTags,
  parseBusyListEvent,
  fetchBusyListsForUser,
  addBusyRange,
  removeBusyRange,
} from "./busyList";
import { CALENDAR_KINDS } from "./types";

const mockSigner = {
  getPublicKey: vi.fn().mockResolvedValue("aabbccdd"),
  signEvent: vi
    .fn()
    .mockImplementation((e: any) =>
      Promise.resolve({ ...e, id: "eid", sig: "sig", pubkey: "aabbccdd" }),
    ),
};

const busyEvent = (overrides: Partial<Event> = {}): Event =>
  ({
    id: "b1",
    pubkey: "aabbccdd",
    kind: CALENDAR_KINDS.publicBusyList,
    created_at: 100,
    sig: "s",
    content: "",
    tags: [
      ["d", "2026-06"],
      ["t", "2026-06"],
      ["t", "busy"],
      ["block", "1780300000", "1780303600"],
    ],
    ...overrides,
  }) as Event;

beforeEach(() => {
  vi.clearAllMocks();
  (signerManager.getSigner as any).mockResolvedValue(mockSigner);
  (nostrRuntime.publish as any).mockResolvedValue(undefined);
  (nostrRuntime.querySync as any).mockResolvedValue([]);
});

describe("month key helpers", () => {
  it("derives YYYY-MM in UTC", () => {
    // 2026-06-01T00:00:00Z
    expect(busyListMonthKey(Date.UTC(2026, 5, 1))).toBe("2026-06");
    // A ms before is still May in UTC regardless of local tz.
    expect(busyListMonthKey(Date.UTC(2026, 5, 1) - 1)).toBe("2026-05");
  });

  it("returns every month a range touches, inclusive", () => {
    expect(busyListMonthKeysForRange(Date.UTC(2026, 4, 31), Date.UTC(2026, 6, 1))).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
    ]);
    expect(busyListMonthKeysForRange(Date.UTC(2026, 5, 10), Date.UTC(2026, 5, 11))).toEqual([
      "2026-06",
    ]);
  });
});

describe("busy list codec (kind 31926 wire format)", () => {
  it("serializes d/t/t + repeatable block rows in unix seconds, empty content", () => {
    const tags = busyListToTags({
      user: "aabbccdd",
      monthKey: "2026-06",
      ranges: [{ start: 1780300000000, end: 1780303600000 }],
      eventId: "",
      createdAt: 0,
    });
    expect(tags).toEqual([
      ["d", "2026-06"],
      ["t", "2026-06"],
      ["t", "busy"],
      ["block", "1780300000", "1780303600"],
    ]);
  });

  it("parses an upstream-authored event, sorting and deduping ranges", () => {
    const list = parseBusyListEvent(
      busyEvent({
        tags: [
          ["d", "2026-06"],
          ["block", "1780307200", "1780310800"],
          ["block", "1780300000", "1780303600"],
          ["block", "1780300000", "1780303600"], // dupe
          ["block", "bad", "values"], // skipped
          ["block", "1780310800", "1780307200"], // end<=start skipped
        ],
      }),
    );
    expect(list).not.toBeNull();
    expect(list!.monthKey).toBe("2026-06");
    expect(list!.ranges).toEqual([
      { start: 1780300000000, end: 1780303600000 },
      { start: 1780307200000, end: 1780310800000 },
    ]);
  });

  it("returns null for a non-month d-tag", () => {
    expect(parseBusyListEvent(busyEvent({ tags: [["d", "not-a-month"]] }))).toBeNull();
  });
});

describe("fetchBusyListsForUser", () => {
  it("queries kind 31926 by author + month d-tags, newest wins per month", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      busyEvent({ id: "old", created_at: 50, tags: [["d", "2026-06"]] }),
      busyEvent({ id: "new", created_at: 100 }),
    ]);
    const lists = await fetchBusyListsForUser("hostpub", ["2026-06"]);
    expect(lists).toHaveLength(1);
    expect(lists[0].eventId).toBe("new");
    const [, filter] = (nostrRuntime.querySync as any).mock.calls[0];
    expect(filter.kinds).toEqual([CALENDAR_KINDS.publicBusyList]);
    expect(filter.authors).toEqual(["hostpub"]);
    expect(filter["#d"]).toEqual(["2026-06"]);
  });

  it("returns [] for an empty month set without querying", async () => {
    expect(await fetchBusyListsForUser("hostpub", [])).toEqual([]);
    expect(nostrRuntime.querySync).not.toHaveBeenCalled();
  });
});

describe("addBusyRange", () => {
  it("publishes a fresh month list when none exists", async () => {
    await addBusyRange({ start: 1780300000000, end: 1780303600000 });
    const [relays, evt] = (nostrRuntime.publish as any).mock.calls[0];
    expect(relays).toEqual(["wss://relay.test"]);
    expect(evt.kind).toBe(CALENDAR_KINDS.publicBusyList);
    expect(evt.content).toBe("");
    expect(evt.tags).toContainEqual(["block", "1780300000", "1780303600"]);
    expect(evt.tags).toContainEqual(["t", "busy"]);
  });

  it("appends to an existing month list, keeping prior blocks", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([busyEvent()]);
    await addBusyRange({ start: 1780307200000, end: 1780310800000 });
    const evt = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(evt.tags).toContainEqual(["block", "1780300000", "1780303600"]);
    expect(evt.tags).toContainEqual(["block", "1780307200", "1780310800"]);
  });

  it("is idempotent: an exact existing [start,end] pair is not republished", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([busyEvent()]);
    await addBusyRange({ start: 1780300000000, end: 1780303600000 });
    expect(nostrRuntime.publish).not.toHaveBeenCalled();
  });
});

describe("removeBusyRange", () => {
  it("removes the exact pair and republishes the month", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      busyEvent({
        tags: [
          ["d", "2026-06"],
          ["block", "1780300000", "1780303600"],
          ["block", "1780307200", "1780310800"],
        ],
      }),
    ]);
    await removeBusyRange({ start: 1780300000000, end: 1780303600000 });
    const evt = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(evt.tags).not.toContainEqual(["block", "1780300000", "1780303600"]);
    expect(evt.tags).toContainEqual(["block", "1780307200", "1780310800"]);
  });

  it("is a no-op when the pair is absent", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([busyEvent()]);
    await removeBusyRange({ start: 1, end: 2 });
    expect(nostrRuntime.publish).not.toHaveBeenCalled();
  });
});
