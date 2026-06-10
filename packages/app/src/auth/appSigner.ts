import { createSigner, type Signer } from "@formstr/signer";

/**
 * The app's single @formstr/signer instance — owns identity, accounts, and
 * persistence (localStorage under the "formstr:signer:" prefix). `appName` is
 * required for the nostrconnect (NIP-46 QR) flow; remote signers show it on the
 * consent screen.
 */
export const appSigner: Signer = createSigner({
  appName: "Formstr",
  appUrl: typeof window !== "undefined" ? window.location.origin : undefined,
  storageKeyPrefix: "formstr:signer:",
});
