import {
  DataLayer,
  LocalRelayClient,
  MemoryStorage,
  RelayService,
  createChannelPair,
} from "@formstr/local-relay";
import { fakeSocketFactory, makeEvent } from "@formstr/local-relay/testkit";
import type { Event } from "nostr-tools";
import { describe, it, expect } from "vitest";

import { LocalRelayRuntime } from "./LocalRelayRuntime";

const NOW = 1_000_000;
const settle = () => new Promise((r) => setTimeout(r, 80));

/** A real RelayService over a fake socket — the engine, not a mock of it. */
async function wire() {
  const { client: clientCh, worker: workerCh } = createChannelPair();
  const f = fakeSocketFactory();
  const service = new RelayService({
    channel: workerCh,
    socketFactory: f.factory,
    storage: new MemoryStorage(),
    verify: () => true,
    now: () => NOW,
  });
  await service.start();
  const client = new LocalRelayClient(clientCh, { unobserveGraceMs: 0 });
  client.setUserRelays(["wss://user"]);
  const dataLayer = new DataLayer({ client, sign: async () => makeEvent({ id: "s".repeat(64) }) });
  await settle();
  // Short windows keep the suite quick; the policy itself is asserted below.
  const runtime = new LocalRelayRuntime(dataLayer, {
    timeoutMs: 300,
    quietMs: 60,
    publishTimeoutMs: 200,
  });
  return { f, service, runtime };
}

describe("LocalRelayRuntime", () => {
  it("querySync collects what the relays deliver and settles on its own", async () => {
    const { f, runtime } = await wire();

    const pending = runtime.querySync(["wss://module"], { kinds: [30301] });
    await settle();

    const sock = f.last("wss://module");
    sock.open();
    const subId = sock.sent.find((m: unknown[]) => m[0] === "REQ")?.[1];
    sock.emit(["EVENT", subId, makeEvent({ id: "a".repeat(64), kind: 30301, pubkey: "alice" })]);
    // EOSE is not completion here — the store replay already fired one, and the
    // read must keep collecting until the network goes quiet.
    sock.emit(["EOSE", subId]);

    const events = await pending;
    expect(events.map((e) => e.id)).toEqual(["a".repeat(64)]);
  });

  it("publishes to the module relays it was given", async () => {
    const { f, runtime } = await wire();
    const board = makeEvent({ id: "b".repeat(64), kind: 30301, pubkey: "me" });

    // The whole reason the substrate keeps per-module relay sets: kanbanstr reads
    // boards from the kanban relays, and the worker would never route there.
    await runtime.publish(["wss://kanban"], board);
    await settle();

    const sock = f.last("wss://kanban");
    sock.open();
    expect(
      sock.sent.some((m: unknown[]) => m[0] === "EVENT" && (m[1] as Event).id === board.id),
    ).toBe(true);
  });

  it("publish resolves even when no relay accepts, because the outbox owns retries", async () => {
    const { runtime } = await wire();
    // Nothing opens, nothing acknowledges. The worker holds the debt; a caller
    // that treated this as failure would double-publish on every reconnect.
    await expect(
      runtime.publish(["wss://dead"], makeEvent({ id: "d".repeat(64), kind: 1, pubkey: "me" })),
    ).resolves.toBeUndefined();
  });

  it("subscribe streams events until it is unsubscribed", async () => {
    const { f, runtime } = await wire();
    const seen: string[] = [];

    const handle = runtime.subscribe(["wss://module"], [{ kinds: [1] }], {
      onEvent: (e) => seen.push(e.id),
    });
    await settle();
    const sock = f.last("wss://module");
    sock.open();
    const subId = sock.sent.find((m: unknown[]) => m[0] === "REQ")?.[1];
    sock.emit(["EVENT", subId, makeEvent({ id: "c".repeat(64), kind: 1, pubkey: "alice" })]);
    await settle();

    expect(seen).toEqual(["c".repeat(64)]);

    handle.unsub();
    await settle();
    expect(sock.sent.some((m: unknown[]) => m[0] === "CLOSE")).toBe(true);
  });

  it("fetchOne resolves the first matching event, and null when there is none", async () => {
    const { f, runtime } = await wire();

    const pending = runtime.fetchOne(["wss://module"], { kinds: [1] });
    await settle();
    const sock = f.last("wss://module");
    sock.open();
    const subId = sock.sent.find((m: unknown[]) => m[0] === "REQ")?.[1];
    sock.emit(["EVENT", subId, makeEvent({ id: "e".repeat(64), kind: 1, pubkey: "alice" })]);

    expect((await pending)?.id).toBe("e".repeat(64));
    await expect(runtime.fetchOne(["wss://module"], { kinds: [7] })).resolves.toBeNull();
  });

  it("dispose drops the interests it opened", async () => {
    const { f, runtime } = await wire();
    runtime.subscribe(["wss://module"], [{ kinds: [1] }], {});
    await settle();
    const sock = f.last("wss://module");
    sock.open();

    runtime.dispose();
    await settle();

    // The worker outlives the runtime — boot owns it — but a disposed runtime
    // must not leave standing interests behind holding sockets open.
    expect(sock.sent.some((m: unknown[]) => m[0] === "CLOSE")).toBe(true);
  });

  it("querySync resolves empty rather than hanging when nothing answers", async () => {
    const { runtime } = await wire();
    await expect(runtime.querySync(["wss://module"], { kinds: [30301] })).resolves.toEqual([]);
  });
});
