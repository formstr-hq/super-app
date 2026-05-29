import {
  signerManager,
  nostrRuntime,
  relayManager,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
  BlossomClient,
  createBlossomAuthEvent,
  generateFileKey,
  aesGcmEncrypt,
  aesGcmDecrypt,
} from "@formstr/core";
import type { EventTemplate, Filter } from "nostr-tools";

import { DRIVE_KINDS, DEFAULT_BLOSSOM_SERVERS, type FileMetadata } from "./types";

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

  // Encrypt with per-file key
  const fileKey = await generateFileKey();
  const encrypted = await aesGcmEncrypt(data, fileKey);
  const encryptedBytes = new TextEncoder().encode(JSON.stringify(encrypted));

  // Hash encrypted payload
  const hashBuffer = await crypto.subtle.digest("SHA-256", encryptedBytes);
  const hashArray = new Uint8Array(hashBuffer);
  const sha256 = bytesToHex(hashArray);

  // Create Blossom auth event and upload
  const authEvent = await createBlossomAuthEvent("upload", sha256, signer);
  const blossom = new BlossomClient(server);
  const result = await blossom.upload(encryptedBytes, authEvent, params.file.type);

  // Build metadata
  const metadata: FileMetadata = {
    name: params.file.name,
    hash: result.sha256 ?? sha256,
    size: params.file.size,
    type: params.file.type,
    folder: params.folder ?? "/",
    uploadedAt: Date.now(),
    server,
    encryptionKey: fileKey,
  };

  // Publish metadata event (NIP-44 self-encrypted)
  await saveFileMetadata(metadata);

  return metadata;
}

// ── Download File ───────────────────────────────────────

export async function downloadFile(metadata: FileMetadata): Promise<Uint8Array> {
  const blossom = new BlossomClient(metadata.server);

  // Optional auth for private blobs
  let authEvent;
  try {
    const signer = await signerManager.getSigner();
    authEvent = await createBlossomAuthEvent("get", metadata.hash, signer);
  } catch {
    // Continue without auth
  }

  const encryptedBytes = await blossom.download(metadata.hash, authEvent);
  const encryptedJson = new TextDecoder().decode(encryptedBytes);
  const encrypted = JSON.parse(encryptedJson);

  return aesGcmDecrypt(encrypted, metadata.encryptionKey);
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
  const files: FileMetadata[] = [];

  for (const event of events) {
    try {
      const decrypted = await nip44SelfDecrypt(signer, event.content);
      const metadata = JSON.parse(decrypted) as FileMetadata;
      if (!metadata.deleted) {
        files.push(metadata);
      }
    } catch {
      // Skip corrupted entries
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

export async function deleteFile(metadata: FileMetadata): Promise<void> {
  // Soft delete — update metadata with deleted flag
  const updated = { ...metadata, deleted: true };
  await saveFileMetadata(updated);
}

// ── Folder Helpers ──────────────────────────────────────

export function extractFolders(files: FileMetadata[]): string[] {
  const folders = new Set<string>();
  for (const file of files) {
    if (file.folder && file.folder !== "/") {
      folders.add(file.folder);
      // Add parent folders
      const parts = file.folder.split("/").filter(Boolean);
      for (let i = 1; i < parts.length; i++) {
        folders.add("/" + parts.slice(0, i).join("/"));
      }
    }
  }
  return ["/", ...Array.from(folders).sort()];
}

// ── Helpers ─────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
