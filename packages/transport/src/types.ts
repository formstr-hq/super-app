import type { NostrRuntimeContract } from "@formstr/core";
import type { NostrSigner } from "@formstr/core";

/**
 * Metadata-privacy mode for the wire.
 *
 * - "nip44": payload is NIP-44 encrypted and addressed to the peer with a
 *   `p` tag. Relays cannot read content but CAN see who talks to whom.
 * - "nip59": full gift-wrap (ephemeral sender key). Relays learn neither the
 *   content nor the real sender. Costs an extra layer + stored wrap events.
 *
 * Default is "nip44": cheaper, and works on an ephemeral kind so relays never
 * persist the traffic. Flip to "nip59" when metadata privacy matters more than
 * cost. See {@link WireKinds}.
 */
export type PrivacyMode = "nip44" | "nip59";

export interface TransportOptions {
  /** All network I/O flows through this — the universality seam. */
  runtime: NostrRuntimeContract;
  /** Our own identity; signs outgoing wire events. */
  signer: NostrSigner;
  /** Relays to publish to / subscribe on. */
  relays: string[];
  /** Metadata-privacy mode. Default "nip44". */
  privacy?: PrivacyMode;
  /** Override the Nostr event kind used for wire frames. See {@link WireKinds}. */
  kind?: number;
}

/**
 * A bidirectional byte pipe to a single peer, expressed as WHATWG Web Streams
 * so it binds unchanged in browsers, Node >=18, Deno, and RN (with polyfill).
 * This is the ONLY thing a consumer needs — ACP, or anything else, runs on top.
 */
export interface NostrDuplex {
  /** Bytes arriving from the peer, in order, with gaps already retransmitted. */
  readable: ReadableStream<Uint8Array>;
  /** Bytes to send to the peer; framed, encrypted, and acked underneath. */
  writable: WritableStream<Uint8Array>;
  /** The peer's hex pubkey. */
  readonly peer: string;
  /** Resolves once the session is fully torn down (either side). */
  readonly closed: Promise<void>;
  /** Initiate a graceful teardown. */
  close(): Promise<void>;
}

/** Home-node side: accepts inbound sessions from whitelisted peers. */
export interface Listener {
  /** Fires once per accepted session. */
  onConnection(handler: (duplex: NostrDuplex) => void): void;
  /** Stop accepting and tear down all sessions. */
  close(): Promise<void>;
}

/** Decides whether an inbound session from `pubkey` is allowed. */
export type Allowlist = (pubkey: string) => boolean | Promise<boolean>;
