import { nip44Decrypt, nip44Encrypt, unwrapEvent, wrapEvent } from "@formstr/core";
import type { SubscriptionHandle } from "@formstr/core";
import type { Event, EventTemplate } from "nostr-tools";

import { WIRE_KIND_NIP44, WIRE_KIND_NIP59 } from "./constants";
import { decodeFrame, encodeFrame, type Frame } from "./frame";
import type { TransportOptions } from "./types";

/** Portable base64 (browser btoa/atob, present in Node >=16 as globals). */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return globalThis.btoa(bin);
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const nowSec = () => Math.floor(Date.now() / 1000);
const SEEN_CAP = 4096;

/**
 * The Nostr I/O boundary: turns {@link Frame}s into signed, encrypted events and
 * back. All relay- and crypto-specific concerns live here (via injected
 * `runtime` + `signer`), so the reliability layer above stays pure logic.
 */
export class Wire {
  private readonly privacy: "nip44" | "nip59";
  private readonly kind: number;

  constructor(private readonly opts: TransportOptions) {
    this.privacy = opts.privacy ?? "nip44";
    this.kind = opts.kind ?? WIRE_KIND_NIP44;
  }

  /** The event a frame would become — publishing is just this + runtime.publish. */
  async buildEvent(peerPubkey: string, frame: Frame): Promise<Event> {
    const b64 = bytesToBase64(encodeFrame(frame));
    if (this.privacy === "nip59") {
      // Gift-wrap on an ephemeral kind (see DESIGN.md §4b). Real sender is
      // recovered from the rumor on the far side.
      return wrapEvent(
        { kind: this.kind, content: b64, tags: [] },
        this.opts.signer,
        peerPubkey,
        WIRE_KIND_NIP59,
      );
    }
    const content = await nip44Encrypt(this.opts.signer, peerPubkey, b64);
    const template: EventTemplate = {
      kind: this.kind,
      created_at: nowSec(),
      tags: [["p", peerPubkey]],
      content,
    };
    return this.opts.signer.signEvent(template);
  }

  /** Encrypt + sign a frame and publish it addressed to `peerPubkey`. */
  async send(peerPubkey: string, frame: Frame): Promise<void> {
    const event = await this.buildEvent(peerPubkey, frame);
    await this.opts.runtime.publish(this.opts.relays, event);
  }

  /**
   * Subscribe for inbound wire events addressed to us. Verifies (nostr-tools
   * checks the sig), decrypts, decodes, and hands up the decoded frame with the
   * VERIFIED sender pubkey so the caller can enforce the allowlist. De-dups
   * relay redelivery by event id. Returns an unsubscribe function.
   */
  subscribe(onFrame: (senderPubkey: string, frame: Frame) => void): () => void {
    let handle: SubscriptionHandle | null = null;
    let cancelled = false;
    const seen = new Set<string>();

    void (async () => {
      const me = await this.opts.signer.getPublicKey();
      if (cancelled) return;
      const kinds = this.privacy === "nip59" ? [WIRE_KIND_NIP59] : [this.kind];
      handle = this.opts.runtime.subscribe(this.opts.relays, [{ kinds, "#p": [me] }], {
        onEvent: (event) => {
          if (seen.has(event.id)) return;
          seen.add(event.id);
          if (seen.size > SEEN_CAP) seen.clear();
          void this.decode(event, onFrame);
        },
      });
    })();

    return () => {
      cancelled = true;
      handle?.unsub();
    };
  }

  private async decode(
    event: Event,
    onFrame: (senderPubkey: string, frame: Frame) => void,
  ): Promise<void> {
    try {
      let sender: string;
      let b64: string;
      if (this.privacy === "nip59") {
        const rumor = await unwrapEvent(event, this.opts.signer);
        sender = rumor.pubkey; // real sender, NOT the ephemeral wrap key
        b64 = rumor.content;
      } else {
        sender = event.pubkey;
        b64 = await nip44Decrypt(this.opts.signer, event.pubkey, event.content);
      }
      onFrame(sender, decodeFrame(base64ToBytes(b64)));
    } catch {
      // Not for us, spam, or malformed — ignore.
    }
  }
}
