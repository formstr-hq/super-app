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
  // MUST stay a superset of @formstr/kanban-sdk's DEFAULT_RELAYS
  // (relay.damus.io, nos.lol, relay.primal.net). Narrowing below those three
  // silently breaks interop with kanbanstr.com — boards published here stop
  // appearing there, and no local test catches it.
  kanban: [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.primal.net",
    "wss://relay.nostr.band",
  ],
  // Pages and Polls have no UI in the web app any more, but the agent still
  // implements them for the MCP server — these are protocol relays, not app
  // navigation, so they stay.
  pages: ["wss://relay.damus.io", "wss://relay.primal.net", "wss://nos.lol"],
  polls: [
    "wss://relay.damus.io",
    "wss://relay.primal.net",
    "wss://nos.lol",
    "wss://relay.nostr.wirednet.jp",
    "wss://nostr-01.yakihonne.com",
    "wss://nostr21.com",
  ],
  drive: ["wss://relay.damus.io", "wss://relay.nostr.band", "wss://nos.lol"],
} as const;

export type ModuleName = keyof typeof MODULE_DEFAULT_RELAYS;
