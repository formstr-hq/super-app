import type { Event } from "nostr-tools";
import { describe, it, expect, vi, afterEach } from "vitest";

import { NostrRuntime } from "./NostrRuntime";

const event: Event = {
  id: "e1",
  pubkey: "p1",
  kind: 1,
  created_at: 1000,
  content: "",
  tags: [],
  sig: "sig",
};

describe("NostrRuntime.publish", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when all relay publishes settle", async () => {
    const runtime = new NostrRuntime();
    vi.spyOn(runtime.pool, "publish").mockReturnValue([
      Promise.resolve("ok"),
      Promise.reject(new Error("relay down")),
    ]);

    await runtime.publish(["wss://a", "wss://b"], event);
    expect(runtime.get("e1")).toBeDefined();
  });

  it("resolves after the timeout even if a relay never settles (no hung submits)", async () => {
    vi.useFakeTimers();
    const runtime = new NostrRuntime();
    vi.spyOn(runtime.pool, "publish").mockReturnValue([
      new Promise<string>(() => {}), // relay that never acks
    ]);

    let resolved = false;
    const p = runtime.publish(["wss://dead"], event).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(9_000);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    await p;
    expect(resolved).toBe(true);
    expect(runtime.get("e1")).toBeDefined();
  });
});
