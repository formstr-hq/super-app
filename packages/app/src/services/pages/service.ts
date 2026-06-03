import {
  signerManager,
  nostrRuntime,
  relayManager,
  nip44Encrypt,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
  encodeNKeys,
} from "@formstr/core";
import type { EventTemplate, Event, Filter } from "nostr-tools";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";

import {
  PAGES_KINDS,
  type PageDocument,
  type PageSummary,
  type ShareResult,
  type DocMetadata,
} from "./types";

// ── Create / Save Page ──────────────────────────────────

export interface SavePageParams {
  content: string;
  title?: string;
  existingId?: string; // Update existing doc
  viewKey?: string; // Existing view key for updates
  editKey?: string; // Signing key for shared docs
}

export async function savePage(params: SavePageParams): Promise<PageDocument> {
  const signer = await signerManager.getSigner();
  const docId = params.existingId ?? randomId(6);

  // Generate or reuse view key for encryption
  const viewKeyBytes = params.viewKey ? hexToBytes(params.viewKey) : generateSecretKey();
  const viewKeyHex = params.viewKey ?? bytesToHex(viewKeyBytes);
  const viewPubkey = getPublicKey(viewKeyBytes);

  // Encrypt content with NIP-44 to view key
  const encrypted = await nip44Encrypt(signer, viewPubkey, params.content);

  const title = params.title ?? extractTitle(params.content);
  // Plaintext title tag so the pages list can show a human-readable name
  // without having to decrypt every doc. The full content stays encrypted.
  const baseTags: string[][] = [
    ["d", docId],
    ["title", title],
  ];

  // Sign with edit key if provided, otherwise user's key
  let signed: Event;
  if (params.editKey) {
    const editKeyBytes = hexToBytes(params.editKey);
    const event: EventTemplate = {
      kind: PAGES_KINDS.document,
      created_at: Math.floor(Date.now() / 1000),
      tags: baseTags,
      content: encrypted,
    };
    signed = finalizeEvent(event, editKeyBytes);
  } else {
    const event: EventTemplate = {
      kind: PAGES_KINDS.document,
      created_at: Math.floor(Date.now() / 1000),
      tags: baseTags,
      content: encrypted,
    };
    signed = await signer.signEvent(event);
  }

  const relays = relayManager.getRelaysForModule("pages");
  await nostrRuntime.publish(relays, signed);

  return {
    id: docId,
    address: `${PAGES_KINDS.document}:${signed.pubkey}:${docId}`,
    title,
    content: params.content,
    pubkey: signed.pubkey,
    createdAt: signed.created_at,
    isEncrypted: true,
    viewKey: viewKeyHex,
    editKey: params.editKey,
    event: signed,
  };
}

// ── Fetch Pages ─────────────────────────────────────────

export async function fetchMyPages(): Promise<PageSummary[]> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const relays = relayManager.getRelaysForModule("pages");

  const filter: Filter = {
    kinds: [PAGES_KINDS.document],
    authors: [pubkey],
  };

  const events = await nostrRuntime.querySync(relays, filter);

  return events.map((event: Event) => {
    const dTag = event.tags.find((t: string[]) => t[0] === "d")?.[1] ?? "";
    const titleTag = event.tags.find((t: string[]) => t[0] === "title")?.[1];
    return {
      id: dTag,
      address: `${PAGES_KINDS.document}:${event.pubkey}:${dTag}`,
      // Older docs may not have a title tag — fall back gracefully
      title: titleTag && titleTag.trim() ? titleTag : `Document ${dTag}`,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      isEncrypted: event.content.length > 0,
    };
  });
}

export async function fetchPage(
  pubkey: string,
  docId: string,
  viewKey?: string,
): Promise<PageDocument | null> {
  const relays = relayManager.getRelaysForModule("pages");

  const filter: Filter = {
    kinds: [PAGES_KINDS.document],
    authors: [pubkey],
    "#d": [docId],
    limit: 1,
  };

  const event = await nostrRuntime.fetchOne(relays, filter);
  if (!event) return null;

  let content = event.content;
  let decrypted = false;

  if (viewKey) {
    try {
      const signer = await signerManager.getSigner();
      content = await nip44SelfDecrypt(signer, event.content);
      decrypted = true;
    } catch {
      // Could not decrypt — return encrypted content
    }
  }

  const titleTag = event.tags.find((t: string[]) => t[0] === "title")?.[1];
  return {
    id: docId,
    address: `${PAGES_KINDS.document}:${event.pubkey}:${docId}`,
    title: decrypted
      ? extractTitle(content)
      : titleTag && titleTag.trim()
        ? titleTag
        : `Document ${docId}`,
    content,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    isEncrypted: !decrypted,
    viewKey,
    event,
  };
}

// ── Share Page ──────────────────────────────────────────

export function generateShareLink(address: string, viewKey: string, editKey?: string): ShareResult {
  const keys: Record<string, string> = { viewKey };
  if (editKey) keys["editKey"] = editKey;

  const nkeysFragment = encodeNKeys(keys);
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://formstr.app";
  const url = `${origin}/pages/${address}#${nkeysFragment}`;

  return { url, address, viewKey, editKey };
}

// ── Delete Page ─────────────────────────────────────────

export async function deletePage(address: string): Promise<void> {
  const signer = await signerManager.getSigner();

  const event: EventTemplate = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["a", address]],
    content: "Deleted via Formstr",
  };

  const signed = await signer.signEvent(event);
  const relays = relayManager.getRelaysForModule("pages");
  await nostrRuntime.publish(relays, signed);
}

// ── Document Metadata (tags/labels) ─────────────────────

export async function saveDocMetadata(address: string, metadata: DocMetadata): Promise<void> {
  const signer = await signerManager.getSigner();
  const encrypted = await nip44SelfEncrypt(signer, JSON.stringify(metadata));

  const event: EventTemplate = {
    kind: PAGES_KINDS.docMetadata,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", address]],
    content: encrypted,
  };

  const signed = await signer.signEvent(event);
  const relays = relayManager.getRelaysForModule("pages");
  await nostrRuntime.publish(relays, signed);
}

// ── Helpers ─────────────────────────────────────────────

function extractTitle(markdown: string): string {
  const firstLine = markdown.trim().split("\n")[0];
  return firstLine.replace(/^#+\s*/, "").trim() || "Untitled";
}

function randomId(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const random = crypto.getRandomValues(new Uint8Array(length));
  for (const byte of random) {
    result += chars[byte % chars.length];
  }
  return result;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
