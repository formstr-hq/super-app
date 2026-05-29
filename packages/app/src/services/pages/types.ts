import type { Event } from "nostr-tools";

// ── Event Kinds ─────────────────────────────────────────
export const PAGES_KINDS = {
  document: 33457,
  sharedPagesList: 11234,
  docMetadata: 34579,
  crdtOp: 22457,
} as const;

// ── Data Structures ─────────────────────────────────────

export interface PageDocument {
  id: string;          // d-tag
  address: string;     // "kind:pubkey:dtag"
  title: string;
  content: string;     // Markdown
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
}

export interface ShareResult {
  url: string;
  address: string;
  viewKey: string;
  editKey?: string;
}

export interface DocMetadata {
  tags: string[];
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
