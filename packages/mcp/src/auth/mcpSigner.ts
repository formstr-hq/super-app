import { createSigner, type Signer } from "@formstr/signer";

import { createKeystoreStorage } from "./kvStore";

/** Canonical app URL surfaced to remote signers on the nostrconnect consent screen. */
const APP_URL = "https://formstr.app";

/**
 * The MCP's single `@formstr/signer` instance, backed by the encrypted keystore
 * (OS keychain or AES-256-GCM file) instead of the browser's localStorage. Hydrates
 * synchronously from the keystore on construction; every persisted account starts
 * **locked** until the matching `loginWith*` runs. `appName` is required for the
 * nostrconnect (NIP-46 QR) flow.
 */
export async function buildMcpSigner(): Promise<Signer> {
  return createSigner({
    storage: await createKeystoreStorage(),
    appName: "Formstr MCP",
    appUrl: APP_URL,
  });
}
