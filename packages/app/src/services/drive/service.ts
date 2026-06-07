import {
  signerManager,
  nostrRuntime,
  relayManager,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
  BlossomClient,
  createBlossomAuthEvent,
  encryptFileWithKey,
  decryptFileWithKey,
} from "@formstr/core";
import type { EventTemplate, Filter, VerifiedEvent } from "nostr-tools";

import {
  DRIVE_KINDS,
  DEFAULT_BLOSSOM_SERVERS,
  type BlossomServerInfo,
  type FileMetadata,
} from "./types";

// ── Upload File ─────────────────────────────────────────

export interface UploadFileParams {
  file: File;
  folder?: string;
  blossomServer?: string;
}

export async function uploadFile(params: UploadFileParams): Promise<FileMetadata> {
  const signer = await signerManager.getSigner();
  const server = params.blossomServer ?? DEFAULT_BLOSSOM_SERVERS[0];

  // Read file
  const buffer = await params.file.arrayBuffer();
  const data = new Uint8Array(buffer);

  // Encrypt with a per-file nostr keypair (standalone formstr-drive parity).
  const { ciphertext, privateKeyHex } = await encryptFileWithKey(data);
  const encryptedBytes = new TextEncoder().encode(ciphertext);

  // Create Blossom auth event and upload the ciphertext blob.
  const authEvent = await createBlossomAuthEvent("upload", await sha256Hex(encryptedBytes), signer);
  const blossom = new BlossomClient(server);
  const result = await blossom.upload(encryptedBytes, authEvent, params.file.type);

  const metadata: FileMetadata = {
    name: params.file.name,
    hash: result.sha256,
    size: params.file.size,
    type: params.file.type,
    folder: params.folder ?? "/",
    uploadedAt: Date.now(),
    server,
    encryptionKey: privateKeyHex,
  };

  await saveFileMetadata(metadata);
  return metadata;
}

// ── Download File ───────────────────────────────────────

export async function downloadFile(metadata: FileMetadata): Promise<Uint8Array> {
  const blossom = new BlossomClient(metadata.server);

  // Optional auth for private blobs.
  let authEvent: VerifiedEvent | undefined;
  try {
    const signer = await signerManager.getSigner();
    authEvent = await createBlossomAuthEvent("get", metadata.hash, signer);
  } catch {
    // Continue without auth — public blobs don't require it.
  }

  const encryptedBytes = await blossom.download(metadata.hash, authEvent);
  const ciphertext = new TextDecoder().decode(encryptedBytes);
  return decryptFileWithKey(ciphertext, metadata.encryptionKey);
}

// ── File Index ──────────────────────────────────────────

export async function fetchFileIndex(): Promise<FileMetadata[]> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const relays = relayManager.getRelaysForModule("drive");

  const filter: Filter = {
    kinds: [DRIVE_KINDS.fileMetadata],
    authors: [pubkey],
  };

  const events = await nostrRuntime.querySync(relays, filter);

  // Keep only the latest event per file hash (d tag). Relays in the set can
  // each hold a different version of an addressable event, so a stale
  // non-deleted event must never win over a newer deletion/rename.
  const latestByHash = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    const hash = event.tags.find((t) => t[0] === "d")?.[1];
    if (!hash) continue;
    const current = latestByHash.get(hash);
    if (!current || event.created_at > current.created_at) {
      latestByHash.set(hash, event);
    }
  }

  const files: FileMetadata[] = [];
  for (const event of latestByHash.values()) {
    try {
      const decrypted = await nip44SelfDecrypt(signer, event.content);
      const metadata = JSON.parse(decrypted) as FileMetadata;
      if (!metadata.deleted) files.push(metadata);
    } catch {
      // Skip events we can't decrypt (wrong key / incompatible format).
    }
  }

  return files;
}

export async function saveFileMetadata(metadata: FileMetadata): Promise<void> {
  const signer = await signerManager.getSigner();
  const encrypted = await nip44SelfEncrypt(signer, JSON.stringify(metadata));

  const event: EventTemplate = {
    kind: DRIVE_KINDS.fileMetadata,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["d", metadata.hash],
      ["client", "formstr-drive"],
      ["encrypted", "nip44"],
    ],
    content: encrypted,
  };

  const signed = await signer.signEvent(event);
  const relays = relayManager.getRelaysForModule("drive");
  await nostrRuntime.publish(relays, signed);
}

export async function updateFileMetadata(
  hash: string,
  updates: Partial<Pick<FileMetadata, "name" | "folder">>,
): Promise<void> {
  const files = await fetchFileIndex();
  const existing = files.find((f) => f.hash === hash);
  if (!existing) throw new Error("File not found");
  await saveFileMetadata({ ...existing, ...updates });
}

export async function renameFile(metadata: FileMetadata, newName: string): Promise<void> {
  await saveFileMetadata({ ...metadata, name: newName });
}

export async function moveFile(metadata: FileMetadata, newFolder: string): Promise<void> {
  await saveFileMetadata({ ...metadata, folder: newFolder });
}

export async function deleteFile(metadata: FileMetadata): Promise<void> {
  // Soft delete — republish the addressable event with the deleted flag.
  await saveFileMetadata({ ...metadata, deleted: true });
}

// ── Blossom server discovery ────────────────────────────

export async function fetchBlossomServers(
  customServers: string[] = [],
): Promise<BlossomServerInfo[]> {
  const seen = new Set<string>();
  const out: BlossomServerInfo[] = [];

  const add = (rawUrl: string, source: BlossomServerInfo["source"]) => {
    const url = normalizeServerUrl(rawUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, source });
  };

  for (const url of DEFAULT_BLOSSOM_SERVERS) add(url, "default");
  for (const url of customServers) add(url, "custom");

  try {
    const relays = relayManager.getRelaysForModule("drive");
    const events = await nostrRuntime.querySync(relays, { kinds: [36363], limit: 50 });
    for (const event of events) {
      const url = event.tags.find((t) => t[0] === "d")?.[1];
      if (url) add(url, "relay");
    }
  } catch {
    // Discovery is best-effort; defaults + custom still returned.
  }

  return out;
}

// ── Folder Helpers ──────────────────────────────────────

export function extractFolders(files: FileMetadata[]): string[] {
  const folders = new Set<string>(["/"]);
  for (const file of files) {
    const parts = file.folder.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += "/" + part;
      folders.add(current);
    }
  }
  return Array.from(folders).sort();
}

// ── Helpers ─────────────────────────────────────────────

function normalizeServerUrl(url: string): string {
  let normalized = url.trim();
  if (!normalized) return "";
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = "https://" + normalized;
  }
  return normalized.replace(/\/$/, "");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
