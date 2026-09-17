import { LocalSigner } from "@formstr/core";
import type { NostrRuntimeContract, SubscribeOptions, SubscriptionHandle } from "@formstr/core";
import type { Event, Filter } from "nostr-tools";
import { describe, expect, it } from "vitest";

import { FrameType, type Frame } from "./frame";
import type { PrivacyMode, TransportOptions } from "./types";
import { Wire } from "./wire";

/**
 * A minimal in-memory relay implementing NostrRuntimeContract: published events
 * are fanned out to any subscription whose filter matches (kinds + `#p`). Enough
 * to prove the encrypt→publish→subscribe→decrypt→decode round-trip.
 */
class FakeRelay implements NostrRuntimeContract {
  private subs = new Set<{ filters: Filter[]; onEvent: (e: Event) => void }>();

  subscribe(_relays: string[], filters: Filter[], options?: SubscribeOptions): SubscriptionHandle {
    const entry = { filters, onEvent: options?.onEvent ?? (() => {}) };
    this.subs.add(entry);
    return { unsub: () => this.subs.delete(entry) };
  }
  async publish(_relays: string[], event: Event): Promise<void> {
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

  private matches(filter: Filter, event: Event): boolean {
    if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
    const p = filter["#p"];
    if (p && !event.tags.some((t) => t[0] === "p" && p.includes(t[1]))) return false;
    return true;
  }
}

function frame(over: Partial<Frame> = {}): Frame {
  return {
    session: "00112233445566778899aabbccddeeff",
    type: FrameType.Data,
    seq: 7,
    ack: 3,
    payload: new Uint8Array([1, 2, 3, 4]),
    ...over,
  };
}

function setup(privacy: PrivacyMode) {
  const runtime = new FakeRelay();
  const home = new LocalSigner();
  const edge = new LocalSigner();
  const base = { runtime, relays: ["wss://fake"], privacy };
  const homeWire = new Wire({ ...base, signer: home } as TransportOptions);
  const edgeWire = new Wire({ ...base, signer: edge } as TransportOptions);
  return { home, edge, homeWire, edgeWire };
}

for (const privacy of ["nip44", "nip59"] as const) {
  describe(`Wire round-trip (${privacy})`, () => {
    it("delivers a frame from edge to home with the verified sender", async () => {
      const { home, edge, homeWire, edgeWire } = setup(privacy);
      const homePk = await home.getPublicKey();
      const edgePk = await edge.getPublicKey();

      const received = new Promise<{ sender: string; frame: Frame }>((resolve) => {
        homeWire.subscribe((sender, f) => resolve({ sender, frame: f }));
      });
      // let the async subscribe setup (getPublicKey) settle before publishing
      await new Promise((r) => setTimeout(r, 0));

      const sent = frame();
      await edgeWire.send(homePk, sent);

      const got = await received;
      expect(got.sender).toBe(edgePk); // real sender recovered, even under nip59
      expect(got.frame.session).toBe(sent.session);
      expect(got.frame.seq).toBe(sent.seq);
      expect(got.frame.ack).toBe(sent.ack);
      expect(Array.from(got.frame.payload)).toEqual([1, 2, 3, 4]);
    });

    it("does not deliver frames addressed to a different pubkey", async () => {
      const { homeWire, edgeWire } = setup(privacy); // shared relay
      const otherPk = await new LocalSigner().getPublicKey();

      let delivered = false;
      homeWire.subscribe(() => {
        delivered = true;
      });
      await new Promise((r) => setTimeout(r, 0));

      // edge sends to `other`, not to home → home's `#p` filter must not match
      await edgeWire.send(otherPk, frame());
      await new Promise((r) => setTimeout(r, 10));
      expect(delivered).toBe(false);
    });
  });
}
