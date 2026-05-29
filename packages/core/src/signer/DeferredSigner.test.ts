import { generateSecretKey } from "nostr-tools";
import { describe, expect, it } from "vitest";

import { DeferredSigner } from "./DeferredSigner";
import { LocalSigner } from "./LocalSigner";

describe("DeferredSigner", () => {
  it("returns cached pubkey instantly before real signer resolves", async () => {
    const pubkey = "ab".repeat(32);
    const deferred = new DeferredSigner(pubkey);
    expect(await deferred.getPublicKey()).toBe(pubkey);
  });

  it("isResolved() is false before resolve(), true after", async () => {
    const deferred = new DeferredSigner("00".repeat(32));
    expect(deferred.isResolved()).toBe(false);
    const real = new LocalSigner(generateSecretKey());
    await deferred.resolve(real);
    expect(deferred.isResolved()).toBe(true);
  });

  it("signs via real signer after resolve()", async () => {
    const sk = generateSecretKey();
    const real = new LocalSigner(sk);
    const deferred = new DeferredSigner(await real.getPublicKey());
    await deferred.resolve(real);
    const signed = await deferred.signEvent({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: "test",
    });
    expect(signed.pubkey).toBe(await real.getPublicKey());
  });

  it("queues sign operations and flushes after resolve()", async () => {
    const sk = generateSecretKey();
    const real = new LocalSigner(sk);
    const deferred = new DeferredSigner(await real.getPublicKey());

    // Start sign before real signer resolves
    const signPromise = deferred.signEvent({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: "queued",
    });

    // Resolve the real signer — this flushes the queue
    await deferred.resolve(real);
    const signed = await signPromise;
    expect(signed.content).toBe("queued");
  });
});
