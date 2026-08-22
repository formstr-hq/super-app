import type { Event, Filter } from "nostr-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const subscribe = vi.fn();

vi.mock("@formstr/core", () => ({
  nostrRuntime: {
    subscribe: (relays: string[], filters: Filter[], options?: unknown) =>
      subscribe(relays, filters, options),
  },
}));

import { LiveSync } from "./liveSync";

interface Handlers {
  onEvent?: (event: Event) => void;
  onEose?: () => void;
}

/** The most recent fake subscription, plus a way to drive its handlers. */
function lastSub() {
  const call = subscribe.mock.calls.at(-1);
  return {
    relays: call?.[0] as string[],
    filters: call?.[1] as Filter[],
    handlers: call?.[2] as Handlers,
  };
}

const unsubs: ReturnType<typeof vi.fn>[] = [];

const event = (id: string) => ({ id }) as Event;

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
  vi.useRealTimers();
});

describe("LiveSync", () => {
  const scope = (onChange: () => void) => ({
    key: "kanban",
    filters: [{ kinds: [30301] }],
    relays: ["wss://a.test"],
    onChange,
  });

  it("subscribes with the scope's filters and relays", () => {
    new LiveSync().open(scope(vi.fn()));
    expect(lastSub().relays).toEqual(["wss://a.test"]);
    expect(lastSub().filters).toEqual([{ kinds: [30301] }]);
  });

  it("ignores events replayed before EOSE", () => {
    const onChange = vi.fn();
    new LiveSync().open(scope(onChange));

    // The local relay replays its whole cache before EOSE. That is the data the
    // store is already loading, not news.
    lastSub().handlers.onEvent?.(event("cached-1"));
    lastSub().handlers.onEvent?.(event("cached-2"));
    vi.advanceTimersByTime(1000);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("invalidates on an event after EOSE", () => {
    const onChange = vi.fn();
    new LiveSync().open(scope(onChange));

    lastSub().handlers.onEose?.();
    lastSub().handlers.onEvent?.(event("live-1"));
    vi.advanceTimersByTime(250);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst into a single invalidation", () => {
    const onChange = vi.fn();
    new LiveSync().open(scope(onChange));
    lastSub().handlers.onEose?.();

    for (const id of ["a", "b", "c", "d"]) {
      lastSub().handlers.onEvent?.(event(id));
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(250);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("invalidates again for events arriving after a settled burst", () => {
    const onChange = vi.fn();
    new LiveSync().open(scope(onChange));
    lastSub().handlers.onEose?.();

    lastSub().handlers.onEvent?.(event("a"));
    vi.advanceTimersByTime(250);
    lastSub().handlers.onEvent?.(event("b"));
    vi.advanceTimersByTime(250);

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("replaces a scope opened under the same key", () => {
    const live = new LiveSync();
    live.open(scope(vi.fn()));
    live.open({ ...scope(vi.fn()), filters: [{ kinds: [30302] }] });

    expect(unsubs[0]).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(lastSub().filters).toEqual([{ kinds: [30302] }]);
  });

  it("keeps scopes under different keys independent", () => {
    const live = new LiveSync();
    const kanban = vi.fn();
    const forms = vi.fn();
    live.open(scope(kanban));
    live.open({ ...scope(forms), key: "forms" });

    // Drive the kanban subscription, which is the first one opened.
    const kanbanHandlers = subscribe.mock.calls[0][2] as Handlers;
    kanbanHandlers.onEose?.();
    kanbanHandlers.onEvent?.(event("a"));
    vi.advanceTimersByTime(250);

    expect(kanban).toHaveBeenCalledTimes(1);
    expect(forms).not.toHaveBeenCalled();
  });

  it("stops invalidating once the returned handle is closed", () => {
    const onChange = vi.fn();
    const close = new LiveSync().open(scope(onChange));
    const { handlers } = lastSub();

    handlers.onEose?.();
    handlers.onEvent?.(event("a"));
    close();
    vi.advanceTimersByTime(250);

    expect(unsubs[0]).toHaveBeenCalledTimes(1);
    // A debounce already ticking must not fire into a closed scope — the store
    // it would refetch may belong to an account that just signed out.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closeAll drops every scope", () => {
    const live = new LiveSync();
    live.open(scope(vi.fn()));
    live.open({ ...scope(vi.fn()), key: "forms" });
    live.closeAll();

    expect(unsubs[0]).toHaveBeenCalledTimes(1);
    expect(unsubs[1]).toHaveBeenCalledTimes(1);
  });

  it("close is idempotent", () => {
    const live = new LiveSync();
    const close = live.open(scope(vi.fn()));
    close();
    close();
    live.closeAll();
    expect(unsubs[0]).toHaveBeenCalledTimes(1);
  });
});
