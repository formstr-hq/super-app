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
  deleted?: boolean;
  previewHash?: string;
}

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  files: FileMetadata[];
}

export const DEFAULT_BLOSSOM_SERVERS = [
  "https://blossom.primal.net",
  "https://nostr.download",
  "https://blossom.oxtr.dev",
];
