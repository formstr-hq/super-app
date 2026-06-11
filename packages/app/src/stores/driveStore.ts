import type { BlossomServerInfo, FileMetadata } from "@formstr/agent/services/drive";
import { DEFAULT_BLOSSOM_SERVERS } from "@formstr/agent/services/drive";
import * as driveService from "@formstr/agent/services/drive/service";
import { create } from "zustand";

import { generateImagePreview } from "../lib/imagePreview";

const LS_SERVER = "formstr:drive-server";
const LS_CUSTOM_SERVERS = "formstr:drive-custom-servers";
const LS_CUSTOM_FOLDERS = "formstr:drive-custom-folders";

function normalizeServerUrl(url: string): string {
  let normalized = url.trim();
  if (!normalized) return "";
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = "https://" + normalized;
  }
  return normalized.replace(/\/$/, "");
}

function readJsonArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

interface DriveStore {
  files: FileMetadata[];
  currentFolder: string;
  isLoading: boolean;
  isUploading: boolean;
  error: string | null;

  /** Decrypted thumbnail object-URLs by file hash; null = attempted, none available. */
  previewUrls: Record<string, string | null>;

  // Blossom servers
  servers: BlossomServerInfo[];
  selectedServer: string;
  customServers: string[];

  // Local-only (non-synced) empty folders, mirroring the standalone.
  customFolders: string[];

  fetchFiles(): Promise<void>;
  uploadFile(params: driveService.UploadFileParams): Promise<FileMetadata>;
  deleteFile(metadata: FileMetadata): Promise<void>;
  downloadFile(metadata: FileMetadata): Promise<Uint8Array>;
  /** Lazily fetch + decrypt the kind-34578 previewHash thumbnail (once per hash). */
  loadPreview(metadata: FileMetadata): Promise<void>;
  renameFile(metadata: FileMetadata, newName: string): Promise<void>;
  moveFile(metadata: FileMetadata, newFolder: string): Promise<void>;

  loadServers(): Promise<void>;
  setSelectedServer(url: string): void;
  addCustomServer(url: string): void;

  setCurrentFolder(folder: string): void;
  addCustomFolder(path: string): void;
  getFolders(): string[];
  getFilesInFolder(folder: string): FileMetadata[];
}

export const useDriveStore = create<DriveStore>((set, get) => ({
  files: [],
  currentFolder: "/",
  isLoading: false,
  isUploading: false,
  error: null,
  previewUrls: {},

  servers: DEFAULT_BLOSSOM_SERVERS.map((url) => ({ url, source: "default" as const })),
  selectedServer:
    (typeof localStorage !== "undefined" && localStorage.getItem(LS_SERVER)) ||
    DEFAULT_BLOSSOM_SERVERS[0],
  customServers: typeof localStorage !== "undefined" ? readJsonArray(LS_CUSTOM_SERVERS) : [],
  customFolders: typeof localStorage !== "undefined" ? readJsonArray(LS_CUSTOM_FOLDERS) : [],

  async fetchFiles() {
    set({ isLoading: true, error: null });
    try {
      const files = await driveService.fetchFileIndex();
      set({ files, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to fetch files", isLoading: false });
    }
  },

  async uploadFile(params) {
    set({ isUploading: true, error: null });
    try {
      // Preview thumbnails are best-effort (upstream formstr-drive renders them).
      const preview = params.preview ?? (await generateImagePreview(params.file)) ?? undefined;
      const metadata = await driveService.uploadFile({
        ...params,
        preview,
        blossomServer: params.blossomServer ?? get().selectedServer,
      });
      set((state) => ({ files: [...state.files, metadata], isUploading: false }));
      return metadata;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to upload file", isUploading: false });
      throw e;
    }
  },

  async deleteFile(metadata) {
    try {
      await driveService.deleteFile(metadata);
      set((state) => ({ files: state.files.filter((f) => f.hash !== metadata.hash) }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to delete file" });
    }
  },

  async downloadFile(metadata) {
    try {
      return await driveService.downloadFile(metadata);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to download file" });
      throw e;
    }
  },

  async loadPreview(metadata) {
    if (!metadata.previewHash || metadata.hash in get().previewUrls) return;
    // Mark before awaiting so concurrent rows don't double-fetch; a failure
    // keeps the null marker (no retry storm against a dead server).
    set((state) => ({ previewUrls: { ...state.previewUrls, [metadata.hash]: null } }));
    try {
      const bytes = await driveService.downloadPreview(metadata);
      if (!bytes) return;
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/webp" }));
      set((state) => ({ previewUrls: { ...state.previewUrls, [metadata.hash]: url } }));
    } catch {
      /* thumbnail is cosmetic — the null marker stands */
    }
  },

  async renameFile(metadata, newName) {
    try {
      await driveService.renameFile(metadata, newName);
      set((state) => ({
        files: state.files.map((f) => (f.hash === metadata.hash ? { ...f, name: newName } : f)),
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to rename file" });
    }
  },

  async moveFile(metadata, newFolder) {
    try {
      await driveService.moveFile(metadata, newFolder);
      set((state) => ({
        files: state.files.map((f) => (f.hash === metadata.hash ? { ...f, folder: newFolder } : f)),
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to move file" });
    }
  },

  async loadServers() {
    try {
      const servers = await driveService.fetchBlossomServers(get().customServers);
      set({ servers });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to load servers" });
    }
  },

  setSelectedServer(url) {
    const normalized = normalizeServerUrl(url);
    localStorage.setItem(LS_SERVER, normalized);
    set({ selectedServer: normalized });
  },

  addCustomServer(url) {
    const normalized = normalizeServerUrl(url);
    if (!normalized) return;
    set((state) => {
      const customServers = state.customServers.includes(normalized)
        ? state.customServers
        : [...state.customServers, normalized];
      localStorage.setItem(LS_CUSTOM_SERVERS, JSON.stringify(customServers));
      localStorage.setItem(LS_SERVER, normalized);
      const servers = state.servers.some((s) => s.url === normalized)
        ? state.servers
        : [...state.servers, { url: normalized, source: "custom" as const }];
      return { customServers, selectedServer: normalized, servers };
    });
  },

  setCurrentFolder(folder) {
    set({ currentFolder: folder });
  },

  addCustomFolder(path) {
    set((state) => {
      if (state.customFolders.includes(path)) return state;
      const customFolders = [...state.customFolders, path];
      localStorage.setItem(LS_CUSTOM_FOLDERS, JSON.stringify(customFolders));
      return { customFolders };
    });
  },

  getFolders() {
    const fromFiles = driveService.extractFolders(get().files);
    const merged = new Set([...fromFiles, ...get().customFolders]);
    return Array.from(merged).sort();
  },

  getFilesInFolder(folder) {
    return get().files.filter((f) => f.folder === folder);
  },
}));
