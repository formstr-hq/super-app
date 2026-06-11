// ── Event Kinds ─────────────────────────────────────────
export const DRIVE_KINDS = {
  fileMetadata: 34578,
} as const;

// ── Data Structures ─────────────────────────────────────

export interface FileMetadata {
  name: string;
  hash: string; // SHA-256 (Blossom blob ID)
  size: number;
  type: string; // MIME type
  folder: string; // virtual path e.g. "/work/docs"
  uploadedAt: number;
  server: string; // Blossom server URL
  encryptionKey: string; // hex key for file decryption
  /** Always "aes-gcm" on write (upstream formstr-drive contract). */
  encryptionAlgorithm?: string;
  deleted?: boolean;
  /** Blossom hash of the encrypted preview thumbnail (same per-file key). */
  previewHash?: string;
}

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  files: FileMetadata[];
}

// Upstream formstr-drive's DEFAULT_SERVERS, same order (the first entry is the
// default upload target).
export const DEFAULT_BLOSSOM_SERVERS = [
  "https://nostr.download",
  "https://blossom.primal.net",
  "https://blossom.oxtr.dev",
];

export interface BlossomServerInfo {
  url: string;
  source: "default" | "relay" | "custom";
}
