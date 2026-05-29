/**
 * Cross-module deep linking — resolves nostr references to module routes.
 *
 * Enables "click a form in Calendar → opens in Forms module" patterns.
 * Format: naddr/nevent/nprofile bech32 → { module, route, params }.
 */

import { nip19 } from "nostr-tools";

export type ModuleType = "forms" | "calendar" | "pages" | "drive" | "polls";

export interface ModuleRef {
  module: ModuleType;
  route: string;
  params: Record<string, string>;
  raw: string; // Original bech32 or naddr
}

/** Map event kinds to modules */
const KIND_MODULE_MAP: Record<number, ModuleType> = {
  // Forms
  30168: "forms", // Form template
  // Calendar
  31922: "calendar", // Date-based calendar event
  31923: "calendar", // Time-based calendar event
  31924: "calendar", // Calendar list
  // Pages
  30023: "pages", // Long-form content (NIP-23)
  30024: "pages", // Draft article
  // Drive
  30563: "drive", // Drive file tree
  // Polls
  1068: "polls", // Poll event
};

/**
 * Create a reference URL for cross-module navigation.
 */
export function createRef(
  _module: ModuleType,
  kind: number,
  pubkey: string,
  identifier: string,
  relays: string[] = [],
): string {
  return nip19.naddrEncode({ kind, pubkey, identifier, relays });
}

/**
 * Parse a bech32 nostr reference into a ModuleRef.
 */
export function parseRef(bech32: string): ModuleRef | null {
  try {
    const decoded = nip19.decode(bech32);

    if (decoded.type === "naddr") {
      const { kind, pubkey, identifier, relays } = decoded.data;
      const module = KIND_MODULE_MAP[kind];
      if (!module) return null;

      return {
        module,
        route: `/${module}/${bech32}`,
        params: {
          kind: String(kind),
          pubkey,
          identifier,
          ...(relays?.length ? { relays: relays.join(",") } : {}),
        },
        raw: bech32,
      };
    }

    if (decoded.type === "nevent") {
      const { id, kind, relays } = decoded.data;
      const module = kind != null ? KIND_MODULE_MAP[kind] : undefined;
      if (!module) return null;

      return {
        module,
        route: `/${module}/${bech32}`,
        params: {
          id,
          kind: String(kind),
          ...(relays?.length ? { relays: relays.join(",") } : {}),
        },
        raw: bech32,
      };
    }

    if (decoded.type === "nprofile") {
      return {
        module: "forms", // Default profile view
        route: `/profile/${bech32}`,
        params: {
          pubkey: decoded.data.pubkey,
          ...(decoded.data.relays?.length ? { relays: decoded.data.relays.join(",") } : {}),
        },
        raw: bech32,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve a bech32 reference to a React Router path.
 */
export function resolveRef(bech32: string): string | null {
  const ref = parseRef(bech32);
  return ref?.route ?? null;
}
