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

/** Module → route base. Single source of truth for router and AI action layer. */
export const MODULE_ROUTES: Record<ModuleType, string> = {
  forms: "/forms",
  calendar: "/calendar",
  pages: "/pages",
  drive: "/drive",
  polls: "/polls",
} as const;

/**
 * Map event kinds to modules.
 * Lists only the kinds each module actually reads/writes (see the module
 * services) so deep links resolve to a page that can open them.
 */
const KIND_MODULE_MAP: Record<number, ModuleType> = {
  // Forms
  30168: "forms", // Form template
  // Calendar
  31923: "calendar", // Public time-based event (NIP-52)
  32678: "calendar", // Private event
  32679: "calendar", // Private event (legacy recurring variant, read-only)
  32123: "calendar", // Calendar list
  // Pages
  33457: "pages", // Encrypted markdown doc (nostr-docs)
  // Drive
  34578: "drive", // File metadata (formstr-drive)
  // Polls
  1068: "polls", // Poll event (NIP-88)
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
        route: `${MODULE_ROUTES[module]}/${bech32}`,
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
        route: `${MODULE_ROUTES[module]}/${bech32}`,
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

const MODULE_TYPES: readonly ModuleType[] = [
  "forms",
  "calendar",
  "pages",
  "drive",
  "polls",
] as const;

/** Format a cross-module reference as `formstr:<module>:<identifier>` (event-tag form). */
export function createTagRef(module: ModuleType, identifier: string): string {
  return `formstr:${module}:${identifier}`;
}

/** Parse the `formstr:<module>:<identifier>` form; returns null on malformed input. */
export function parseTagRef(s: string): { module: ModuleType; identifier: string } | null {
  const match = s.match(/^formstr:([a-z]+):(.+)$/);
  if (!match) return null;
  const [, modStr, identifier] = match;
  if (!MODULE_TYPES.includes(modStr as ModuleType)) return null;
  if (!identifier) return null;
  return { module: modStr as ModuleType, identifier };
}
