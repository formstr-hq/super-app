import { relayManager } from "@formstr/core";
import type { Filter } from "nostr-tools";

/** One module's standing interest: what to keep warm, and where it lives. */
export interface AppScope {
  module: string;
  filters: Filter[];
  relays: string[];
  /**
   * Should a change here invalidate a store?
   *
   * False means the scope is kept warm but not watched — the module already runs
   * its own live subscription, and a second one would decode everything twice.
   */
  watch: boolean;
}

/**
 * The reads every module fires on mount, hoisted to boot.
 *
 * These are the user's own lists — the roots each module expands from. Keeping
 * them standing is what lets a read settle on a short grace instead of waiting
 * out the network: the worker is already refreshing this data, so the cache is
 * not merely warm but current. Watching them is what makes the UI reactive; the
 * two must describe the same scopes, which is why one function defines both.
 *
 * Deliberately narrow. Each filter is pinned to the user (as author, or as the
 * `p`-tagged recipient of a wrap), because a standing interest on a whole kind
 * would have the worker sync the relay's entire history of it.
 *
 * Kept free of store imports so the warm-up registry, which runs at boot, does
 * not drag every module's SDK in with it. The refetch bindings live in
 * `bindings.ts`.
 */
export function scopesFor(pubkey: string): AppScope[] {
  return [
    {
      module: "forms",
      // The kind-14083 my-forms list: every form the user owns hangs off it.
      filters: [{ kinds: [14083], authors: [pubkey] }],
      relays: relayManager.getRelaysForModule("forms"),
      watch: true,
    },
    {
      module: "kanban",
      filters: [
        // Boards the user wrote, and the private-board list that points at the
        // ones they were invited to.
        { kinds: [30301, 32301, 32303], authors: [pubkey] },
        // Boards that name the user — an admin or participant reads the
        // creator's copy, not their own.
        { kinds: [30301, 32301], "#p": [pubkey] },
      ],
      relays: relayManager.getRelaysForModule("kanban"),
      watch: true,
    },
    {
      module: "calendar",
      filters: [{ kinds: [32123], authors: [pubkey] }],
      relays: relayManager.getRelaysForModule("calendar"),
      watch: true,
    },
    {
      module: "invitations",
      // Invitation wraps address the recipient, never the sender.
      filters: [{ kinds: [1059], "#p": [pubkey] }],
      relays: relayManager.getRelaysForModule("calendar"),
      // invitationsStore already runs its own subscription over this stream,
      // through the SDK's inbox plus the legacy kind-1052 reader. Watching it
      // here would decode every wrap twice.
      watch: false,
    },
    {
      module: "drive",
      filters: [{ kinds: [34578], authors: [pubkey] }],
      relays: relayManager.getRelaysForModule("drive"),
      watch: true,
    },
    {
      module: "profile",
      filters: [{ kinds: [0], authors: [pubkey] }],
      // Profile reads are not module-scoped: the agent's profile service reads
      // from the user's whole relay set, so the warm interest must too.
      relays: relayManager.getAllRelays(),
      watch: true,
    },
    {
      module: "deletions",
      /**
       * Every SDK read pairs itself with a deletion query — kanban-sdk issues one
       * alongside `fetchBoards`, `fetchPrivateBoards` and `fetchCards`. Left
       * uncovered it pays the full cold quiet window on every refetch, setting
       * the floor for the whole read and defeating the warm path with the app's
       * own companion query.
       */
      filters: [{ kinds: [5], authors: [pubkey] }],
      relays: relayManager.getAllRelays(),
      // A tombstone the user wrote is already reflected by the module store that
      // wrote it; what matters here is that the scope stays warm.
      watch: false,
    },
  ];
}
