import { afterEach, describe, expect, it, vi } from "vitest";

import { COALESCE_MS, RTO_INITIAL_MS } from "./constants";
import type { Frame } from "./frame";
import { Session } from "./session";

const flush = () => new Promise((r) => setTimeout(r, COALESCE_MS + 30));

/**
 * A controllable in-memory link between two Sessions. By default it delivers
 * every frame asynchronously (via microtask, to mimic the network and avoid
 * re-entrancy). Per direction it can also: capture frames instead of delivering
 * them (so a test can replay them in a chosen order), and drop the next N.
 */
function loopback(sessionId = "00112233445566778899aabbccddeeff") {
  const s: { a?: Session; b?: Session } = {};
  const captured: Record<Dir, Frame[]> = { ab: [], ba: [] };
  const capturing: Record<Dir, boolean> = { ab: false, ba: false };
  const drop: Record<Dir, number> = { ab: 0, ba: 0 };

  const route = (dir: Dir, frame: Frame) => {
    if (drop[dir] > 0) {
      drop[dir]--;
      return;
    }
    if (capturing[dir]) {
      captured[dir].push(frame);
      return;
    }
    const target = () => (dir === "ab" ? s.b : s.a);
    queueMicrotask(() => target()?.deliver(frame));
  };

  s.a = new Session({ peer: "bpub", role: "initiator", sessionId, send: (f) => route("ab", f) });
  s.b = new Session({ peer: "apub", role: "responder", sessionId, send: (f) => route("ba", f) });

  return {
    a: s.a,
    b: s.b,
    capture: (dir: Dir, on: boolean) => {
      capturing[dir] = on;
    },
    captured: (dir: Dir) => captured[dir],
    dropNext: (dir: Dir, n: number) => {
      drop[dir] += n;
    },
    deliver: (to: "a" | "b", frame: Frame) => (to === "a" ? s.a! : s.b!).deliver(frame),
  };
}
type Dir = "ab" | "ba";

async function readAll(stream: ReadableStream<Uint8Array>, count: number): Promise<Uint8Array[]> {
  const reader = stream.getReader();
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) out.push(value);
  }
  reader.releaseLock();
  return out;
}

const openLinks: Array<ReturnType<typeof loopback>> = [];
function link(id?: string) {
  const l = loopback(id);
  openLinks.push(l);
  return l;
}
afterEach(async () => {
  for (const l of openLinks) {
    await l.a.close().catch(() => {});
    await l.b.close().catch(() => {});
  }
  openLinks.length = 0;
  vi.useRealTimers();
});

describe("Session handshake", () => {
  it("completes a 2-way handshake", async () => {
    const l = link();
    await expect(l.a.start()).resolves.toBeUndefined();
  });
});

describe("Session data transfer", () => {
  it("delivers a small write to the peer", async () => {
    const l = link();
    await l.a.start();
    const writer = l.a.duplex.writable.getWriter();
    await writer.write(new Uint8Array([1, 2, 3]));
    const [chunk] = await readAll(l.b.duplex.readable, 1);
    expect(Array.from(chunk)).toEqual([1, 2, 3]);
  });

  it("chunks a write larger than the MTU and reassembles in order", async () => {
    const l = link();
    await l.a.start();
    const big = new Uint8Array(80 * 1024).map((_, i) => i % 256);
    const writer = l.a.duplex.writable.getWriter();
    await writer.write(big);
    // 80KiB / 32KiB MTU = 3 frames
    const chunks = await readAll(l.b.duplex.readable, 3);
    const joined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let off = 0;
    for (const c of chunks) {
      joined.set(c, off);
      off += c.length;
    }
    expect(joined.length).toBe(big.length);
    expect(joined).toEqual(big);
  });
});

describe("Session reliability", () => {
  it("reassembles out-of-order data frames", async () => {
    const l = link();
    await l.a.start();
    l.capture("ab", true); // hold A->B frames
    const writer = l.a.duplex.writable.getWriter();
    // wait past the coalescing window between writes so each is its own frame
    await writer.write(new Uint8Array([10]));
    await flush();
    await writer.write(new Uint8Array([20]));
    await flush();
    await writer.write(new Uint8Array([30]));
    await flush();
    const frames = l.captured("ab").filter((f) => f.payload.length > 0);
    expect(frames).toHaveLength(3);
    // deliver reversed
    l.deliver("b", frames[2]);
    l.deliver("b", frames[1]);
    l.deliver("b", frames[0]);
    const chunks = await readAll(l.b.duplex.readable, 3);
    expect(chunks.map((c) => c[0])).toEqual([10, 20, 30]);
  });

  it("drops duplicate data frames", async () => {
    const l = link();
    await l.a.start();
    l.capture("ab", true);
    const writer = l.a.duplex.writable.getWriter();
    await writer.write(new Uint8Array([42]));
    await flush(); // let the coalescing window emit the frame
    const [frame] = l.captured("ab").filter((f) => f.payload.length > 0);
    l.deliver("b", frame);
    l.deliver("b", frame); // duplicate
    l.deliver("b", frame); // duplicate
    const chunks = await readAll(l.b.duplex.readable, 1);
    expect(chunks.map((c) => c[0])).toEqual([42]);
  });

  it("retransmits a dropped data frame after the RTO", async () => {
    vi.useFakeTimers();
    const l = link();
    await l.a.start();
    l.dropNext("ab", 1); // lose the first transmission of the next frame
    const reader = l.b.duplex.readable.getReader();
    const writer = l.a.duplex.writable.getWriter();
    await writer.write(new Uint8Array([99]));
    // advance past the coalescing flush (frame is sent + dropped) then the RTO
    await vi.advanceTimersByTimeAsync(COALESCE_MS + RTO_INITIAL_MS + 50);
    const { value } = await reader.read();
    expect(value && Array.from(value)).toEqual([99]);
  });
});
