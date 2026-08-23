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

/**
 * Initials for a kind-0 name, or null when it has none worth showing.
 *
 * Two words give their first letters, one word its first two, so a tile is
 * always two characters wide where the name allows it. Only letters and digits
 * count: nostr names are full of emoji and ornaments, and a tile reading "★彡"
 * identifies nobody — null tells the caller to fall back to the npub, which at
 * least a reader can match against a profile.
 */
export function initialsFromName(name: string): string | null {
  const words = name
    .split(/\s+/)
    .map((word) => [...word].filter((char) => /[\p{L}\p{N}]/u.test(char)).join(""))
    .filter(Boolean);
  if (words.length === 0) return null;

  const initials = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return initials.toUpperCase();
}
