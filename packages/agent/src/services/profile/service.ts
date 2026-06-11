import { nostrRuntime, relayManager } from "@formstr/core";
import type { Filter } from "nostr-tools";

/** Parsed NIP-01 kind-0 profile metadata. */
export interface NostrProfile {
  pubkey: string;
  name?: string;
  displayName?: string;
  picture?: string;
  banner?: string;
  about?: string;
  nip05?: string;
  website?: string;
  lud16?: string;
  /** created_at of the kind-0 event the profile was read from. */
  createdAt: number;
}

/**
 * Fetch a user's kind-0 profile from the user's relays ∪ defaults.
 * Returns null when no profile event is found; a malformed content JSON still
 * yields a bare profile (pubkey + timestamp) so callers can render a fallback.
 */
export async function fetchProfile(pubkey: string): Promise<NostrProfile | null> {
  const relays = relayManager.getAllRelays();
  const event = await nostrRuntime.fetchOne(relays, {
    kinds: [0],
    authors: [pubkey],
    limit: 1,
  } as Filter);
  if (!event) return null;

  let meta: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(event.content);
    if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
  } catch {
    /* malformed kind-0 content — return the bare profile */
  }

  const str = (key: string): string | undefined =>
    typeof meta[key] === "string" && (meta[key] as string) !== ""
      ? (meta[key] as string)
      : undefined;

  return {
    pubkey: event.pubkey,
    name: str("name"),
    displayName: str("display_name") ?? str("displayName"),
    picture: str("picture"),
    banner: str("banner"),
    about: str("about"),
    nip05: str("nip05"),
    website: str("website"),
    lud16: str("lud16"),
    createdAt: event.created_at,
  };
}
