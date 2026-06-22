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
  type DocMetadata,
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
  const metadata = await fetchAllDocMetadata().catch(() => new Map<string, DocMetadata>());

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
    const meta = metadata.get(address);
    const viewKey = meta?.viewKey ?? viewKeys?.get(address);
    // Custom title (rename) wins; else owner self-decrypt; else fall back to a known
    // viewKey (docs the owner has shared are re-encrypted under the viewKey, so
    // owner self-decrypt no longer works).
    let title = meta?.title || `Document ${dTag}`;
    if (!meta?.title) {
      try {
        title = extractTitle(await nip44SelfDecrypt(signer, ev.content));
      } catch {
        if (viewKey) {
          try {
            title = extractTitle(await decryptWithViewKey(viewKey, ev.content));
          } catch {
            /* keep fallback title */
          }
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
      viewKey,
      ...(Array.isArray(meta?.tags) && meta.tags.length > 0 ? { tags: meta.tags } : {}),
      ...(meta?.sharedAs ? { sharedAs: meta.sharedAs } : {}),
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
    /* fall through to the metadata viewKey */
  }
  // No viewKey supplied and owner self-decrypt failed: the user may hold a granted
  // viewKey in their doc metadata (upstream's shared-doc discovery model).
  if (!decrypted && !viewKey) {
    try {
      const meta = await fetchDocMetadata(`${PAGES_KINDS.document}:${pubkey}:${docId}`);
      if (meta?.viewKey) {
        content = await decryptWithViewKey(meta.viewKey, event.content);
        viewKey = meta.viewKey;
        decrypted = true;
      }
    } catch {
      /* return ciphertext if we can't decrypt */
    }
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
  const [kindStr, pubkey, dTag] = address.split(":");

  // e-tag every version of the addressable doc (upstream deleteEvent passes all
  // version ids) so relays can drop the individual events, not just the address.
  let versionIds: string[] = [];
  try {
    const versions = await nostrRuntime.querySync(RELAYS(), {
      kinds: [Number(kindStr)],
      authors: [pubkey],
      "#d": [dTag],
    } as Filter);
    versionIds = versions.map((v: Event) => v.id);
  } catch {
    /* address-only deletion still works */
  }

  const event: EventTemplate = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["a", address],
      ["k", String(PAGES_KINDS.document)],
      ...versionIds.map((id) => ["e", id]),
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
 * and return the `#nkeys` share link. Mirrors `handleGeneratePrivateLink` +
 * the upstream post-share bookkeeping (record keys in doc metadata; mark the
 * original with `sharedAs`).
 *
 * Edit re-share: when the doc already has a live shared copy (`sharedAs`) with
 * known keys, the existing link is returned WITHOUT republishing — republishing
 * would push our stale local copy over any edits collaborators made through the
 * live link (upstream ShareModal behavior).
 */
export async function sharePage(params: SharePageParams): Promise<ShareResult> {
  const signer = await signerManager.getSigner();
  const [, ownerPubkey, dTag] = params.address.split(":");

  const originalMeta = await fetchDocMetadata(params.address).catch(() => undefined);
  if (params.canEdit && originalMeta?.sharedAs) {
    const sharedMeta = await fetchDocMetadata(originalMeta.sharedAs).catch(() => undefined);
    if (sharedMeta?.viewKey && sharedMeta.editKey) {
      return generateShareLink(originalMeta.sharedAs, sharedMeta.viewKey, sharedMeta.editKey);
    }
  }

  const viewKeyHex = params.viewKey ?? originalMeta?.viewKey ?? generateViewKey().hex;
  const editKeyHex = params.canEdit
    ? (params.editKey ?? originalMeta?.editKey ?? generateViewKey().hex)
    : undefined;

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

  // Record the share keys in doc metadata (upstream addSharedDoc) and, for an
  // edit-share of the user's own doc, mark the original as a backup pointing at
  // the shared copy (upstream setDocSharedAs).
  await saveDocMetadata(newAddress, {
    viewKey: viewKeyHex,
    ...(editKeyHex ? { editKey: editKeyHex } : {}),
  });
  if (editKeyHex && ownerPubkey === (await signer.getPublicKey())) {
    await saveDocMetadata(params.address, { sharedAs: newAddress });
  }

  return generateShareLink(newAddress, viewKeyHex, editKeyHex);
}

// ── Shared-with-me docs (kind-34579 metadata entries with a viewKey) ──

/**
 * Shared docs, upstream model: every doc-metadata entry carrying a `viewKey` is a
 * shared/received doc (`[address, viewKey, editKey?]`). Legacy super-app kind-11234
 * list entries are merged in read-only and migrated into doc metadata best-effort,
 * so they become visible to pages.formstr.app too.
 */
export async function fetchSharedList(): Promise<SharedPageEntry[]> {
  const metadata = await fetchAllDocMetadata();
  const entries: SharedPageEntry[] = [];
  for (const [address, meta] of metadata) {
    if (typeof meta.viewKey !== "string" || !meta.viewKey) continue;
    entries.push(
      typeof meta.editKey === "string" && meta.editKey
        ? [address, meta.viewKey, meta.editKey]
        : [address, meta.viewKey],
    );
  }

  for (const entry of await fetchLegacySharedList()) {
    const [address, viewKey, editKey] = entry;
    if (metadata.get(address)?.viewKey) continue;
    entries.push(entry);
    try {
      await saveDocMetadata(address, { viewKey, ...(editKey ? { editKey } : {}) });
    } catch {
      /* migration is best-effort; the entry is still returned */
    }
  }
  return entries;
}

/** Read the legacy super-app kind-11234 list (migration source only). */
async function fetchLegacySharedList(): Promise<SharedPageEntry[]> {
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

/** Record one shared doc's keys in its kind-34579 metadata (upstream addSharedDoc). */
export async function addSharedPage(entry: SharedPageEntry): Promise<void> {
  const [address, viewKey, editKey] = entry;
  await saveDocMetadata(address, { viewKey, ...(editKey ? { editKey } : {}) });
}

/** Fetch + decrypt every doc shared with the user as summaries. */
export async function fetchSharedPages(): Promise<PageSummary[]> {
  const signer = await signerManager.getSigner();
  const userPubkey = await signer.getPublicKey();
  const entries = await fetchSharedList();
  const out: PageSummary[] = [];
  for (const [address, viewKey, editKey] of entries) {
    const [, pubkey, dTag] = address.split(":");
    if (!pubkey || !dTag) continue;
    // The owner's own view-only shares keep the owner's address — they already
    // appear under "my pages" (upstream skips own-pubkey events the same way).
    if (pubkey === userPubkey) continue;
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

// ── Doc metadata (kind 34579) ───────────────────────────

function parseMetadataJson(json: string): DocMetadata | undefined {
  const parsed = JSON.parse(json) as unknown;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as DocMetadata;
  }
  return undefined;
}

/** Newest decrypted metadata per doc address, for all of the user's docs. */
export async function fetchAllDocMetadata(): Promise<Map<string, DocMetadata>> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const events = await nostrRuntime.querySync(RELAYS(), {
    kinds: [PAGES_KINDS.docMetadata],
    authors: [pubkey],
  } as Filter);

  const newest = new Map<string, Event>();
  for (const ev of events) {
    const addr = ev.tags.find((t) => t[0] === "d")?.[1] ?? "";
    const prev = newest.get(addr);
    if (!prev || ev.created_at > prev.created_at) newest.set(addr, ev);
  }

  const result = new Map<string, DocMetadata>();
  for (const [addr, ev] of newest) {
    try {
      const meta = parseMetadataJson(await nip44SelfDecrypt(signer, ev.content));
      if (meta) result.set(addr, meta);
    } catch {
      /* skip corrupt */
    }
  }
  return result;
}

/** Newest decrypted metadata for one doc address. */
export async function fetchDocMetadata(address: string): Promise<DocMetadata | undefined> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const events = await nostrRuntime.querySync(RELAYS(), {
    kinds: [PAGES_KINDS.docMetadata],
    authors: [pubkey],
    "#d": [address],
  } as Filter);
  if (events.length === 0) return undefined;
  const newest = events.reduce((a, b) => (b.created_at > a.created_at ? b : a));
  try {
    return parseMetadataJson(await nip44SelfDecrypt(signer, newest.content));
  } catch {
    return undefined;
  }
}

/**
 * Read-merge-write one doc's metadata. NEVER write a bare patch: upstream stores
 * `viewKey`/`editKey`/`sharedAs`/`title` in the same object, so a blind overwrite
 * destroys the keys that grant access to a shared doc.
 */
export async function saveDocMetadata(
  address: string,
  patch: Partial<DocMetadata>,
): Promise<DocMetadata> {
  const existing = (await fetchDocMetadata(address)) ?? {};
  const merged: DocMetadata = { ...existing, ...patch };
  // Upstream nostr-docs types `tags` as a required field and reads `meta.tags.length`
  // unguarded (DocMetadataContext): a metadata object with no `tags` key makes
  // pages.formstr.app throw and drop ALL doc titles/tags/sharedAs. Always emit one.
  if (!Array.isArray(merged.tags)) merged.tags = [];

  const signer = await signerManager.getSigner();
  const content = await nip44SelfEncrypt(signer, JSON.stringify(merged));
  const signed = await signer.signEvent({
    kind: PAGES_KINDS.docMetadata,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", address]],
    content,
  });
  await nostrRuntime.publish(RELAYS(), signed);
  return merged;
}

// ── Doc tags / titles (metadata views) ──────────────────

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
      const meta = parseMetadataJson(await nip44SelfDecrypt(signer, ev.content));
      if (meta && Array.isArray(meta.tags)) result.set(addr, meta.tags);
    } catch {
      /* skip corrupt */
    }
  }
  return result;
}

export async function setDocTags(address: string, tags: string[]): Promise<void> {
  await saveDocMetadata(address, { tags });
}

/** Set/clear a custom display title (rename) — blank clears it (upstream semantics). */
export async function setDocTitle(address: string, title: string): Promise<void> {
  await saveDocMetadata(address, { title: title || undefined });
}

/** Mark a doc as a backup of its shared (editKey-signed) copy. */
export async function setDocSharedAs(address: string, sharedAs: string): Promise<void> {
  await saveDocMetadata(address, { sharedAs });
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
