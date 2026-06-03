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

/**
 * Persisted NIP-46 session data. This is a *session token*, not the user's key:
 * `clientSecretKey` is an ephemeral key this client uses to talk to the remote signer;
 * the user's actual key stays in the bunker/extension.
 */
export interface Nip46Connection {
  /** Hex-encoded ephemeral client secret key. */
  clientSecretKey: string;
  /** Hex pubkey of the remote signer. */
  remoteSignerPubkey: string;
  /** Relays the remote signer listens on. */
  relays: string[];
  /** Optional connection secret returned during the handshake. */
  secret?: string;
}

/** Builds a connected NostrSigner from a persisted NIP-46 connection (injected by the host). */
export type Nip46Builder = (conn: Nip46Connection) => Promise<NostrSigner>;

export interface SignerState {
  signer: NostrSigner | null;
  pubkey: string | null;
  method: SignerMethod | null;
  ready: boolean;
}

export type SignerObserver = (state: SignerState) => void;
