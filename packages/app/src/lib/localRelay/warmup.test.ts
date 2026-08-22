import type { Filter } from "nostr-tools";
import { describe, it, expect, vi, afterEach } from "vitest";

import { scopesFor } from "../live/scopes";

import { WarmupRegistry, currentWarmup, setCurrentWarmup } from "./warmup";

const ME = "a".repeat(64);

/** Records declarations without a worker behind them. */
function fakeDataLayer() {
  const declared: Array<{ filters: Filter[]; relays?: string[]; live: boolean }> = [];
  return {
    declared,
    observe: (filters: Filter[], _handlers: unknown, options?: { relays?: string[] }) => {
      const entry = { filters, relays: options?.relays, live: true };
      declared.push(entry);
      return { unobserve: () => (entry.live = false) };
    },
  };
}

describe("WarmupRegistry", () => {
  afterEach(() => vi.useRealTimers());

  it("declares every scope on start and drops them all on stop", () => {
    const dataLayer = fakeDataLayer();
    const registry = new WarmupRegistry(dataLayer);

    registry.start(ME);
    expect(dataLayer.declared.length).toBe(scopesFor(ME).length);
    expect(dataLayer.declared.every((d) => d.live)).toBe(true);

    registry.stop();
    expect(dataLayer.declared.every((d) => !d.live)).toBe(true);
  });

  it("vouches for a read its interests cover, and not for others", () => {
    const dataLayer = fakeDataLayer();
    // No sync window: this is about which filters match, not about timing.
    const registry = new WarmupRegistry(dataLayer, 0);
    registry.start(ME);

    expect(registry.covers({ kinds: [14083], authors: [ME] })).toBe(true);
    expect(registry.covers({ kinds: [14083], authors: ["b".repeat(64)] })).toBe(false);
    expect(registry.covers({ kinds: [9999], authors: [ME] })).toBe(false);
  });

  it("vouches for nothing until its interests have had time to sync", () => {
    // A cache restored from IndexedDB can hold yesterday's copy while the
    // standing interest's first round trip is still in flight. Settling a read
    // early in that window would serve the stale one, so the registry stays
    // silent until the interest has plausibly caught up.
    vi.useFakeTimers();
    const registry = new WarmupRegistry(fakeDataLayer());
    registry.start(ME);

    expect(registry.covers({ kinds: [14083], authors: [ME] })).toBe(false);

    vi.advanceTimersByTime(3000);
    expect(registry.covers({ kinds: [14083], authors: [ME] })).toBe(true);
  });

  it("vouches for nothing once stopped", () => {
    // Logout drops the interests; a read that still settled fast afterwards
    // would be trusting a cache nobody is refreshing.
    const registry = new WarmupRegistry(fakeDataLayer());
    registry.start(ME);
    registry.stop();

    expect(registry.covers({ kinds: [14083], authors: [ME] })).toBe(false);
  });

  it("vouches for a scope another owner registered, once it has had time to sync", () => {
    // The open board's cards: live-watched by the kanban store, covered by no
    // boot-time interest. Untracked, every refetch of that board pays the full
    // cold quiet window even though the store is being kept current.
    vi.useFakeTimers();
    const registry = new WarmupRegistry(fakeDataLayer());
    registry.start(ME);
    const cards: Filter = { kinds: [30302], "#a": ["30301:" + ME + ":board"] };

    expect(registry.covers(cards)).toBe(false);

    const untrack = registry.track([cards]);
    expect(registry.covers(cards)).toBe(false);

    vi.advanceTimersByTime(3000);
    expect(registry.covers(cards)).toBe(true);

    untrack();
    expect(registry.covers(cards)).toBe(false);
  });

  it("does not declare an interest for a scope it only tracks", () => {
    // The subscription belongs to the caller; tracking is bookkeeping, and a
    // second interest over the same filters would decode everything twice.
    const dataLayer = fakeDataLayer();
    const registry = new WarmupRegistry(dataLayer, 0);
    const before = dataLayer.declared.length;

    registry.track([{ kinds: [30302] }]);

    expect(dataLayer.declared.length).toBe(before);
  });

  it("forgets tracked scopes on stop, like its own", () => {
    const registry = new WarmupRegistry(fakeDataLayer(), 0);
    registry.track([{ kinds: [30302] }]);

    registry.stop();

    expect(registry.covers({ kinds: [30302] })).toBe(false);
  });

  it("replaces the previous account's interests when a new one starts", () => {
    const dataLayer = fakeDataLayer();
    const registry = new WarmupRegistry(dataLayer, 0);
    const other = "c".repeat(64);

    registry.start(ME);
    registry.start(other);

    expect(dataLayer.declared.filter((d) => d.live).length).toBe(scopesFor(other).length);
    expect(registry.covers({ kinds: [14083], authors: [ME] })).toBe(false);
    expect(registry.covers({ kinds: [14083], authors: [other] })).toBe(true);
  });

  it("exposes the registry in force, and forgets it on sign-out", () => {
    // How a live scope opened later, by a store that knows nothing about the
    // network backend, finds the registry to register with.
    expect(currentWarmup()).toBeNull();

    const registry = new WarmupRegistry(fakeDataLayer(), 0);
    setCurrentWarmup(registry);
    expect(currentWarmup()).toBe(registry);

    setCurrentWarmup(null);
    expect(currentWarmup()).toBeNull();
  });
});
