import type { EventTemplate, VerifiedEvent } from "nostr-tools";

import type { NostrSigner } from "./types";

/**
 * NIP-07 signer — delegates to window.nostr browser extension.
 * Works with Alby, nos2x, Flamingo, etc.
 */
export class NIP07Signer implements NostrSigner {
  private getExtension(): WindowNostr {
    if (typeof window === "undefined" || !window.nostr) {
      throw new Error("No NIP-07 extension found. Install a nostr signer extension.");
    }
    return window.nostr;
  }

  async getPublicKey(): Promise<string> {
    return this.getExtension().getPublicKey();
  }

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    return this.getExtension().signEvent(event) as Promise<VerifiedEvent>;
  }

  async encrypt(pubkey: string, plaintext: string): Promise<string> {
    const ext = this.getExtension();
    if (!ext.nip04?.encrypt) throw new Error("NIP-04 not supported by extension");
    return ext.nip04.encrypt(pubkey, plaintext);
  }

  async decrypt(pubkey: string, ciphertext: string): Promise<string> {
    const ext = this.getExtension();
    if (!ext.nip04?.decrypt) throw new Error("NIP-04 not supported by extension");
    return ext.nip04.decrypt(pubkey, ciphertext);
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    const ext = this.getExtension();
    if (!ext.nip44?.encrypt) throw new Error("NIP-44 not supported by extension");
    return ext.nip44.encrypt(pubkey, plaintext);
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    const ext = this.getExtension();
    if (!ext.nip44?.decrypt) throw new Error("NIP-44 not supported by extension");
    return ext.nip44.decrypt(pubkey, ciphertext);
  }
}

/** Type declaration for window.nostr (NIP-07) */
interface WindowNostr {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<object>;
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

declare global {
  interface Window {
    nostr?: WindowNostr;
  }
}
