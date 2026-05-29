import type { EventTemplate, VerifiedEvent } from "nostr-tools";

import { signerManager } from "./SignerManager";

/**
 * Adapter that replaces all `window.nostr` calls in Drive's codebase
 * with calls through the shared SignerManager.
 *
 * Affected Drive files:
 *   - services/fileIndex.ts → encryptMetadata(), decryptMetadata(), saveFileMetadata()
 *   - auth.ts → createAuthEvent()
 *   - Provider/ProfileProvider.tsx → getPublicKey()
 */
export function createDriveSignerAdapter() {
  return {
    async getPublicKey(): Promise<string> {
      const signer = await signerManager.getSigner();
      return signer.getPublicKey();
    },

    async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
      const signer = await signerManager.getSigner();
      return signer.signEvent(event);
    },

    nip44: {
      async encrypt(pubkey: string, plaintext: string): Promise<string> {
        const signer = await signerManager.getSigner();
        if (!signer.nip44Encrypt) {
          throw new Error("Signer does not support NIP-44 encryption");
        }
        return signer.nip44Encrypt(pubkey, plaintext);
      },

      async decrypt(pubkey: string, ciphertext: string): Promise<string> {
        const signer = await signerManager.getSigner();
        if (!signer.nip44Decrypt) {
          throw new Error("Signer does not support NIP-44 decryption");
        }
        return signer.nip44Decrypt(pubkey, ciphertext);
      },
    },
  };
}

export type DriveSignerAdapter = ReturnType<typeof createDriveSignerAdapter>;
