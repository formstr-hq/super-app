import type { EventTemplate, VerifiedEvent } from "nostr-tools";

import type { NostrSigner } from "./types";

type QueuedOperation<T> = {
  execute: (signer: NostrSigner) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

/**
 * DeferredSigner — returns cached pubkey instantly, queues all signing ops.
 * Based on Calendar's DeferredSigner pattern for instant app startup.
 *
 * Phase 1 (instant): Create with cached pubkey from localStorage.
 * Phase 2 (background): Resolve to real signer, flush queued ops.
 */
export class DeferredSigner implements NostrSigner {
  private realSigner: NostrSigner | null = null;
  private cachedPubkey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private queue: QueuedOperation<any>[] = [];
  private resolvePromise: ((signer: NostrSigner) => void) | null = null;

  constructor(cachedPubkey: string) {
    this.cachedPubkey = cachedPubkey;
    // Keep reference alive to avoid GC and allow resolvePromise callback
    void new Promise<NostrSigner>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  /** Call once real signer is available — flushes all queued operations */
  async resolve(signer: NostrSigner): Promise<void> {
    this.realSigner = signer;
    this.resolvePromise?.(signer);
    this.resolvePromise = null;

    // Flush queued operations
    const pending = [...this.queue];
    this.queue = [];
    for (const op of pending) {
      try {
        const result = await op.execute(signer);
        op.resolve(result);
      } catch (err) {
        op.reject(err);
      }
    }
  }

  async getPublicKey(): Promise<string> {
    // Return cached pubkey instantly — no waiting
    return this.cachedPubkey;
  }

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    if (this.realSigner) {
      return this.realSigner.signEvent(event);
    }
    return this.enqueue((s) => s.signEvent(event));
  }

  async encrypt(pubkey: string, plaintext: string): Promise<string> {
    if (this.realSigner?.encrypt) {
      return this.realSigner.encrypt(pubkey, plaintext);
    }
    return this.enqueue((s) => {
      if (!s.encrypt) throw new Error("Signer does not support NIP-04 encrypt");
      return s.encrypt(pubkey, plaintext);
    });
  }

  async decrypt(pubkey: string, ciphertext: string): Promise<string> {
    if (this.realSigner?.decrypt) {
      return this.realSigner.decrypt(pubkey, ciphertext);
    }
    return this.enqueue((s) => {
      if (!s.decrypt) throw new Error("Signer does not support NIP-04 decrypt");
      return s.decrypt(pubkey, ciphertext);
    });
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    if (this.realSigner?.nip44Encrypt) {
      return this.realSigner.nip44Encrypt(pubkey, plaintext);
    }
    return this.enqueue((s) => {
      if (!s.nip44Encrypt) throw new Error("Signer does not support NIP-44 encrypt");
      return s.nip44Encrypt(pubkey, plaintext);
    });
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    if (this.realSigner?.nip44Decrypt) {
      return this.realSigner.nip44Decrypt(pubkey, ciphertext);
    }
    return this.enqueue((s) => {
      if (!s.nip44Decrypt) throw new Error("Signer does not support NIP-44 decrypt");
      return s.nip44Decrypt(pubkey, ciphertext);
    });
  }

  isResolved(): boolean {
    return this.realSigner !== null;
  }

  private enqueue<T>(execute: (signer: NostrSigner) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ execute, resolve, reject });
    });
  }
}
