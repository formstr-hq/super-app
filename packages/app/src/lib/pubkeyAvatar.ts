import { nip19 } from "nostr-tools";

/**
 * Identity for a pubkey we have no profile for — which, on first paint, is
 * every pubkey. Colour and initials are derived from the key itself, so the
 * same person looks the same on every board without a metadata fetch.
 */

/** Stable 32-bit hash (FNV-1a). */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A mid-saturation, mid-lightness hue: dark enough for white text in either
 * theme, muted enough not to compete with the app's monochrome palette.
 */
export function avatarColor(pubkeyHex: string): string {
  return `hsl(${hash(pubkeyHex) % 360}, 42%, 42%)`;
}

/** Two characters from the npub body — what a reader would quote out loud. */
export function avatarInitials(pubkeyHex: string): string {
  try {
    return nip19.npubEncode(pubkeyHex).slice(5, 7).toUpperCase();
  } catch {
    return pubkeyHex.slice(0, 2).toUpperCase() || "??";
  }
}
