import { generateSecretKey } from "nostr-tools";
import { describe, it, expect } from "vitest";

import { LocalSigner } from "../signer/LocalSigner";

import { unwrapEvent, wrapEvent, wrapManyEvents } from "./nip59";

describe("nip59 wrapEvent", () => {
  it("round-trips a rumor through wrap → unwrap", async () => {
    const sender = new LocalSigner(generateSecretKey());
    const recipient = new LocalSigner(generateSecretKey());
    const recipientPk = await recipient.getPublicKey();

    const wrap = await wrapEvent({ kind: 14, content: "hello", tags: [] }, sender, recipientPk);

    const rumor = await unwrapEvent(wrap, recipient);
    expect(rumor.kind).toBe(14);
    expect(rumor.content).toBe("hello");
    expect(rumor.pubkey).toBe(await sender.getPublicKey());
  });
});

describe("nip59 wrapManyEvents — per-recipient seal regression", () => {
  it("produces wraps that each recipient can unwrap to the same rumor", async () => {
    const sender = new LocalSigner(generateSecretKey());
    const r1 = new LocalSigner(generateSecretKey());
    const r2 = new LocalSigner(generateSecretKey());
    const r3 = new LocalSigner(generateSecretKey());
    const pks = await Promise.all([r1, r2, r3].map((s) => s.getPublicKey()));

    const wraps = await wrapManyEvents(
      { kind: 14, content: "shared secret", tags: [] },
      sender,
      pks,
    );

    expect(wraps).toHaveLength(3);

    const rumor1 = await unwrapEvent(wraps[0], r1);
    const rumor2 = await unwrapEvent(wraps[1], r2);
    const rumor3 = await unwrapEvent(wraps[2], r3);

    for (const rumor of [rumor1, rumor2, rumor3]) {
      expect(rumor.content).toBe("shared secret");
      expect(rumor.kind).toBe(14);
    }
  });
});
