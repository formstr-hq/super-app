import type { Event, Filter } from "nostr-tools";

import { nostrRuntime } from "../runtime/NostrRuntime";

import { MODULE_DEFAULT_RELAYS, type ModuleName } from "./module-defaults";

export interface RelayConfig {
  url: string;
  read: boolean;
  write: boolean;
}

/** Union of all module default relays, deduplicated. */
const DEFAULT_RELAYS: readonly string[] = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://relay.snort.social",
  "wss://nostr21.com",
];

/**
 * Unified relay manager with NIP-65 support.
 * Merges user's NIP-65 relay list with defaults.
 */
export class RelayManager {
  private defaultRelays: RelayConfig[];
  private userRelays: RelayConfig[] = [];

  constructor() {
    this.defaultRelays = DEFAULT_RELAYS.map((url) => ({ url, read: true, write: true }));
  }

  getReadRelays(): string[] {
    const relays = this.userRelays.length > 0 ? this.userRelays : this.defaultRelays;
    return relays.filter((r) => r.read).map((r) => r.url);
  }

  getWriteRelays(): string[] {
    const relays = this.userRelays.length > 0 ? this.userRelays : this.defaultRelays;
    return relays.filter((r) => r.write).map((r) => r.url);
  }

  getAllRelays(): string[] {
    const all = this.userRelays.length > 0 ? this.userRelays : this.defaultRelays;
    return [...new Set(all.map((r) => r.url))];
  }

  /** Fetch user's NIP-65 relay list (kind 10002) */
  async fetchUserRelays(pubkey: string): Promise<RelayConfig[]> {
    const filter: Filter = { kinds: [10002], authors: [pubkey], limit: 1 };
    const event = await nostrRuntime.fetchOne([...DEFAULT_RELAYS], filter);
    if (!event) return [];
    const configs = this.parseNip65(event);
    this.userRelays = configs;
    return configs;
  }

  /** Set user relays directly (e.g. from settings UI) */
  setUserRelays(relays: RelayConfig[]): void {
    this.userRelays = relays;
  }

  /** Module-specific relay subsets */
  getRelaysForModule(module: ModuleName): string[] {
    return [...MODULE_DEFAULT_RELAYS[module]];
  }

  getDefaultRelays(): string[] {
    return [...DEFAULT_RELAYS];
  }

  /** Reset user relays — used by tests and logout. */
  dispose(): void {
    this.userRelays = [];
  }

  private parseNip65(event: Event): RelayConfig[] {
    const configs: RelayConfig[] = [];
    for (const tag of event.tags) {
      if (tag[0] !== "r" || !tag[1]) continue;
      const url = tag[1];
      const marker = tag[2]; // "read" | "write" | undefined (both)
      configs.push({
        url,
        read: marker !== "write",
        write: marker !== "read",
      });
    }
    return configs;
  }
}

export const relayManager = new RelayManager();
