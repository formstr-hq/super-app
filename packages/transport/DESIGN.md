# @formstr/nostr-transport — design decisions

A reliable, encrypted, whitelisted **duplex byte stream between two Nostr
pubkeys**. Transport-only: it ships opaque `Uint8Array`s and knows nothing about
ACP or anything layered on top. The home node's `onConnection` handler is what
pipes the duplex into an ACP harness — that concern lives outside this package.

This document records every decision and its rationale. Defaults are chosen for
the browser↔home use case but everything platform-specific is injected, so the
same code runs in Node/Deno/RN.

---

## 1. Scope & topology

- **Home node** (fixed): harness + model + projects. Always-on, subscribed to
  all configured relays. Runs `listen()`.
- **Edge devices** (roaming: phone/tab/laptop): thin clients. Run `connect()`.
- **Auth**: home node whitelists edge **npubs**. Every Nostr event is signed, so
  the sender is cryptographically verified for free; the allowlist is just a
  predicate over the verified `pubkey`.
- **This package does not know about ACP.** It is a dumb pipe. The edge sends
  bytes, the home node receives bytes and (elsewhere) feeds them to ACP stdio.

## 2. The universality seam

The core depends on only two `@formstr/core` interfaces, both already
environment-agnostic:

- `NostrRuntimeContract` — `subscribe / publish / fetchOne / querySync`. All
  network I/O. Browser passes its relay-pool runtime; Node passes its own.
- `NostrSigner` — `getPublicKey / signEvent / nip44Encrypt / nip44Decrypt`.
  Identity + crypto. Works with Local/NIP-07/NIP-46 signers unchanged.

The consumer-facing boundary is **WHATWG Web Streams** (`ReadableStream` /
`WritableStream` of `Uint8Array`). Native in browsers, Node ≥18, Deno; RN with a
polyfill. This is why "browser-first" costs nothing in universality.

## 3. Framing

**Byte-oriented, not message-oriented.** The transport ships opaque bytes; the
consumer (e.g. ACP's newline-delimited JSON-RPC) imposes its own message
boundaries. Keeps the transport maximally dumb and reusable.

One **frame** per Nostr event. Binary header + payload:

| offset | size | field   | notes                                              |
| ------ | ---- | ------- | -------------------------------------------------- |
| 0      | 1    | version | `0x01`; lets the wire format evolve                |
| 1      | 1    | type    | `FrameType` (see below)                            |
| 2      | 16   | session | 128-bit random id, chosen by initiator             |
| 18     | 4    | seq     | uint32 BE, per-direction frame counter             |
| 22     | 4    | ack     | uint32 BE, cumulative (highest in-order seq recvd) |
| 26     | …    | payload | opaque bytes; empty for control frames             |

Header = **26 bytes**. Payload is the remainder after decrypt (no explicit
length field needed — the decrypted plaintext _is_ exactly one frame).

`FrameType`: `Syn=0, SynAck=1, Data=2, Ack=3, Ping=4, Pong=5, Fin=6`.

## 4. Nostr event mapping

The frame bytes are **base64-encoded to a string** (because `nip44Encrypt` takes
a string), then encrypted, then placed in `event.content`.

### 4a. Privacy mode `"nip44"` (default)

```
kind:       20050        // ephemeral (20000–29999): relays DO NOT store it
tags:       [["p", peerPubkey]]
content:    nip44Encrypt(signer, peerPubkey, base64(frameBytes))
pubkey:     <our real pubkey>   // authenticates + allowlist key
created_at: now (real)
```

- **Ephemeral kind** → relays relay to live subscribers but never persist. Ideal
  for a high-frequency transport that does its own reliability. No storage
  burden, no offline replay to worry about.
- Trade-off: `p` tag + real `pubkey` are visible to relays → **who-talks-to-whom
  is observable** (content is not).

### 4b. Privacy mode `"nip59"` (opt-in metadata privacy)

Full gift-wrap via core's `wrapEvent` / `unwrapEvent`:

```
rumor (unsigned): kind=20050, content=base64(frameBytes), pubkey=<real sender>
seal  (kind 13):  nip44 encrypted rumor, signed by real sender
wrap  (kind 21059): ephemeral one-time key, [["p", peerPubkey]]
```

- **Deliberate deviation from NIP-59's default wrap kind `1059`.** We pass
  `wrapKind = 21059` (ephemeral) instead, for two reasons: (a) relays don't
  store it, and (b) it stays out of NIP-17 DM clients' `1059` inboxes, so
  transport traffic doesn't pollute anyone's DMs.
- **Sender recovery**: the real sender is `rumor.pubkey` returned by
  `unwrapEvent` — NOT the ephemeral wrap `pubkey`. The allowlist is checked
  against `rumor.pubkey`.
- `wrapEvent` **jitters `created_at` by ±2 days**, so nip59 mode **cannot** use a
  tight `since` filter (see §5).
- Trade-off: three encryption layers per frame → heavier. Sensible for lower
  frequency or when metadata privacy dominates; not for a chatty firehose.

### 4c. Configurability

`TransportOptions.kind` overrides the wire kind (default `20050` for nip44).
`privacy` selects the mode (default `"nip44"`).

## 5. Subscription filters

- nip44: `{ kinds:[opts.kind], "#p":[myPubkey], since: connectTime }` — `since`
  is safe because timestamps are real.
- nip59: `{ kinds:[21059], "#p":[myPubkey] }` — **no `since`** (or `since = now -
2 days`) because of the ±2-day jitter. De-dup (§6) absorbs any redelivery.

## 6. Reliability layer (`Session`)

Nostr gives signed pub/sub but not ordering, delivery, or de-dup. `Session`
rebuilds a reliable ordered stream on top. TCP-ish but **frame-indexed**, not
byte-indexed (frames are our retransmit unit).

- **Handshake (2-way)**: initiator → `Syn` (seq=0, session id, params in
  payload); responder checks allowlist → `SynAck` (echoes session id, its ISN).
  First `Data` frame's `ack` confirms the reverse direction (no separate 3rd
  ACK needed).
- **Sequencing**: each direction has its own `seq`. `Syn`/`SynAck` anchor at
  seq 0; first `Data` = seq 1.
- **Cumulative ack**: `ack` = highest contiguous seq received. Piggybacked on
  `Data`; a standalone `Ack` is sent after a ~200 ms delayed-ack timer when
  there's no data to carry it.
- **Retransmit**: unacked frames held in a send buffer. RTO starts at **3 s**,
  exponential backoff ×2 up to **30 s**, **8** attempts → session declared dead.
- **De-dup / reorder**: receiver tracks highest contiguous seq + a small
  out-of-order buffer; duplicates (Nostr may redeliver across relays) are
  dropped; gaps are filled by retransmit before delivery.
- **Flow control**: bounded send window of **32 unacked frames**; the
  `WritableStream` applies backpressure when full, so a slow reader can't be
  flooded.
- **Liveness**: `Ping` every **15 s** idle; **2** missed `Pong`s (~45 s) →
  dead.
- **Teardown**: `Fin` exchange, then `closed` resolves. Either side may initiate.
- **Multiplexing**: keyed by `(senderPubkey, sessionId)`, so one peer can hold
  several concurrent sessions.

## 7. Chunking / MTU

- NIP-44 max plaintext is **65535 bytes**. We base64 the frame first, so raw
  frame bytes ≤ ~49151 before hitting that limit.
- Relays also cap event size (often 64–256 KB; some less).
- **Decision: MTU = 32 KiB payload per Data frame.** Comfortably under the
  nip44 limit and under typical relay caps even after base64 (~+33%) and
  encryption overhead. Configurable later. Larger writes are split across
  sequential `Data` frames and reassembled by seq order.

## 8. Replay & security notes

- Authenticity: nostr-tools verifies the event signature; `Session` only ever
  acts on frames whose verified sender is allowlisted.
- Within-session replay: session id + seq de-dup neutralizes it.
- Cross-session replay: an unknown session id is treated as a fresh `Syn`, which
  still must pass signature + allowlist, so a replayed old frame does nothing.
- Confidentiality: nip44 (or nip59) means relays never see plaintext.
- Metadata: nip44 leaks the pubkey pair; nip59 hides it (§4b).

## 9. Deliberate non-goals (v1)

- No offline delivery / store-and-forward (ephemeral kinds don't persist). A
  session needs both ends online. Fine for interactive ACP.
- No congestion control beyond the fixed window.
- No built-in relay discovery — relays are passed in `opts.relays`.
- No ACP awareness whatsoever.

## 10. Public API

```ts
// edge
const duplex = await connect(opts, { to: homePubkey });

// home node (ACP wiring happens in the handler, not here)
const listener = listen(opts, (pk) => whitelist.has(pk));
listener.onConnection((duplex) => pipeToAcpHarness(duplex));
```

`opts: { runtime, signer, relays, privacy?, kind? }` — all injected, nothing
platform-specific.

```

## Default constants (one place to tune)

| constant            | default        |
|---------------------|----------------|
| wire kind (nip44)   | `20050`        |
| wrap kind (nip59)   | `21059`        |
| privacy mode        | `"nip44"`      |
| MTU payload         | 32 KiB         |
| send window         | 32 frames      |
| RTO initial / max   | 3 s / 30 s     |
| retransmit attempts | 8              |
| delayed-ack timer   | 200 ms         |
| heartbeat interval  | 15 s           |
| missed pongs → dead | 2 (~45 s)      |
```
