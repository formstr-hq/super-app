import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
} from "nostr-tools";
import type { EventTemplate, VerifiedEvent } from "nostr-tools";
import * as nip44 from "nostr-tools/nip44";
import * as nip04 from "nostr-tools/nip04";
import type { NostrSigner } from "./types";

/**
 * Local signer using an in-memory secret key.
 * Used for nsec login, guest accounts, and signup-with-password.
 */
export class LocalSigner implements NostrSigner {
  private secretKey: Uint8Array;
  private pubkey: string;

  constructor(secretKey?: Uint8Array) {
    this.secretKey = secretKey ?? generateSecretKey();
    this.pubkey = getPublicKey(this.secretKey);
  }

  async getPublicKey(): Promise<string> {
    return this.pubkey;
  }

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    return finalizeEvent(event, this.secretKey);
  }

  async encrypt(pubkey: string, plaintext: string): Promise<string> {
    return nip04.encrypt(this.secretKey, pubkey, plaintext);
  }

  async decrypt(pubkey: string, ciphertext: string): Promise<string> {
    return nip04.decrypt(this.secretKey, pubkey, ciphertext);
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    const key = nip44.v2.utils.getConversationKey(this.secretKey, pubkey);
    return nip44.v2.encrypt(plaintext, key);
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    const key = nip44.v2.utils.getConversationKey(this.secretKey, pubkey);
    return nip44.v2.decrypt(ciphertext, key);
  }

  getSecretKey(): Uint8Array {
    return this.secretKey;
  }
}
