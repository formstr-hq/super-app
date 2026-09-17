/**
 * Tunable defaults for the transport. See DESIGN.md for the rationale behind
 * each value. Everything here is overridable via TransportOptions or future
 * per-session config; this is the single source of truth for the numbers.
 */

/** Ephemeral kind (20000–29999) for nip44-mode wire frames; relays don't store it. */
export const WIRE_KIND_NIP44 = 20050;

/**
 * Gift-wrap kind for nip59 mode. Deliberately NOT the NIP-59 default 1059:
 * an ephemeral kind keeps transport traffic out of relay storage and out of
 * NIP-17 DM inboxes.
 */
export const WIRE_KIND_NIP59 = 21059;

/** Frame header size in bytes (version+type+session+seq+ack). */
export const HEADER_SIZE = 26;

/** Max Data-frame payload. Under NIP-44's 65535 plaintext limit (post-base64) and typical relay caps. */
export const MTU = 32 * 1024;

/**
 * Coalescing (Nagle) window. Outbound bytes are buffered up to this long before
 * being flushed as ONE Data frame, so a burst of tiny ACP messages (e.g. an LLM
 * streaming hundreds of chunks) collapses into a handful of Nostr events instead
 * of hundreds — essential for staying under public-relay rate limits.
 */
export const COALESCE_MS = 60;

/** Max unacked frames in flight before the writable side applies backpressure. */
export const SEND_WINDOW = 32;

/** Retransmit timeout: initial, cap, and attempts before declaring the session dead. */
export const RTO_INITIAL_MS = 3_000;
export const RTO_MAX_MS = 30_000;
export const RETRANSMIT_ATTEMPTS = 8;

/** Delay before sending a standalone Ack when no Data is available to piggyback on. */
export const DELAYED_ACK_MS = 200;

/** Heartbeat interval and how many missed Pongs mark the session dead. */
export const HEARTBEAT_MS = 15_000;
export const MISSED_PONGS_DEAD = 2;
