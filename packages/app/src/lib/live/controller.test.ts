import type { Event, Filter } from "nostr-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const subscribe = vi.fn();
const fetchBoards = vi.fn(async () => {});

vi.mock("@formstr/core", () => ({
  nostrRuntime: {
    subscribe: (relays: string[], filters: Filter[], options?: unknown) =>
      subscribe(relays, filters, options),
  },
  relayManager: {
    getRelaysForModule: (m: string) => [`wss://${m}.test`],
    getAllRelays: () => ["wss://all.test"],
  },
}));

vi.mock("./bindings", () => ({
  refetchFor: (module: string) => (module === "kanban" ? fetchBoards : undefined),
}));

import { retargetLiveSync } from "./controller";

interface Handlers {
  onEvent?: (event: Event) => void;
  onEose?: () => void;
}

const unsubs: ReturnType<typeof vi.fn>[] = [];

/** Drive the subscription opened for `module`. */
function driveScope(module: string) {
  const call = subscribe.mock.calls.find((c) => (c[0] as string[])[0] === `wss://${module}.test`);
  const handlers = call?.[2] as Handlers;
  handlers.onEose?.();
  handlers.onEvent?.({ id: "live" } as Event);
}

beforeEach(() => {
  vi.clearAllMocks();
  unsubs.length = 0;
  vi.useFakeTimers();
  subscribe.mockImplementation(() => {
    const unsub = vi.fn();
    unsubs.push(unsub);
    return { unsub };
  });
});

afterEach(() => {
  retargetLiveSync(null);
  vi.useRealTimers();
});

describe("retargetLiveSync", () => {
  it("watches only the scopes that have a binding", () => {
    retargetLiveSync("abc");
    // forms, kanban, calendar, drive and profile are watched; invitations and
    // deletions are warm-only, and the mock binds kanban alone.
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect((subscribe.mock.calls[0][0] as string[])[0]).toBe("wss://kanban.test");
  });

  it("refetches the bound store when a watched scope changes", () => {
    retargetLiveSync("abc");
    driveScope("kanban");
    vi.advanceTimersByTime(250);
    expect(fetchBoards).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst into one refetch", () => {
    retargetLiveSync("abc");
    for (let i = 0; i < 5; i++) {
      driveScope("kanban");
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(250);
    expect(fetchBoards).toHaveBeenCalledTimes(1);
  });

  it("drops the previous account's scopes on a switch", () => {
    retargetLiveSync("abc");
    retargetLiveSync("def");
    expect(unsubs[0]).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it("stops watching on sign-out", () => {
    retargetLiveSync("abc");
    retargetLiveSync(null);
    expect(unsubs[0]).toHaveBeenCalledTimes(1);
  });

  it("does not resubscribe when retargeted to the same account", () => {
    // authStore's sync() runs on every signer change, not just account changes.
    retargetLiveSync("abc");
    retargetLiveSync("abc");
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it("does not refetch for events that arrive after sign-out", () => {
    retargetLiveSync("abc");
    const call = subscribe.mock.calls[0];
    const handlers = call[2] as Handlers;
    handlers.onEose?.();
    handlers.onEvent?.({ id: "live" } as Event);
    retargetLiveSync(null);
    vi.advanceTimersByTime(250);
    expect(fetchBoards).not.toHaveBeenCalled();
  });
});
