import type { Event } from "nostr-tools";

// ── Event Kinds ─────────────────────────────────────────
export const PAGES_KINDS = {
  document: 33457,
  /** Legacy super-app shared-with-me list — read-only migration source; upstream
   *  (nostr-docs) has no such kind. Shares now live in kind-34579 doc metadata. */
  sharedPagesList: 11234,
  docMetadata: 34579,
  comment: 1494,
  crdtOp: 22457,
} as const;

// ── Data Structures ─────────────────────────────────────

export interface PageDocument {
  id: string; // d-tag
  address: string; // "kind:pubkey:dtag"
  title: string;
  content: string; // Markdown
  pubkey: string;
  createdAt: number;
  isEncrypted: boolean;
  viewKey?: string;
  editKey?: string;
  event?: Event;
}

export interface PageSummary {
  id: string;
  address: string;
  title: string;
  pubkey: string;
  createdAt: number;
  isEncrypted: boolean;
  tags?: string[];
  /** True for docs received via a share link (doc-metadata entries with a viewKey). */
  shared?: boolean;
  /** True when the share carried an editKey (recipient can edit). */
  canEdit?: boolean;
  /** The doc's viewKey (hex), when known (shared docs / owner's own shares). */
  viewKey?: string;
  /** Address of the shared (editKey-signed) copy — the original is a read-only backup. */
  sharedAs?: string;
}

/** One entry in the kind-11234 shared-with-me list: [address, viewKey, editKey?]. */
export type SharedPageEntry = [string, string] | [string, string, string];

export interface ShareResult {
  url: string;
  address: string;
  viewKey: string;
  editKey?: string;
}

/**
 * Per-document private metadata (kind 34579, d = doc address, NIP-44 self-encrypted
 * JSON) — exact upstream nostr-docs `DocMetadata`. Entries with a `viewKey` double
 * as the shared-with-me index (upstream `SharedDocsContext` discovery model).
 * Unknown keys are preserved on rewrite.
 */
export interface DocMetadata {
  tags?: string[];
  /** Custom display title (rename); blank/absent = derive from first Markdown line. */
  title?: string;
  viewKey?: string;
  editKey?: string;
  /** Address of the shared (editKey-signed) copy of this doc. */
  sharedAs?: string;
  [key: string]: unknown;
}

// ── Comments (kind 1494) ────────────────────────────────

export type PageCommentType = "comment" | "suggestion";

export interface PageCommentDraft {
  content: string;
  type: PageCommentType;
  /** The quoted document text the comment is anchored to. */
  quote?: string;
  /** Surrounding text used to re-anchor the quote after edits. */
  context?: { prefix: string; suffix: string };
}

export interface PageComment extends PageCommentDraft {
  id: string;
  author: string;
  createdAt: number;
}

export interface LocalStoredPage {
  address: string;
  content: string;
  viewKey?: string;
  editKey?: string;
  pendingBroadcast: boolean;
  savedAt: number;
  trashedAt?: number;
}
