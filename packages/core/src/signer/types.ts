import type { EventTemplate, VerifiedEvent } from "nostr-tools";

/**
 * Unified signer interface for all Formstr modules.
 * Identical across Forms, Calendar, Pages, Polls.
 * Drive lacks this — uses DriveSignerAdapter.
 */
export interface NostrSigner {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<VerifiedEvent>;

  // NIP-04 (legacy DMs, some access grants)
  encrypt?(pubkey: string, plaintext: string): Promise<string>;
  decrypt?(pubkey: string, ciphertext: string): Promise<string>;

  // NIP-44 (modern encryption — forms, calendar, pages, drive metadata)
  nip44Encrypt?(pubkey: string, plaintext: string): Promise<string>;
  nip44Decrypt?(pubkey: string, ciphertext: string): Promise<string>;
}

export type SignerMethod = "local" | "nip07" | "nip46" | "nip55" | "guest";

export interface SignerState {
  signer: NostrSigner | null;
  pubkey: string | null;
  method: SignerMethod | null;
  ready: boolean;
}

export type SignerObserver = (state: SignerState) => void;
