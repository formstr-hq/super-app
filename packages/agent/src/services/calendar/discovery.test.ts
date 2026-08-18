import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted so these exist when the hoisted vi.mock factories below run —
// a bare top-level const here would still be in its temporal dead zone.
const querySync = vi.hoisted(() => vi.fn());

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { querySync, subscribe: vi.fn(), publish: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://a.test"]) },
}));

const sdk = vi.hoisted(() => ({
  fetchEventsFromCalendars: vi.fn(),
  fetchPublicEvents: vi.fn(),
}));
vi.mock("./sdk", () => ({
  getCalendarSdk: vi.fn(async () => sdk),
  calendarRelays: () => ["wss://a.test"],
}));

import { signerManager } from "@formstr/core";

import { fetchEventsForUser } from "./discovery";

function wire(over: Partial<any> = {}) {
  return {
    id: "abc",
    pubkey: "alice",
    kind: 31923,
    created_at: 1000,
    tags: [
      ["d", "party"],
      ["title", "Party"],
      ["start", "1700000000"],
      ["end", "1700003600"],
    ],
    content: "",
    sig: "",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (signerManager.getSigner as any).mockResolvedValue({
    getPublicKey: vi.fn().mockResolvedValue("alice"),
  });
  sdk.fetchEventsFromCalendars.mockResolvedValue([]);
  sdk.fetchPublicEvents.mockResolvedValue([]);
  querySync.mockResolvedValue([]);
});

describe("fetchEventsForUser", () => {
  it("returns an authored event that no calendar list references", async () => {
    sdk.fetchPublicEvents.mockResolvedValue([{ id: "party", user: "alice", kind: 31923 }]);
    const events = await fetchEventsForUser({ calendars: [] });
    expect(events.map((e) => e.id)).toEqual(["party"]);
    // No window given — defaults to the signed-in user's own events.
    expect(sdk.fetchPublicEvents).toHaveBeenCalledWith(
      expect.objectContaining({ authors: ["alice"] }),
    );
  });

  it("browses public events broadly when given a window and no authors", async () => {
    await fetchEventsForUser({ calendars: [], since: 1_700_000_000 });
    expect(sdk.fetchPublicEvents).toHaveBeenCalledWith(
      expect.not.objectContaining({ authors: expect.anything() }),
    );
  });

  it("drops an event its author deleted", async () => {
    sdk.fetchPublicEvents.mockResolvedValue([{ id: "party", user: "alice", kind: 31923 }]);
    // The deletion sweep queries kind 5 per collected author.
    querySync.mockImplementation(async (_relays: string[], filter: any) =>
      filter.kinds?.[0] === 5 ? [wire({ kind: 5, tags: [["a", "31923:alice:party"]] })] : [],
    );
    expect(await fetchEventsForUser({ calendars: [] })).toEqual([]);
  });

  it("keeps one copy when a list ref and the direct query return the same event", async () => {
    sdk.fetchPublicEvents.mockResolvedValue([{ id: "party", user: "alice", kind: 31923 }]);
    sdk.fetchEventsFromCalendars.mockResolvedValue([{ id: "party", user: "alice", kind: 31923 }]);
    expect(await fetchEventsForUser({ calendars: [] })).toHaveLength(1);
  });

  it("returns a private event reached through a calendar-list ref", async () => {
    sdk.fetchEventsFromCalendars.mockResolvedValue([
      { id: "retreat", user: "alice", kind: 32678, isPrivate: true, title: "Retreat" },
    ]);
    const events = await fetchEventsForUser({ calendars: [{} as any] });
    expect(events.map((e) => e.id)).toEqual(["retreat"]);
  });
});
