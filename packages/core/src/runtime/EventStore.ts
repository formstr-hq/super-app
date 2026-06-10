import type { Event, Filter } from "nostr-tools";
import { matchFilter } from "nostr-tools";

type EventCallback = (event: Event) => void;

interface ReactiveSubscription {
  filter: Filter;
  callback: EventCallback;
}

/**
 * Multi-indexed in-memory event cache with reactive subscriptions.
 * Based on Calendar's EventStore — handles replaceable events,
 * NIP-09 deletions, and participant removals (kind 84).
 */
export class EventStore {
  private eventsById = new Map<string, Event>();
  private eventsByKind = new Map<number, Map<string, Event>>();
  private eventsByAuthor = new Map<string, Map<string, Event>>();
  private eventsByDTag = new Map<string, Event>(); // "kind:pubkey:dtag" → event
  private deletedIds = new Set<string>();
  // NIP-09 coordinate tombstones: "kind:pubkey:dtag" → newest deletion created_at.
  // An addressable event is only rejected when its created_at ≤ that time, so a
  // legitimate re-publish after a delete survives.
  private deletedCoordinates = new Map<string, number>();
  // Kind-84 participant-removal tombstones.
  private ignoredEventIds = new Set<string>();
  private ignoredCoordinates = new Set<string>();
  private subscriptions: ReactiveSubscription[] = [];

  /** Store event. Returns false if duplicate or older replaceable. */
  store(event: Event): boolean {
    // Skip deleted / participant-removed events
    if (this.deletedIds.has(event.id)) return false;
    if (this.ignoredEventIds.has(event.id)) return false;

    // Skip if we already have this exact event
    if (this.eventsById.has(event.id)) return false;

    // Handle replaceable events (kinds 0, 3, 10000-19999)
    // Handle parameterized replaceable events (kinds 30000-39999)
    if (this.isReplaceable(event.kind) || this.isParameterizedReplaceable(event.kind)) {
      const addr = this.getAddress(event);

      // NIP-09 tombstone by coordinate — deletions stick even when they arrive
      // before their target; a newer re-publish supersedes the deletion.
      const deletedAt = this.deletedCoordinates.get(addr);
      if (deletedAt !== undefined && event.created_at <= deletedAt) return false;
      if (this.ignoredCoordinates.has(addr)) return false;

      const existing = this.eventsByDTag.get(addr);
      if (existing && existing.created_at >= event.created_at) {
        return false; // We have a newer version
      }
      // Remove old version if exists
      if (existing) {
        this.eventsById.delete(existing.id);
        this.eventsByKind.get(existing.kind)?.delete(existing.id);
        this.eventsByAuthor.get(existing.pubkey)?.delete(existing.id);
      }
      this.eventsByDTag.set(addr, event);
    }

    // Handle deletion events (kind 5, NIP-09)
    if (event.kind === 5) {
      this.handleDeletion(event);
    }

    // Handle participant removals (kind 84)
    if (event.kind === 84) {
      this.handleParticipantRemoval(event);
    }

    // Index by ID
    this.eventsById.set(event.id, event);

    // Index by kind
    if (!this.eventsByKind.has(event.kind)) {
      this.eventsByKind.set(event.kind, new Map());
    }
    this.eventsByKind.get(event.kind)!.set(event.id, event);

    // Index by author
    if (!this.eventsByAuthor.has(event.pubkey)) {
      this.eventsByAuthor.set(event.pubkey, new Map());
    }
    this.eventsByAuthor.get(event.pubkey)!.set(event.id, event);

    // Notify reactive subscriptions
    for (const sub of this.subscriptions) {
      if (matchFilter(sub.filter, event)) {
        sub.callback(event);
      }
    }

    return true;
  }

  /** Get single event by ID */
  get(id: string): Event | undefined {
    return this.eventsById.get(id);
  }

  /** Sync filter match against entire cache */
  query(filter: Filter): Event[] {
    const results: Event[] = [];

    // Optimize: if filter has specific IDs, look them up directly
    if (filter.ids && filter.ids.length > 0) {
      for (const id of filter.ids) {
        const event = this.eventsById.get(id);
        if (event && matchFilter(filter, event)) {
          results.push(event);
        }
      }
      return results;
    }

    // Optimize: if filter has specific kinds, narrow search
    if (filter.kinds && filter.kinds.length > 0) {
      for (const kind of filter.kinds) {
        const kindEvents = this.eventsByKind.get(kind);
        if (kindEvents) {
          for (const event of kindEvents.values()) {
            if (matchFilter(filter, event)) {
              results.push(event);
            }
          }
        }
      }
      return results;
    }

    // Fallback: scan all events
    for (const event of this.eventsById.values()) {
      if (matchFilter(filter, event)) {
        results.push(event);
      }
    }

    return results;
  }

  /** Remove event by ID */
  remove(id: string): void {
    const event = this.eventsById.get(id);
    if (!event) return;

    this.eventsById.delete(id);
    this.eventsByKind.get(event.kind)?.delete(id);
    this.eventsByAuthor.get(event.pubkey)?.delete(id);
    this.deletedIds.add(id);
  }

  /** Process NIP-09 deletion event */
  handleDeletion(deletionEvent: Event): void {
    for (const tag of deletionEvent.tags) {
      if (tag[0] === "e" && tag[1]) {
        const targetId = tag[1];
        const target = this.eventsById.get(targetId);
        // Same-author rule: a cached target by a different author means the
        // deletion is forged — skip entirely (no removal, no tombstone).
        // Unknown targets are tombstoned; they can't be validated yet.
        if (target && target.pubkey !== deletionEvent.pubkey) continue;
        this.deletedIds.add(targetId);
        if (target) this.remove(targetId);
      }
      if (tag[0] === "a" && tag[1]) {
        // Delete by address ("kind:pubkey:dtag") — only honored when the
        // deleter authored the coordinate.
        const coordAuthor = tag[1].split(":")[1];
        if (coordAuthor && coordAuthor !== deletionEvent.pubkey) continue;

        const prev = this.deletedCoordinates.get(tag[1]) ?? 0;
        if (deletionEvent.created_at > prev) {
          this.deletedCoordinates.set(tag[1], deletionEvent.created_at);
        }
        const existing = this.eventsByDTag.get(tag[1]);
        if (existing && existing.created_at <= deletionEvent.created_at) {
          this.remove(existing.id);
          this.eventsByDTag.delete(tag[1]);
        }
      }
    }
  }

  /**
   * Process a kind-84 participant removal (a participant opting out of an
   * event). Unlike NIP-09 there is no same-author rule — any participant
   * (`p` tag on the target) may remove it for themselves; targets that aren't
   * cached yet are tombstoned unconditionally, matching the standalone
   * calendar's EventStore.
   */
  handleParticipantRemoval(removalEvent: Event): void {
    const isParticipant = (target: Event) =>
      target.tags.some((t) => t[0] === "p" && t[1] === removalEvent.pubkey);

    for (const tag of removalEvent.tags) {
      if (tag[0] === "e" && tag[1]) {
        const existing = this.eventsById.get(tag[1]);
        if (existing) {
          if (!isParticipant(existing)) continue;
          this.remove(tag[1]);
        }
        this.ignoredEventIds.add(tag[1]);
      } else if (tag[0] === "a" && tag[1]) {
        this.ignoredCoordinates.add(tag[1]);
        const existing = this.eventsByDTag.get(tag[1]);
        if (existing && isParticipant(existing)) {
          this.remove(existing.id);
          this.eventsByDTag.delete(tag[1]);
        }
      }
    }
  }

  /** Subscribe to new events matching filter. Returns unsubscribe function. */
  subscribe(filter: Filter, callback: EventCallback): () => void {
    const sub: ReactiveSubscription = { filter, callback };
    this.subscriptions.push(sub);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx !== -1) this.subscriptions.splice(idx, 1);
    };
  }

  /** Wipe all cached events, indexes, deletions, and reactive subscriptions. */
  clear(): void {
    this.eventsById.clear();
    this.eventsByKind.clear();
    this.eventsByAuthor.clear();
    this.eventsByDTag.clear();
    this.deletedIds.clear();
    this.deletedCoordinates.clear();
    this.ignoredEventIds.clear();
    this.ignoredCoordinates.clear();
    this.subscriptions = [];
  }

  get size(): number {
    return this.eventsById.size;
  }

  // ── Helpers ──────────────────────────────────────────

  private isReplaceable(kind: number): boolean {
    return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
  }

  private isParameterizedReplaceable(kind: number): boolean {
    return kind >= 30000 && kind < 40000;
  }

  private getAddress(event: Event): string {
    if (this.isParameterizedReplaceable(event.kind)) {
      const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
      return `${event.kind}:${event.pubkey}:${dTag}`;
    }
    return `${event.kind}:${event.pubkey}`;
  }
}
