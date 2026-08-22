import { SimplePool } from "nostr-tools";

/**
 * The relay pool NIP-46 bunker transport runs on.
 *
 * Separate from the app's network runtime on purpose. Bunker traffic is signer
 * transport, not app data: it is request/response with one remote signer, it
 * must keep working whichever backend the app installs for reading and writing
 * events, and a cache-only backend has no socket to lend it anyway.
 */
export const signerPool = new SimplePool();
