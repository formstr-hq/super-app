import { getNostrRuntime, defaultNostrRuntime } from "@formstr/core";
import {
  DataLayer,
  LocalRelayClient,
  MemoryStorage,
  RelayService,
  createChannelPair,
} from "@formstr/local-relay";
import { fakeSocketFactory, makeEvent } from "@formstr/local-relay/testkit";
import type { Event } from "nostr-tools";
import { describe, it, expect, afterEach } from "vitest";

import { installRuntime, isLocalRelayEnabled } from "./install";

const ME = "a".repeat(64);
const settle = () => new Promise((r) => setTimeout(r, 80));

async function wire() {
  const { client: clientCh, worker: workerCh } = createChannelPair();
  const f = fakeSocketFactory();
  const service = new RelayService({
    channel: workerCh,
    socketFactory: f.factory,
    storage: new MemoryStorage(),
    verify: () => true,
    now: () => 1_000_000,
  });
  await service.start();
  const client = new LocalRelayClient(clientCh, { unobserveGraceMs: 0 });
  const dataLayer = new DataLayer({ client, sign: async () => makeEvent({ id: "s".repeat(64) }) });
  await settle();
  return { f, dataLayer };
}

describe("isLocalRelayEnabled", () => {
  afterEach(() => localStorage.clear());

  it("is on by default", () => {
    expect(isLocalRelayEnabled()).toBe(true);
  });

  it("is off when the kill switch is set", () => {
    localStorage.setItem("formstr.localRelay", "off");
    expect(isLocalRelayEnabled()).toBe(false);
  });
});

describe("installRuntime", () => {
  it("routes core's runtime through the data layer, and restores it on teardown", async () => {
    const { f, dataLayer } = await wire();

    const teardown = installRuntime(dataLayer, ME);
    // Anything holding core's nostrRuntime — every agent service — now reaches
    // the network through the worker, without having changed.
    // Not awaited: publish resolves only once relays answer or the cap expires,
    // and this relay is deliberately silent. What matters is where it was sent.
    void getNostrRuntime().publish(["wss://kanban"], makeEvent({ id: "k".repeat(64) }) as Event);
    await settle();

    const sock = f.last("wss://kanban");
    sock.open();
    expect(sock.sent.some((m: unknown[]) => m[0] === "EVENT")).toBe(true);

    teardown();
    expect(getNostrRuntime()).toBe(defaultNostrRuntime);
  });

  it("declares the account's warm-up interests, and drops them on teardown", async () => {
    const { f, dataLayer } = await wire();

    const teardown = installRuntime(dataLayer, ME);
    await settle();
    // The forms list is one of the warm scopes, so its relays get a standing
    // subscription at install time rather than when a view mounts.
    const sock = f.last("wss://relay.damus.io");
    sock.open();
    await settle();
    expect(sock.sent.filter((m: unknown[]) => m[0] === "REQ").length).toBeGreaterThan(0);

    teardown();
    await settle();
    expect(sock.sent.some((m: unknown[]) => m[0] === "CLOSE")).toBe(true);
  });

  it("pauses the worker when the tab is hidden and resumes when it returns", async () => {
    const { f, dataLayer } = await wire();
    const teardown = installRuntime(dataLayer, ME);
    await settle();
    const sock = f.last("wss://relay.damus.io");
    sock.open();

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new globalThis.Event("visibilitychange"));
    await settle();
    expect(sock.readyState).toBe(3); // a backgrounded tab holds no sockets

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new globalThis.Event("visibilitychange"));
    await settle();
    expect(f.count("wss://relay.damus.io")).toBeGreaterThan(1); // reconnected

    teardown();
  });
});
