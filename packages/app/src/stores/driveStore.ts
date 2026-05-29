import { create } from "zustand";
import type { FileMetadata } from "../services/drive";
import * as driveService from "../services/drive/service";

interface DriveStore {
  files: FileMetadata[];
  currentFolder: string;
  isLoading: boolean;
  isUploading: boolean;
  error: string | null;

  fetchFiles(): Promise<void>;
  uploadFile(params: driveService.UploadFileParams): Promise<FileMetadata>;
  deleteFile(metadata: FileMetadata): Promise<void>;
  downloadFile(metadata: FileMetadata): Promise<Uint8Array>;
  setCurrentFolder(folder: string): void;
  getFolders(): string[];
  getFilesInFolder(folder: string): FileMetadata[];
}

export const useDriveStore = create<DriveStore>((set, get) => ({
  files: [],
  currentFolder: "/",
  isLoading: false,
  isUploading: false,
  error: null,

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
      const metadata = await driveService.uploadFile(params);
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

  setCurrentFolder(folder) {
    set({ currentFolder: folder });
  },

  getFolders() {
    return driveService.extractFolders(get().files);
  },

  getFilesInFolder(folder) {
    return get().files.filter((f) => f.folder === folder);
  },
}));
