import { NostrRuntime, MODULE_DEFAULT_RELAYS } from "@formstr/core";
import type { NostrRuntimeContract } from "@formstr/core";
import { connect, type NostrDuplex, type PrivacyMode } from "@formstr/nostr-transport";
import { nip19 } from "nostr-tools";

import { getTransportIdentity } from "./transportIdentity";

/**
 * A dedicated SimplePool runtime for the transport — NOT the app's runtime.
 * The app runs on a local-relay runtime (batched publishes, warmup-gated subs)
 * which breaks the transport's real-time ephemeral handshake. This mirrors the
 * plain-SimplePool setup that works headless.
 */
let transportRuntime: NostrRuntimeContract | null = null;
function getTransportRuntime(): NostrRuntimeContract {
  if (!transportRuntime) transportRuntime = new NostrRuntime();
  return transportRuntime;
}

export interface HomeNodeConfig {
  /** The home node's npub, as configured in settings. */
  npub: string;
  /** Relays to reach it on. Defaults to the app's module relays. */
  relays?: string[];
  /** Must match the home node's mode. Default "nip44". */
  privacy?: PrivacyMode;
}

/**
 * Open a raw duplex byte stream to the configured home node, reusing the app's
 * active signer and Nostr runtime. The returned {@link NostrDuplex} is the
 * transport only — an ACP client layer sits on top of it to drive the AI-UI.
 */
export async function connectHomeNode(config: HomeNodeConfig): Promise<NostrDuplex> {
  const decoded = nip19.decode(config.npub);
  if (decoded.type !== "npub") throw new Error(`not an npub: ${config.npub}`);
  const homePubkey = decoded.data;

  // Sign wire frames with the device-local transport key, NOT the user's signer:
  // the transport signs one event per frame, which would prompt a NIP-07/46
  // signer to death. This key is what the home node whitelists.
  const { signer } = getTransportIdentity();
  const runtime = getTransportRuntime();
  // Cap fan-out: each frame is published to every relay, so fewer relays = fewer
  // events. Prefer the user's configured home-node relays; else a small default.
  const relays = config.relays?.length
    ? config.relays
    : [...new Set(Object.values(MODULE_DEFAULT_RELAYS).flat())].slice(0, 4);

  return connect({ runtime, signer, relays, privacy: config.privacy }, { to: homePubkey });
}

/**
 * Convenience: text framing over the duplex. ACP is newline-delimited JSON-RPC,
 * so a consumer can `writeLine(JSON.stringify(rpc))` and split reads on "\n".
 * This is a thin helper, NOT the ACP client itself.
 */
export function textFraming(duplex: NostrDuplex) {
  const encoder = new TextEncoder();
  const writer = duplex.writable.getWriter();
  return {
    writeLine: (line: string) =>
      writer.write(encoder.encode(line.endsWith("\n") ? line : line + "\n")),
    lines: () => lineStream(duplex.readable),
    close: () => duplex.close(),
  };
}

async function* lineStream(readable: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const reader = readable.getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        yield buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
