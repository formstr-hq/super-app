import { nip19 } from "nostr-tools";

/** Convert an npub or raw hex pubkey to lowercase hex. Returns null if invalid. */
export function npubToHex(input: string): string | null {
  const trimmed = input.trim();
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === "npub") return decoded.data as string;
  } catch {
    /* not an npub — fall through to hex check */
  }
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

/** Render a hex pubkey as a short, human-readable npub (e.g. "npub1abc…wxyz"). */
export function formatNpub(pubkeyHex: string): string {
  try {
    const npub = nip19.npubEncode(pubkeyHex);
    return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
  } catch {
    return `${pubkeyHex.slice(0, 8)}…`;
  }
}
