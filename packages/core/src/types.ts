/**
 * Shared type definitions across all Formstr modules.
 */

import type { Event, VerifiedEvent } from "nostr-tools";

/** Nostr event with optional verification status */
export type NostrEvent = Event;
export type SignedEvent = VerifiedEvent;

/** Module identifiers */
export type ModuleName = "forms" | "calendar" | "pages" | "drive" | "polls";

/** Generic async result pattern used across modules */
export type AsyncResult<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: Error };

/** NIP-19 entity references */
export interface NaddrParams {
  kind: number;
  pubkey: string;
  identifier: string;
  relays?: string[];
}

export interface NeventParams {
  id: string;
  relays?: string[];
  author?: string;
  kind?: number;
}

/** Tag helper types */
export type Tag = string[];

/** Replaceable event address (kind:pubkey:d-tag) */
export type EventAddress = `${number}:${string}:${string}`;

/** User profile (NIP-01 kind 0) */
export interface UserProfile {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  nip05?: string;
  lud16?: string;
  banner?: string;
}
