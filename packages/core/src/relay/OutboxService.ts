import { nostrRuntime } from "../runtime/NostrRuntime";
import type { Filter } from "nostr-tools";
import { relayManager } from "./RelayManager";

interface RelayCache {
  outbox: string[];
  inbox: string[];
  fetchedAt: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * NIP-65 gossip relay discovery — ported from Polls' OutboxService.
 * 3-tier cache: in-memory → localStorage → network
 */
export class OutboxService {
  private cache = new Map<string, RelayCache>();
  private pending = new Map<string, Promise<RelayCache>>();

  /** User's write relays (outbox) from kind 10002 */
  async getOutboxRelays(pubkey: string): Promise<string[]> {
    const cached = this.getCached(pubkey);
    if (cached) return cached.outbox;
    const fresh = await this.fetchAndCache(pubkey);
    return fresh.outbox;
  }

  /** User's read relays (inbox) from kind 10002 */
  async getInboxRelays(pubkey: string): Promise<string[]> {
    const cached = this.getCached(pubkey);
    if (cached) return cached.inbox;
    const fresh = await this.fetchAndCache(pubkey);
    return fresh.inbox;
  }

  /** Merge user relays + gossip relays for a set of authors */
  async getRelaysForAuthors(userRelays: string[], authors: string[]): Promise<string[]> {
    const relaySet = new Set(userRelays);

    // Fetch outbox relays for each author (up to 20 gossip relays)
    const results = await Promise.allSettled(authors.map((a) => this.getOutboxRelays(a)));

    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const url of result.value) {
          relaySet.add(url);
        }
      }
    }

    // Limit total relay count
    return [...relaySet].slice(0, 20);
  }

  /** Batch prefetch NIP-65 for multiple pubkeys */
  async prefetchOutboxRelays(pubkeys: string[]): Promise<void> {
    const unfetched = pubkeys.filter((pk) => !this.getCached(pk));
    if (unfetched.length === 0) return;

    const filter: Filter = { kinds: [10002], authors: unfetched };
    const events = await nostrRuntime.querySync(relayManager.getDefaultRelays(), filter);

    for (const event of events) {
      const outbox: string[] = [];
      const inbox: string[] = [];

      for (const tag of event.tags) {
        if (tag[0] !== "r" || !tag[1]) continue;
        const marker = tag[2];
        if (marker !== "read") outbox.push(tag[1]);
        if (marker !== "write") inbox.push(tag[1]);
      }

      const cached: RelayCache = { outbox, inbox, fetchedAt: Date.now() };
      this.cache.set(event.pubkey, cached);
      this.storeToLocalStorage(event.pubkey, cached);
    }
  }

  // ── Internal ──────────────────────────────────────────

  private getCached(pubkey: string): RelayCache | null {
    // Check in-memory
    const mem = this.cache.get(pubkey);
    if (mem && Date.now() - mem.fetchedAt < CACHE_TTL) return mem;

    // Check localStorage (stale-while-revalidate)
    const stored = localStorage.getItem(`formstr:outbox:${pubkey}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as RelayCache;
        this.cache.set(pubkey, parsed);
        // Trigger background refresh if stale
        if (Date.now() - parsed.fetchedAt > CACHE_TTL) {
          this.fetchAndCache(pubkey);
        }
        return parsed;
      } catch {
        // Corrupted storage, ignore
      }
    }

    return null;
  }

  private async fetchAndCache(pubkey: string): Promise<RelayCache> {
    // Deduplicate concurrent fetches
    const existing = this.pending.get(pubkey);
    if (existing) return existing;

    const promise = this.doFetch(pubkey);
    this.pending.set(pubkey, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(pubkey);
    }
  }

  private async doFetch(pubkey: string): Promise<RelayCache> {
    const filter: Filter = { kinds: [10002], authors: [pubkey], limit: 1 };
    const event = await nostrRuntime.fetchOne(relayManager.getDefaultRelays(), filter);

    const outbox: string[] = [];
    const inbox: string[] = [];

    if (event) {
      for (const tag of event.tags) {
        if (tag[0] !== "r" || !tag[1]) continue;
        const marker = tag[2];
        if (marker !== "read") outbox.push(tag[1]);
        if (marker !== "write") inbox.push(tag[1]);
      }
    }

    const cached: RelayCache = { outbox, inbox, fetchedAt: Date.now() };
    this.cache.set(pubkey, cached);
    this.storeToLocalStorage(pubkey, cached);
    return cached;
  }

  private storeToLocalStorage(pubkey: string, data: RelayCache): void {
    try {
      localStorage.setItem(`formstr:outbox:${pubkey}`, JSON.stringify(data));
    } catch {
      // localStorage full — non-critical
    }
  }
}

export const outboxService = new OutboxService();
