import type { NostrSigner } from "@formstr/core";
import type { ActiveSigner } from "@formstr/signer";
import type { EventTemplate, VerifiedEvent } from "nostr-tools";

/**
 * Adapt a `@formstr/signer` `ActiveSigner` to the super-app's `NostrSigner`
 * contract. Two gaps to close:
 *  - NIP-04 is named `nip04Encrypt/Decrypt` there vs `encrypt/decrypt` here.
 *  - `ActiveSigner.signEvent` returns a complete `NostrEvent`; our interface
 *    types it as `VerifiedEvent`. The signer finalized/relayed a full event, so
 *    the boundary cast is safe.
 */
export function toNostrSigner(active: ActiveSigner): NostrSigner {
  return {
    getPublicKey: () => active.getPublicKey(),
    signEvent: (event: EventTemplate) => active.signEvent(event) as Promise<VerifiedEvent>,
    encrypt: (pubkey: string, plaintext: string) => active.nip04Encrypt(pubkey, plaintext),
    decrypt: (pubkey: string, ciphertext: string) => active.nip04Decrypt(pubkey, ciphertext),
    nip44Encrypt: (pubkey: string, plaintext: string) => active.nip44Encrypt(pubkey, plaintext),
    nip44Decrypt: (pubkey: string, ciphertext: string) => active.nip44Decrypt(pubkey, ciphertext),
  };
}
