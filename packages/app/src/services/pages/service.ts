import {
  signerManager,
  nostrRuntime,
  relayManager,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
  encodeNKeys,
} from "@formstr/core";
import type { EventTemplate, Event, Filter } from "nostr-tools";
import { finalizeEvent, nip19 } from "nostr-tools";

import {
  PAGES_KINDS,
  type PageDocument,
  type PageSummary,
  type ShareResult,
  type SharedPageEntry,
} from "./types";
import { generateViewKey, encryptWithViewKey, decryptWithViewKey, hexToBytes } from "./viewKey";

const RELAYS = () => relayManager.getRelaysForModule("pages");

// ── Save / Update ───────────────────────────────────────

export interface SavePageParams {
  content: string;
  existingId?: string;
  /** When set, encrypt under this viewKey (shared doc) instead of owner self. */
  viewKey?: string;
  /** When set, sign the event with this key (recipient-editable shared doc). */
  editKey?: string;
}

export async function savePage(params: SavePageParams): Promise<PageDocument> {
  const signer = await signerManager.getSigner();
  const dTag = params.existingId ?? randomId(6);

  // Owner self-encryption for personal docs; viewKey self-conversation for shared
  // ones — exactly the standalone's encryptContent(content, viewKey?).
  const encrypted = params.viewKey
    ? await encryptWithViewKey(params.viewKey, params.content)
    : await nip44SelfEncrypt(signer, params.content);

  // No plaintext title tag (the standalone keeps the doc fully private; the
  // title is the decrypted first line).
  const template: EventTemplate = {
    kind: PAGES_KINDS.document,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", dTag]],
    content: encrypted,
  };

  const signed: Event = params.editKey
    ? finalizeEvent(template, hexToBytes(params.editKey))
    : await signer.signEvent(template);

  await nostrRuntime.publish(RELAYS(), signed);

  return {
    id: dTag,
    address: `${PAGES_KINDS.document}:${signed.pubkey}:${dTag}`,
    title: extractTitle(params.content),
    content: params.content,
    pubkey: signed.pubkey,
    createdAt: signed.created_at,
    isEncrypted: true,
    viewKey: params.viewKey,
    editKey: params.editKey,
    event: signed,
  };
}

// ── Fetch ───────────────────────────────────────────────

export async function fetchMyPages(viewKeys?: Map<string, string>): Promise<PageSummary[]> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const relays = RELAYS();

  const events = await nostrRuntime.querySync(relays, {
    kinds: [PAGES_KINDS.document],
    authors: [pubkey],
  } as Filter);

  const deletions = await fetchDeletions(relays, [pubkey]);

  // Newest-wins per d-tag, drop deleted.
  const newest = new Map<string, Event>();
  for (const ev of events) {
    if (isPageDeleted(ev, deletions)) continue;
    const dTag = ev.tags.find((t) => t[0] === "d")?.[1] ?? "";
    const prev = newest.get(dTag);
    if (!prev || ev.created_at > prev.created_at) newest.set(dTag, ev);
  }

  const summaries: PageSummary[] = [];
  for (const [dTag, ev] of newest) {
    const address = `${PAGES_KINDS.document}:${ev.pubkey}:${dTag}`;
    let title = `Document ${dTag}`;
    // Owner self-decrypt; fall back to a known viewKey (docs the owner has shared
    // are re-encrypted under the viewKey, so owner self-decrypt no longer works).
    try {
      title = extractTitle(await nip44SelfDecrypt(signer, ev.content));
    } catch {
      const vk = viewKeys?.get(address);
      if (vk) {
        try {
          title = extractTitle(await decryptWithViewKey(vk, ev.content));
        } catch {
          /* keep fallback title */
        }
      }
    }
    summaries.push({
      id: dTag,
      address,
      title,
      pubkey: ev.pubkey,
      createdAt: ev.created_at,
      isEncrypted: ev.content.length > 0,
      viewKey: viewKeys?.get(address),
    });
  }
  return summaries;
}

export async function fetchPage(
  pubkey: string,
  docId: string,
  viewKey?: string,
): Promise<PageDocument | null> {
  const event = await nostrRuntime.fetchOne(RELAYS(), {
    kinds: [PAGES_KINDS.document],
    authors: [pubkey],
    "#d": [docId],
    limit: 1,
  } as Filter);
  if (!event) return null;

  let content = event.content;
  let decrypted = false;
  try {
    content = viewKey
      ? await decryptWithViewKey(viewKey, event.content)
      : await nip44SelfDecrypt(await signerManager.getSigner(), event.content);
    decrypted = true;
  } catch {
    /* return ciphertext if we can't decrypt */
  }

  return {
    id: docId,
    address: `${PAGES_KINDS.document}:${event.pubkey}:${docId}`,
    title: decrypted ? extractTitle(content) : `Document ${docId}`,
    content,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    isEncrypted: !decrypted,
    viewKey,
    event,
  };
}

// ── Delete (NIP-09) ─────────────────────────────────────

export async function deletePage(address: string): Promise<void> {
  const signer = await signerManager.getSigner();
  const event: EventTemplate = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["a", address],
      ["k", String(PAGES_KINDS.document)],
    ],
    content: "Deleted via Formstr",
  };
  const signed = await signer.signEvent(event);
  await nostrRuntime.publish(RELAYS(), signed);
}

/** NIP-09 deletion index: deleted `a`-addresses → newest deletion time, + deleted e-ids. */
export interface DeletionIndex {
  coordTimes: Map<string, number>;
  ids: Set<string>;
}

export async function fetchDeletions(relays: string[], authors: string[]): Promise<DeletionIndex> {
  const coordTimes = new Map<string, number>();
  const ids = new Set<string>();
  if (authors.length === 0) return { coordTimes, ids };

  const events = await nostrRuntime.querySync(relays, { kinds: [5], authors } as Filter);
  for (const ev of events) {
    for (const tag of ev.tags) {
      if (tag[0] === "a" && tag[1]) {
        const author = tag[1].split(":")[1];
        if (author && author !== ev.pubkey) continue; // same-author guard
        const prev = coordTimes.get(tag[1]) ?? 0;
        if (ev.created_at > prev) coordTimes.set(tag[1], ev.created_at);
      } else if (tag[0] === "e" && tag[1]) {
        ids.add(`${ev.pubkey}:${tag[1]}`);
      }
    }
  }
  return { coordTimes, ids };
}

export function isPageDeleted(event: Event, index: DeletionIndex): boolean {
  if (index.ids.has(`${event.pubkey}:${event.id}`)) return true;
  const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  const delTime = index.coordTimes.get(`${event.kind}:${event.pubkey}:${dTag}`);
  return delTime !== undefined && event.created_at <= delTime;
}

// ── Share ───────────────────────────────────────────────

/** Pure builder: `/pages/<naddr>#<nkeys>` for an address + keys. */
export function generateShareLink(address: string, viewKey: string, editKey?: string): ShareResult {
  const [kindStr, pubkey, identifier] = address.split(":");
  const naddr = nip19.naddrEncode({ pubkey, kind: Number(kindStr), identifier });
  const nkeys = encodeNKeys({ viewKey, ...(editKey ? { editKey } : {}) });
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://formstr.app";
  return { url: `${origin}/pages/${naddr}#${nkeys}`, address, viewKey, editKey };
}

export interface SharePageParams {
  address: string;
  content: string;
  canEdit: boolean;
  /** Reuse an existing viewKey/editKey (re-share) instead of minting fresh ones. */
  viewKey?: string;
  editKey?: string;
}

/**
 * Mint (or reuse) a viewKey (+ editKey iff `canEdit`), re-encrypt the doc under
 * the viewKey, re-sign (with the editKey when can-edit, else the owner), publish,
 * and return the `#nkeys` share link. Mirrors `handleGeneratePrivateLink`.
 */
export async function sharePage(params: SharePageParams): Promise<ShareResult> {
  const signer = await signerManager.getSigner();
  const [, , dTag] = params.address.split(":");

  const viewKeyHex = params.viewKey ?? generateViewKey().hex;
  const editKeyHex = params.canEdit ? (params.editKey ?? generateViewKey().hex) : undefined;

  const encrypted = await encryptWithViewKey(viewKeyHex, params.content);
  const template: EventTemplate = {
    kind: PAGES_KINDS.document,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", dTag]],
    content: encrypted,
  };
  const signed: Event = editKeyHex
    ? finalizeEvent(template, hexToBytes(editKeyHex))
    : await signer.signEvent(template);

  await nostrRuntime.publish(RELAYS(), signed);

  const newAddress = `${PAGES_KINDS.document}:${signed.pubkey}:${dTag}`;
  return generateShareLink(newAddress, viewKeyHex, editKeyHex);
}

// ── Shared-with-me list (kind 11234) ────────────────────

export async function fetchSharedList(): Promise<SharedPageEntry[]> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const events = await nostrRuntime.querySync(RELAYS(), {
    kinds: [PAGES_KINDS.sharedPagesList],
    authors: [pubkey],
  } as Filter);
  if (events.length === 0) return [];
  const newest = events.reduce((a, b) => (b.created_at > a.created_at ? b : a));
  try {
    const parsed = JSON.parse(await nip44SelfDecrypt(signer, newest.content)) as unknown;
    if (Array.isArray(parsed)) return parsed as SharedPageEntry[];
  } catch {
    /* corrupt / not ours */
  }
  return [];
}

export async function saveSharedList(entries: SharedPageEntry[]): Promise<void> {
  const signer = await signerManager.getSigner();
  const content = await nip44SelfEncrypt(signer, JSON.stringify(entries));
  const signed = await signer.signEvent({
    kind: PAGES_KINDS.sharedPagesList,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content,
  });
  await nostrRuntime.publish(RELAYS(), signed);
}

/** Add (or update) one shared entry and republish the whole kind-11234 set. */
export async function addSharedPage(entry: SharedPageEntry): Promise<SharedPageEntry[]> {
  const existing = await fetchSharedList();
  const next = existing.filter((e) => e[0] !== entry[0]);
  next.push(entry);
  await saveSharedList(next);
  return next;
}

/** Fetch + decrypt every doc in the shared-with-me list as summaries. */
export async function fetchSharedPages(): Promise<PageSummary[]> {
  const entries = await fetchSharedList();
  const out: PageSummary[] = [];
  for (const [address, viewKey, editKey] of entries) {
    const [, pubkey, dTag] = address.split(":");
    if (!pubkey || !dTag) continue;
    const doc = await fetchPage(pubkey, dTag, viewKey);
    if (!doc) continue;
    out.push({
      id: dTag,
      address,
      title: doc.title,
      pubkey,
      createdAt: doc.createdAt,
      isEncrypted: doc.isEncrypted,
      shared: true,
      canEdit: !!editKey,
      viewKey,
    });
  }
  return out;
}

// ── Doc tags / labels (kind 34579) ──────────────────────

export async function fetchDocTags(addresses: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (addresses.length === 0) return result;
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const events = await nostrRuntime.querySync(RELAYS(), {
    kinds: [PAGES_KINDS.docMetadata],
    authors: [pubkey],
    "#d": addresses,
  } as Filter);

  const newest = new Map<string, Event>();
  for (const ev of events) {
    const addr = ev.tags.find((t) => t[0] === "d")?.[1] ?? "";
    const prev = newest.get(addr);
    if (!prev || ev.created_at > prev.created_at) newest.set(addr, ev);
  }
  for (const [addr, ev] of newest) {
    try {
      const parsed = JSON.parse(await nip44SelfDecrypt(signer, ev.content)) as { tags?: string[] };
      if (Array.isArray(parsed.tags)) result.set(addr, parsed.tags);
    } catch {
      /* skip corrupt */
    }
  }
  return result;
}

export async function setDocTags(address: string, tags: string[]): Promise<void> {
  const signer = await signerManager.getSigner();
  const content = await nip44SelfEncrypt(signer, JSON.stringify({ tags }));
  const signed = await signer.signEvent({
    kind: PAGES_KINDS.docMetadata,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", address]],
    content,
  });
  await nostrRuntime.publish(RELAYS(), signed);
}

// ── Helpers ─────────────────────────────────────────────

function extractTitle(markdown: string): string {
  const firstLine = markdown.trim().split("\n")[0] ?? "";
  return firstLine.replace(/^#+\s*/, "").trim() || "Untitled";
}

function randomId(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
    result += chars[byte % chars.length];
  }
  return result;
}
