import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

import type { NostrDuplex } from "@formstr/nostr-transport";
import { nip19 } from "nostr-tools";

import type { HarnessConfig } from "./config.js";
import type { HomeNodeState } from "./state.js";

/** A TransformStream that reports the byte length of every chunk that flows through. */
function countingStream(onCount: (n: number) => void): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream({
    transform(chunk, controller) {
      onCount(chunk.byteLength);
      controller.enqueue(chunk);
    },
  });
}

/**
 * Spawn one ACP harness for a session and pipe it to the duplex, registering the
 * session (and byte counters) with the admin state. The transport is ACP-blind;
 * the ACP protocol lives entirely in the harness.
 */
export function bridgeToHarness(
  duplex: NostrDuplex,
  harness: HarnessConfig,
  state: HomeNodeState,
): void {
  const id = `${duplex.peer.slice(0, 12)}-${Date.now().toString(36)}`;
  const child = spawn(harness.command, harness.args ?? [], {
    cwd: harness.cwd,
    env: { ...process.env, ...harness.env },
    stdio: ["pipe", "pipe", "inherit"],
  });

  const kill = () => {
    if (!child.killed) child.kill();
    void duplex.close().catch(() => {});
  };

  state.register(
    {
      id,
      peerHex: duplex.peer,
      peerNpub: nip19.npubEncode(duplex.peer),
      pid: child.pid ?? null,
      startedAt: Date.now(),
      bytesIn: 0,
      bytesOut: 0,
      status: "active",
    },
    kill,
  );
  console.log(`[${id}] harness "${harness.command}" pid=${child.pid}`);

  // edge -> (count) -> harness stdin
  duplex.readable
    .pipeThrough(countingStream((n) => state.countIn(id, n)))
    .pipeTo(Writable.toWeb(child.stdin))
    .catch(() => {});
  // harness stdout -> (count) -> edge
  (Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>)
    .pipeThrough(countingStream((n) => state.countOut(id, n)))
    .pipeTo(duplex.writable)
    .catch(() => {});

  child.on("exit", (code) => {
    console.log(`[${id}] harness exited code=${code}`);
    state.setPid(id, null);
    void duplex.close().catch(() => {});
  });
  void duplex.closed.then(() => {
    console.log(`[${id}] session closed`);
    state.close(id);
    if (!child.killed) child.kill();
  });
}
