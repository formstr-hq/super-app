import { relayManager } from "@formstr/core";
import type { Filter } from "nostr-tools";

import { isCoveredBy } from "./coverage";

/** One module's standing interest: what to keep warm, and where it lives. */
export interface WarmScope {
  module: string;
  filters: Filter[];
  relays: string[];
}

/** What the data layer needs to be, for a registry to declare interests on it. */
interface Declarable {
  observe(
    filters: Filter[],
    handlers: { onEvent: (event: never) => void },
    options?: { relays?: string[] },
  ): { unobserve: () => void };
}

/**
 * The reads every module fires on mount, hoisted to boot.
 *
 * These are the user's own lists — the roots each module expands from. Keeping
 * them standing is what lets a read settle on a short grace instead of waiting
 * out the network: the worker is already refreshing this data, so the cache is
 * not merely warm but current.
 *
 * Deliberately narrow. Each filter is pinned to the user (as author, or as the
 * `p`-tagged recipient of a wrap), because a standing interest on a whole kind
 * would have the worker sync the relay's entire history of it.
 */
export function warmScopesFor(pubkey: string): WarmScope[] {
  return [
    {
      module: "forms",
      // The kind-14083 my-forms list: every form the user owns hangs off it.
      filters: [{ kinds: [14083], authors: [pubkey] }],
      relays: relayManager.getRelaysForModule("forms"),
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
    },
    {
      module: "calendar",
      filters: [
        { kinds: [32123], authors: [pubkey] },
        // Invitation wraps address the recipient, never the sender.
        { kinds: [1059], "#p": [pubkey] },
      ],
      relays: relayManager.getRelaysForModule("calendar"),
    },
    {
      module: "drive",
      filters: [{ kinds: [34578], authors: [pubkey] }],
      relays: relayManager.getRelaysForModule("drive"),
    },
    {
      module: "profile",
      filters: [{ kinds: [0], authors: [pubkey] }],
      // Profile reads are not module-scoped: the agent's profile service reads
      // from the user's whole relay set, so the warm interest must too.
      relays: relayManager.getAllRelays(),
    },
  ];
}

/**
 * Holds the app's standing interests for one account.
 *
 * Nothing in the UI owns these: they are declared once at login and dropped at
 * logout, so mounting or unmounting a view never opens or closes a socket. The
 * registry also answers whether a given read is backed by one of them, which is
 * what the runtime consults before settling a read early.
 */
export class WarmupRegistry {
  private handles: Array<{ unobserve: () => void }> = [];
  private declared: Filter[] = [];

  constructor(private readonly dataLayer: Declarable) {}

  /** Declare every scope for `pubkey`, replacing any previous account's. */
  start(pubkey: string): void {
    this.stop();
    for (const scope of warmScopesFor(pubkey)) {
      this.handles.push(
        this.dataLayer.observe(
          scope.filters,
          // The interest exists to keep the store warm; readers read the store.
          { onEvent: () => {} },
          scope.relays.length > 0 ? { relays: scope.relays } : undefined,
        ),
      );
      this.declared.push(...scope.filters);
    }
  }

  stop(): void {
    for (const handle of this.handles) handle.unobserve();
    this.handles = [];
    this.declared = [];
  }

  /** Is this read backed by a standing interest? */
  covers(filter: Filter): boolean {
    return this.declared.some((declared) => isCoveredBy(filter, declared));
  }
}
