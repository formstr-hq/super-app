import type { Filter } from "nostr-tools";
import { describe, it, expect } from "vitest";

import { WarmupRegistry, warmScopesFor } from "./warmup";

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

describe("warmScopesFor", () => {
  it("covers each module's own-scope reads, scoped to the user", () => {
    const scopes = warmScopesFor(ME);
    const kinds = scopes.flatMap((s) => s.filters.flatMap((f) => f.kinds ?? []));

    expect(kinds).toContain(14083); // forms list
    expect(kinds).toContain(30301); // public boards
    expect(kinds).toContain(32303); // private board list
    expect(kinds).toContain(32123); // calendar lists
    expect(kinds).toContain(34578); // drive file metadata
    expect(kinds).toContain(0); // own profile
  });

  it("routes each scope to its module's relays", () => {
    // A warm interest that read from the wrong relays would keep a cache warm
    // with events the module never publishes there.
    for (const scope of warmScopesFor(ME)) {
      expect(scope.relays.length).toBeGreaterThan(0);
    }
  });

  it("asks only for the user's own events, never the whole kind", () => {
    for (const scope of warmScopesFor(ME)) {
      for (const filter of scope.filters) {
        const scoped = filter.authors?.includes(ME) || filter["#p"]?.includes(ME);
        expect(scoped).toBe(true);
      }
    }
  });
});

describe("WarmupRegistry", () => {
  it("declares every scope on start and drops them all on stop", () => {
    const dataLayer = fakeDataLayer();
    const registry = new WarmupRegistry(dataLayer);

    registry.start(ME);
    expect(dataLayer.declared.length).toBe(warmScopesFor(ME).length);
    expect(dataLayer.declared.every((d) => d.live)).toBe(true);

    registry.stop();
    expect(dataLayer.declared.every((d) => !d.live)).toBe(true);
  });

  it("vouches for a read its interests cover, and not for others", () => {
    const dataLayer = fakeDataLayer();
    const registry = new WarmupRegistry(dataLayer);
    registry.start(ME);

    expect(registry.covers({ kinds: [14083], authors: [ME] })).toBe(true);
    expect(registry.covers({ kinds: [14083], authors: ["b".repeat(64)] })).toBe(false);
    expect(registry.covers({ kinds: [9999], authors: [ME] })).toBe(false);
  });

  it("vouches for nothing once stopped", () => {
    // Logout drops the interests; a read that still settled fast afterwards
    // would be trusting a cache nobody is refreshing.
    const registry = new WarmupRegistry(fakeDataLayer());
    registry.start(ME);
    registry.stop();

    expect(registry.covers({ kinds: [14083], authors: [ME] })).toBe(false);
  });

  it("replaces the previous account's interests when a new one starts", () => {
    const dataLayer = fakeDataLayer();
    const registry = new WarmupRegistry(dataLayer);
    const other = "c".repeat(64);

    registry.start(ME);
    registry.start(other);

    expect(dataLayer.declared.filter((d) => d.live).length).toBe(warmScopesFor(other).length);
    expect(registry.covers({ kinds: [14083], authors: [ME] })).toBe(false);
    expect(registry.covers({ kinds: [14083], authors: [other] })).toBe(true);
  });
});
