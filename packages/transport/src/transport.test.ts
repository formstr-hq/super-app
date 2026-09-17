import { LocalSigner } from "@formstr/core";
import type { NostrRuntimeContract, SubscribeOptions, SubscriptionHandle } from "@formstr/core";
import type { Event, Filter } from "nostr-tools";
import { describe, expect, it } from "vitest";

import { connect, listen } from "./transport";
import type { NostrDuplex, TransportOptions } from "./types";

/** Shared in-memory relay (fans out by kinds + `#p`). */
class FakeRelay implements NostrRuntimeContract {
  private subs = new Set<{ filters: Filter[]; onEvent: (e: Event) => void }>();
  subscribe(_r: string[], filters: Filter[], options?: SubscribeOptions): SubscriptionHandle {
    const entry = { filters, onEvent: options?.onEvent ?? (() => {}) };
    this.subs.add(entry);
    return { unsub: () => this.subs.delete(entry) };
  }
  async publish(_r: string[], event: Event): Promise<void> {
    for (const sub of this.subs) {
      if (sub.filters.some((f) => this.matches(f, event))) queueMicrotask(() => sub.onEvent(event));
    }
  }
  async fetchOne(): Promise<Event | null> {
    return null;
  }
  async querySync(): Promise<Event[]> {
    return [];
  }
  dispose(): void {
    this.subs.clear();
  }
  private matches(f: Filter, e: Event): boolean {
    if (f.kinds && !f.kinds.includes(e.kind)) return false;
    const p = f["#p"];
    if (p && !e.tags.some((t) => t[0] === "p" && p.includes(t[1]))) return false;
    return true;
  }
}

async function readOne(d: NostrDuplex): Promise<Uint8Array> {
  const reader = d.readable.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  return value!;
}
async function write(d: NostrDuplex, bytes: number[]): Promise<void> {
  const w = d.writable.getWriter();
  await w.write(new Uint8Array(bytes));
  w.releaseLock();
}

describe("connect() <-> listen() end to end", () => {
  it("establishes a whitelisted session and streams bytes both ways", async () => {
    const runtime = new FakeRelay();
    const home = new LocalSigner();
    const edge = new LocalSigner();
    const homePk = await home.getPublicKey();
    const edgePk = await edge.getPublicKey();
    const relays = ["wss://fake"];

    const listener = listen(
      { runtime, signer: home, relays } as TransportOptions,
      (pk) => pk === edgePk, // whitelist
    );
    const homeSidePromise = new Promise<NostrDuplex>((res) => listener.onConnection(res));

    const edgeDuplex = await connect({ runtime, signer: edge, relays } as TransportOptions, {
      to: homePk,
    });
    const homeDuplex = await homeSidePromise;

    // edge -> home
    await write(edgeDuplex, [1, 2, 3]);
    expect(Array.from(await readOne(homeDuplex))).toEqual([1, 2, 3]);

    // home -> edge
    await write(homeDuplex, [9, 8, 7]);
    expect(Array.from(await readOne(edgeDuplex))).toEqual([9, 8, 7]);

    await listener.close();
  });

  it("rejects a peer that is not on the allowlist", async () => {
    const runtime = new FakeRelay();
    const home = new LocalSigner();
    const edge = new LocalSigner();
    const homePk = await home.getPublicKey();
    const relays = ["wss://fake"];

    const listener = listen({ runtime, signer: home, relays } as TransportOptions, () => false);
    let connected = false;
    listener.onConnection(() => {
      connected = true;
    });

    // handshake should never complete → connect() rejects/times out; race a timer
    const result = await Promise.race([
      connect({ runtime, signer: edge, relays } as TransportOptions, { to: homePk }).then(
        () => "connected" as const,
        () => "failed" as const,
      ),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 50)),
    ]);

    expect(connected).toBe(false);
    expect(result).not.toBe("connected");
    await listener.close();
  });
});
