import type { NostrSigner } from "../signer/types";

/**
 * NIP-44 v2 encryption wrappers.
 * Used by Forms (form content, responses), Calendar (events, lists),
 * Pages (documents, metadata), Drive (file metadata).
 */

export async function nip44Encrypt(
  signer: NostrSigner,
  recipientPubkey: string,
  plaintext: string,
): Promise<string> {
  if (!signer.nip44Encrypt) {
    throw new Error("Signer does not support NIP-44 encryption");
  }
  return signer.nip44Encrypt(recipientPubkey, plaintext);
}

export async function nip44Decrypt(
  signer: NostrSigner,
  senderPubkey: string,
  ciphertext: string,
): Promise<string> {
  if (!signer.nip44Decrypt) {
    throw new Error("Signer does not support NIP-44 decryption");
  }
  return signer.nip44Decrypt(senderPubkey, ciphertext);
}

/**
 * Self-encryption: encrypt content for own pubkey.
 * Used by Calendar (private events), Pages (documents),
 * Drive (file metadata), Forms (my forms list — kind 14083).
 */
export async function nip44SelfEncrypt(
  signer: NostrSigner,
  plaintext: string,
): Promise<string> {
  const pubkey = await signer.getPublicKey();
  return nip44Encrypt(signer, pubkey, plaintext);
}

export async function nip44SelfDecrypt(
  signer: NostrSigner,
  ciphertext: string,
): Promise<string> {
  const pubkey = await signer.getPublicKey();
  return nip44Decrypt(signer, pubkey, ciphertext);
}
