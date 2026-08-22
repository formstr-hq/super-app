import { defaultPrunePolicy, type PrunePolicy } from "@formstr/local-relay";

const DAY = 24 * 60 * 60;

/**
 * Kinds the cache must never drop, however old they get.
 *
 * The library's default policy protects profiles, contacts, relay lists and the
 * 10000-series — everything a generic Nostr client needs and nothing this app
 * stores. Every kind below would otherwise fall to the 7-day default TTL and be
 * swept on the next five-minute prune, which for addressable events is not an
 * expiry at all: a board edited once and then left alone is still the current
 * board, and deleting it strands the user with an empty module offline. Worse,
 * the pruned event is re-fetched on the next read and pruned again on the next
 * sweep, forever.
 *
 * These are bounded by what one user creates, so protecting them cannot run the
 * store away. High-volume kinds — other people's responses, RSVPs, wraps — get a
 * long TTL below instead, because protection also exempts a kind from the
 * `maxEvents` cap and those have no natural ceiling.
 */
const PROTECTED_KINDS: readonly number[] = [
  // Kanban (NIP-100 public, NIP-100E private)
  30301, // public board
  30302, // public card
  30303, // admin patch — kanban-sdk 0.2.0, harmless before it lands
  32301, // private board
  32302, // private card
  32303, // private board list
  32304, // private comment
  32305, // private admin patch — 0.2.0, as above
  84, // membership removal
  // Calendar
  31923, // public event
  32123, // calendar list — the only discovery channel for private events
  32678, // private event
  32679, // private event, legacy recurring variant (read-only)
  // Forms
  14083, // my-forms list
  30168, // form template
  // Drive
  34578, // file metadata
  /**
   * Deletions, which must outlive what they delete. Tombstones are always newer
   * than their target, so an unprotected kind-5 expires *after* the event it
   * buries — and with the target protected above, letting the tombstone go would
   * resurrect a deleted board or card on the next fetch.
   */
  5,
];

/**
 * Kinds kept, but not forever.
 *
 * Unbounded in principle — a popular form's responses, every attendee's RSVP —
 * so these stay evictable by the `maxEvents` cap and age out on their own. The
 * TTLs are generous because the failure they guard against is a full store, not
 * a stale one.
 */
const BULK_KIND_TTL_SECONDS: ReadonlyArray<readonly [number, number]> = [
  [1069, 180 * DAY], // form responses
  [31925, 180 * DAY], // public RSVPs
  [32069, 180 * DAY], // private RSVPs
  [1059, 180 * DAY], // gift wraps (invitations)
  [31926, 90 * DAY], // public busy lists — regenerated per month, cheap to refetch
  [1111, 180 * DAY], // public comments
];

/**
 * The app's pruning policy: the library's defaults, widened to cover what this
 * app actually stores. Built fresh per call — `PrunePolicy` holds a mutable Set
 * and Map, so a shared instance would leak edits between callers.
 */
export function appPrunePolicy(): PrunePolicy {
  const policy = defaultPrunePolicy();
  for (const kind of PROTECTED_KINDS) policy.protectedKinds.add(kind);
  for (const [kind, ttl] of BULK_KIND_TTL_SECONDS) policy.ttlByKind.set(kind, ttl);
  return policy;
}
