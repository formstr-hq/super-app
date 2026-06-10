/**
 * Per-module default relays.
 * Picked from each upstream module's hardcoded list, deduplicated.
 * Used only when a module wants narrower defaults than RelayManager.getReadRelays().
 */
export const MODULE_DEFAULT_RELAYS = {
  forms: [
    "wss://relay.damus.io",
    "wss://relay.primal.net",
    "wss://nos.lol",
    "wss://relay.nostr.wirednet.jp",
    "wss://nostr-01.yakihonne.com",
    "wss://relay.snort.social",
    "wss://relay.nostr.band",
    "wss://nostr21.com",
  ],
  // Union of the super-app's original set and calendar.formstr.app's hardcoded
  // relays, so events published here land on every relay the standalone reads
  // (and vice-versa) — required for cross-app calendar sync.
  calendar: [
    "wss://relay.damus.io",
    "wss://relay.primal.net",
    "wss://nos.lol",
    "wss://nostr-pub.wellorder.net",
    "wss://nostr.mom",
    "wss://relay.nostr.wirednet.jp",
    "wss://nostr-01.yakihonne.com",
    "wss://relay.snort.social",
    "wss://nostr21.com",
  ],
  pages: ["wss://relay.damus.io", "wss://relay.primal.net", "wss://nos.lol"],
  drive: ["wss://relay.damus.io", "wss://relay.nostr.band", "wss://nos.lol"],
  polls: [
    "wss://relay.damus.io",
    "wss://relay.primal.net",
    "wss://nos.lol",
    "wss://relay.nostr.wirednet.jp",
    "wss://nostr-01.yakihonne.com",
    "wss://nostr21.com",
  ],
} as const;

export type ModuleName = keyof typeof MODULE_DEFAULT_RELAYS;
