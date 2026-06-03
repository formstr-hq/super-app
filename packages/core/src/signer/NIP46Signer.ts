import type { EventTemplate, VerifiedEvent } from "nostr-tools";

import type { NostrSigner } from "./types";

/**
 * Minimal structural type of the part of nostr-tools' `BunkerSigner` we depend on.
 * Declaring it here keeps `@formstr/core` from importing `nostr-tools/nip46` (and a
 * relay pool) directly — the MCP constructs the bunker and hands it in.
 */
export interface BunkerLike {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<VerifiedEvent>;
  nip04Encrypt?(pubkey: string, plaintext: string): Promise<string>;
  nip04Decrypt?(pubkey: string, ciphertext: string): Promise<string>;
  nip44Encrypt?(pubkey: string, plaintext: string): Promise<string>;
  nip44Decrypt?(pubkey: string, ciphertext: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * `NostrSigner` backed by a NIP-46 remote signer ("bunker"). The private key never
 * enters this process — every sign/encrypt/decrypt is delegated to the remote signer
 * over relays. Used by the MCP so an agent calling the server can never see key material.
 */
export class NIP46Signer implements NostrSigner {
  constructor(private readonly bunker: BunkerLike) {}

  getPublicKey(): Promise<string> {
    return this.bunker.getPublicKey();
  }

  signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    return this.bunker.signEvent(event);
  }

  encrypt(pubkey: string, plaintext: string): Promise<string> {
    if (!this.bunker.nip04Encrypt) throw new Error("Remote signer lacks nip04 encrypt");
    return this.bunker.nip04Encrypt(pubkey, plaintext);
  }

  decrypt(pubkey: string, ciphertext: string): Promise<string> {
    if (!this.bunker.nip04Decrypt) throw new Error("Remote signer lacks nip04 decrypt");
    return this.bunker.nip04Decrypt(pubkey, ciphertext);
  }

  nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    if (!this.bunker.nip44Encrypt) throw new Error("Remote signer lacks nip44 encrypt");
    return this.bunker.nip44Encrypt(pubkey, plaintext);
  }

  nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    if (!this.bunker.nip44Decrypt) throw new Error("Remote signer lacks nip44 decrypt");
    return this.bunker.nip44Decrypt(pubkey, ciphertext);
  }

  /** Tear down the relay subscription held by the underlying bunker. */
  close(): Promise<void> {
    return this.bunker.close();
  }
}
