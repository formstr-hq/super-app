// @formstr/nostr-transport — a reliable, encrypted, whitelisted duplex byte
// stream between two Nostr pubkeys. Transport-only: it ships opaque bytes and
// knows nothing about ACP or any protocol layered on top.
//
//   Edge:  const duplex = await connect(opts, { to: homePubkey });
//   Home:  const listener = listen(opts, (pk) => whitelist.has(pk));
//          listener.onConnection((duplex) => pipeToAcpHarness(duplex));
//
// `duplex` is a WHATWG Web Streams pair, so it binds unchanged across browser,
// Node, Deno, and RN. The ACP wiring lives entirely in the home node's
// onConnection handler.

export { connect, listen } from "./transport";
export type { TransportOptions, NostrDuplex, Listener, Allowlist, PrivacyMode } from "./types";
export { FrameType } from "./frame";
export type { Frame } from "./frame";
