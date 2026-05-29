import type { EventTemplate, VerifiedEvent } from "nostr-tools";

import type { NostrSigner } from "../signer/types";

/**
 * Create kind 24242 Blossom auth event.
 * Used by Forms (file uploads), Pages (encrypted file embeds), Drive (all operations).
 */
export async function createBlossomAuthEvent(
  operation: "upload" | "get" | "delete" | "list",
  sha256: string,
  signer: NostrSigner,
): Promise<VerifiedEvent> {
  const now = Math.floor(Date.now() / 1000);

  const event: EventTemplate = {
    kind: 24242,
    created_at: now,
    tags: [
      ["t", operation],
      ["x", sha256],
      ["expiration", String(now + 300)], // 5 min validity
    ],
    content: `Authorize ${operation} for ${sha256}`,
  };

  return signer.signEvent(event);
}
