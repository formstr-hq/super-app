import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted so these exist when the hoisted vi.mock factories below run —
// a bare top-level const here would still be in its temporal dead zone.
const querySync = vi.hoisted(() => vi.fn());

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn(), getSignerIfAvailable: vi.fn(() => ({})) },
  nostrRuntime: { querySync, subscribe: vi.fn(), publish: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://a.test"]) },
}));

const sdk = vi.hoisted(() => ({
  fetchEventsFromCalendars: vi.fn(),
  fetchPublicEvents: vi.fn(),
  fetchCalendars: vi.fn(),
}));
const anonSdk = vi.hoisted(() => ({
  fetchEventsFromCalendars: vi.fn(),
  fetchPublicEvents: vi.fn(),
  fetchCalendars: vi.fn(),
}));
const getCalendarSdk = vi.hoisted(() => vi.fn(async () => sdk));
const getAnonymousCalendarSdk = vi.hoisted(() => vi.fn(async () => anonSdk));
vi.mock("./sdk", () => ({
  getCalendarSdk,
  getAnonymousCalendarSdk,
  calendarRelays: () => ["wss://a.test"],
}));

import { signerManager } from "@formstr/core";

import { fetchEventsDirect, fetchEventsForUser } from "./discovery";

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
  (signerManager.getSignerIfAvailable as any).mockReturnValue({});
  sdk.fetchEventsFromCalendars.mockResolvedValue([]);
  sdk.fetchPublicEvents.mockResolvedValue([]);
  sdk.fetchCalendars.mockResolvedValue([]);
  anonSdk.fetchEventsFromCalendars.mockResolvedValue([]);
  anonSdk.fetchPublicEvents.mockResolvedValue([]);
  anonSdk.fetchCalendars.mockResolvedValue([]);
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
  it("keeps an event when a different author's deletion names its coordinate", async () => {
    sdk.fetchPublicEvents.mockResolvedValue([
      { id: "party", user: "alice", kind: 31923 },
      { id: "gig", user: "mallory", kind: 31923 },
    ]);
    // Mallory forges an `a` row against Alice's coordinate. NIP-09 deletions
    // only bind their own author's events.
    querySync.mockImplementation(async (_relays: string[], filter: any) =>
      filter.kinds?.[0] === 5
        ? [wire({ id: "del", pubkey: "mallory", kind: 5, tags: [["a", "31923:alice:party"]] })]
        : [],
    );
    const events = await fetchEventsForUser({ calendars: [] });
    expect(events.map((e) => e.id).sort()).toEqual(["gig", "party"]);
  });

  it("keeps an event republished after its own deletion", async () => {
    sdk.fetchPublicEvents.mockResolvedValue([
      { id: "party", user: "alice", kind: 31923, createdAt: 2000 },
    ]);
    querySync.mockImplementation(async (_relays: string[], filter: any) =>
      filter.kinds?.[0] === 5
        ? [
            wire({
              id: "del",
              pubkey: "alice",
              kind: 5,
              created_at: 1000,
              tags: [["a", "31923:alice:party"]],
            }),
          ]
        : [],
    );
    const events = await fetchEventsForUser({ calendars: [] });
    expect(events.map((e) => e.id)).toEqual(["party"]);
  });

  it("sweeps deletions for every author in one query", async () => {
    sdk.fetchPublicEvents.mockResolvedValue([
      { id: "party", user: "alice", kind: 31923 },
      { id: "gig", user: "bob", kind: 31923 },
    ]);
    await fetchEventsForUser({ calendars: [] });
    const deletionCalls = querySync.mock.calls.filter((c: any[]) => c[1]?.kinds?.[0] === 5);
    expect(deletionCalls).toHaveLength(1);
    expect(deletionCalls[0][1].authors.sort()).toEqual(["alice", "bob"]);
  });

  it("browses public events with no signer instead of prompting for login", async () => {
    (signerManager.getSignerIfAvailable as any).mockReturnValue(null);
    anonSdk.fetchPublicEvents.mockResolvedValue([{ id: "party", user: "alice", kind: 31923 }]);
    const events = await fetchEventsForUser({ since: 1_700_000_000 });
    expect(events.map((e) => e.id)).toEqual(["party"]);
    expect(getCalendarSdk).not.toHaveBeenCalled();
  });

  it("still requires a signer to decrypt calendar-list members", async () => {
    (signerManager.getSignerIfAvailable as any).mockReturnValue(null);
    await fetchEventsForUser({ calendars: [{} as any], since: 1_700_000_000 });
    expect(getCalendarSdk).toHaveBeenCalled();
  });
});

describe("fetchEventsDirect", () => {
  it("includes private events by loading the caller's calendar lists", async () => {
    sdk.fetchCalendars.mockResolvedValue([{ id: "work" } as any]);
    sdk.fetchEventsFromCalendars.mockResolvedValue([
      { id: "retreat", user: "alice", kind: 32678, isPrivate: true },
    ]);
    const events = await fetchEventsDirect();
    expect(events.map((e) => e.id)).toEqual(["retreat"]);
  });

  it("survives a calendar-list fetch failure and still returns public events", async () => {
    sdk.fetchCalendars.mockRejectedValue(new Error("relay down"));
    sdk.fetchPublicEvents.mockResolvedValue([{ id: "party", user: "alice", kind: 31923 }]);
    expect((await fetchEventsDirect()).map((e) => e.id)).toEqual(["party"]);
  });
});
