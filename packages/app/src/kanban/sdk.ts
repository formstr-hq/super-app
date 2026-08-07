import { MODULE_DEFAULT_RELAYS, nostrRuntime, signerManager } from "@formstr/core";
import { KanbanSDK, type KanbanSigner } from "@formstr/kanban-sdk";

/**
 * NIP-44 is optional on core's `NostrSigner` (NIP-07 extensions may not
 * implement it) but required by every formstr SDK signer contract. A signer
 * without it cannot read or write a private board at all, so fail loudly here
 * rather than at some later decrypt that returns undefined.
 */
async function nip44Signer() {
  const signer = await signerManager.getSigner();
  if (!signer.nip44Encrypt || !signer.nip44Decrypt) {
    throw new Error(
      "This signer does not support NIP-44 encryption, which private boards require. " +
        "Sign in with a different method or use a public board.",
    );
  }
  return signer as Required<Pick<typeof signer, "nip44Encrypt" | "nip44Decrypt">> & typeof signer;
}

/**
 * A signer whose identity is resolved per call rather than captured at
 * construction. `signerManager.getSigner()` is the app-wide blocking accessor:
 * it returns the unlocked signer, or opens the login/unlock modal and resolves
 * once the user is through it. Routing every kanban write through it means the
 * SDK needs no rebuild on login, logout, or account switch, and kanban gets the
 * same auth behavior as every other module for free.
 */
const signer: KanbanSigner = {
  getPublicKey: async () => (await signerManager.getSigner()).getPublicKey(),
  signEvent: async (template) => (await signerManager.getSigner()).signEvent(template),
  nip44Encrypt: async (pubkey, plaintext) => (await nip44Signer()).nip44Encrypt(pubkey, plaintext),
  nip44Decrypt: async (pubkey, ciphertext) =>
    (await nip44Signer()).nip44Decrypt(pubkey, ciphertext),
};

/**
 * The app's single KanbanSDK.
 *
 * `runtime` is injected, so the SDK does not spin up a second WebSocket pool and
 * its `dispose()` is a no-op — core's runtime outlives any one module and is
 * disposed by the app, not here.
 *
 * That injection is only safe while the SDK reads through `querySync` and
 * `subscribe`, neither of which consults core's `EventStore` cache. Routing a
 * kanban read through `nostrRuntime.fetchOne` (cache-first) would serve a stale
 * copy of a replaceable board or card event and silently lose an edit.
 */
export const kanbanSdk = new KanbanSDK({
  signer,
  runtime: nostrRuntime,
  relays: [...MODULE_DEFAULT_RELAYS.kanban],
});
