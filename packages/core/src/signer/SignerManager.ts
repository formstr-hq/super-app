import { decode as decodeNsec } from "nostr-tools/nip19";
import type { NostrSigner, SignerMethod, SignerState, SignerObserver } from "./types";
import { LocalSigner } from "./LocalSigner";
import { NIP07Signer } from "./NIP07Signer";
import { DeferredSigner } from "./DeferredSigner";

const STORAGE_PREFIX = "formstr:";
const KEY_METHOD = `${STORAGE_PREFIX}signer-method`;
const KEY_PUBKEY = `${STORAGE_PREFIX}pubkey`;
const KEY_SECRET = `${STORAGE_PREFIX}client-secret`;

/**
 * Unified signer manager — based on Calendar's SignerManager with
 * DeferredSigner for instant startup, extended with Forms' NIP-49 support.
 *
 * Two-phase restoration:
 *   Phase 1 (instant): DeferredSigner with cached pubkey from localStorage
 *   Phase 2 (background): resolve real signer, flush queued ops
 */
export class SignerManager {
  private signer: NostrSigner | null = null;
  private pubkey: string | null = null;
  private method: SignerMethod | null = null;
  private ready = false;
  private observers = new Set<SignerObserver>();
  private loginModalCallback: (() => Promise<NostrSigner>) | null = null;

  // ── Restore from storage (instant startup) ──────────────

  restoreFromStorage(): void {
    const savedMethod = localStorage.getItem(KEY_METHOD) as SignerMethod | null;
    const savedPubkey = localStorage.getItem(KEY_PUBKEY);

    if (!savedMethod || !savedPubkey) {
      this.ready = true;
      this.notify();
      return;
    }

    // Phase 1: DeferredSigner with cached pubkey
    const deferred = new DeferredSigner(savedPubkey);
    this.signer = deferred;
    this.pubkey = savedPubkey;
    this.method = savedMethod;
    this.ready = true;
    this.notify();

    // Phase 2: Resolve actual signer in background
    this.resolveSignerAsync(savedMethod, deferred);
  }

  private async resolveSignerAsync(method: SignerMethod, deferred: DeferredSigner): Promise<void> {
    try {
      let realSigner: NostrSigner | null = null;

      switch (method) {
        case "nip07": {
          // Wait a bit for extension to inject window.nostr
          await new Promise((r) => setTimeout(r, 500));
          if (typeof window !== "undefined" && window.nostr) {
            realSigner = new NIP07Signer();
          }
          break;
        }
        case "local":
        case "guest": {
          const stored = localStorage.getItem(KEY_SECRET);
          if (stored) {
            const secretKey = hexToBytes(stored);
            realSigner = new LocalSigner(secretKey);
          }
          break;
        }
        // NIP-46 and NIP-55 can be added here
      }

      if (realSigner) {
        await deferred.resolve(realSigner);
        this.signer = realSigner;
        this.notify();
      }
    } catch {
      // Silently fail — DeferredSigner will keep queueing
    }
  }

  // ── Login methods ───────────────────────────────────────

  async loginWithNsec(nsec: string): Promise<void> {
    const decoded = decodeNsec(nsec);
    if (decoded.type !== "nsec") {
      throw new Error("Invalid nsec");
    }
    const signer = new LocalSigner(decoded.data);
    await this.setSigner(signer, "local");
    localStorage.setItem(KEY_SECRET, bytesToHex(decoded.data));
  }

  async loginWithNip07(): Promise<void> {
    const signer = new NIP07Signer();
    const pubkey = await signer.getPublicKey();
    this.pubkey = pubkey;
    this.signer = signer;
    this.method = "nip07";
    this.ready = true;
    this.persist();
    this.notify();
  }

  async createGuestAccount(): Promise<void> {
    const signer = new LocalSigner();
    localStorage.setItem(KEY_SECRET, bytesToHex(signer.getSecretKey()));
    await this.setSigner(signer, "guest");
  }

  logout(): void {
    this.signer = null;
    this.pubkey = null;
    this.method = null;
    this.ready = true;
    localStorage.removeItem(KEY_METHOD);
    localStorage.removeItem(KEY_PUBKEY);
    localStorage.removeItem(KEY_SECRET);
    this.notify();
  }

  // ── Access ──────────────────────────────────────────────

  /** Non-blocking — returns null if no signer. Used by read paths. */
  getSignerIfAvailable(): NostrSigner | null {
    return this.signer;
  }

  /** Blocking — triggers login modal if no signer. Used by write paths. */
  async getSigner(): Promise<NostrSigner> {
    if (this.signer) return this.signer;

    if (this.loginModalCallback) {
      const signer = await this.loginModalCallback();
      return signer;
    }

    throw new Error("No signer available and no login modal registered");
  }

  getPublicKey(): string | null {
    return this.pubkey;
  }

  getState(): SignerState {
    return {
      signer: this.signer,
      pubkey: this.pubkey,
      method: this.method,
      ready: this.ready,
    };
  }

  // ── Observer pattern ────────────────────────────────────

  onChange(callback: SignerObserver): () => void {
    this.observers.add(callback);
    return () => this.observers.delete(callback);
  }

  registerLoginModal(callback: () => Promise<NostrSigner>): void {
    this.loginModalCallback = callback;
  }

  // ── Internal ────────────────────────────────────────────

  private async setSigner(signer: NostrSigner, method: SignerMethod): Promise<void> {
    this.signer = signer;
    this.method = method;
    this.pubkey = await signer.getPublicKey();
    this.ready = true;
    this.persist();
    this.notify();
  }

  private persist(): void {
    if (this.method) localStorage.setItem(KEY_METHOD, this.method);
    if (this.pubkey) localStorage.setItem(KEY_PUBKEY, this.pubkey);
  }

  private notify(): void {
    const state = this.getState();
    for (const cb of this.observers) {
      cb(state);
    }
  }
}

// Singleton
export const signerManager = new SignerManager();

// ── Hex helpers ───────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
