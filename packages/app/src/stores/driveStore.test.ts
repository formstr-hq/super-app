import { describe, it, expect, vi, beforeEach } from "vitest";

// jsdom in this config doesn't expose a global localStorage; provide a shim.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

vi.mock("../services/drive/service", () => ({
  fetchFileIndex: vi.fn(() => Promise.resolve([])),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(() => Promise.resolve()),
  downloadFile: vi.fn(),
  renameFile: vi.fn(() => Promise.resolve()),
  moveFile: vi.fn(() => Promise.resolve()),
  extractFolders: vi.fn(() => ["/"]),
  fetchBlossomServers: vi.fn(() => Promise.resolve([])),
}));

import type { FileMetadata } from "../services/drive";
import * as driveService from "../services/drive/service";

import { useDriveStore } from "./driveStore";

function meta(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return {
    name: "a.txt",
    hash: "h1",
    size: 1,
    type: "text/plain",
    folder: "/",
    uploadedAt: 1,
    server: "https://srv",
    encryptionKey: "k",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useDriveStore.setState({
    files: [],
    currentFolder: "/",
    isLoading: false,
    isUploading: false,
    error: null,
    servers: [],
    selectedServer: "https://blossom.primal.net",
    customServers: [],
    customFolders: [],
  });
});

describe("driveStore — file management", () => {
  it("renameFile calls the service and updates the file in place", async () => {
    useDriveStore.setState({ files: [meta({ hash: "h1", name: "old" })] });
    await useDriveStore.getState().renameFile(meta({ hash: "h1", name: "old" }), "new");
    expect(driveService.renameFile).toHaveBeenCalled();
    expect(useDriveStore.getState().files[0].name).toBe("new");
  });

  it("moveFile calls the service and updates the file's folder in place", async () => {
    useDriveStore.setState({ files: [meta({ hash: "h1", folder: "/" })] });
    await useDriveStore.getState().moveFile(meta({ hash: "h1", folder: "/" }), "/docs");
    expect(driveService.moveFile).toHaveBeenCalled();
    expect(useDriveStore.getState().files[0].folder).toBe("/docs");
  });

  it("uploadFile defaults the blossom server to the selected server", async () => {
    (driveService.uploadFile as any).mockResolvedValue(meta());
    useDriveStore.setState({ selectedServer: "https://chosen" });
    const file = { name: "x", type: "t", size: 1 } as unknown as File;
    await useDriveStore.getState().uploadFile({ file, folder: "/" });
    expect(driveService.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ blossomServer: "https://chosen" }),
    );
  });
});

describe("driveStore — servers", () => {
  it("setSelectedServer persists the choice", () => {
    useDriveStore.getState().setSelectedServer("https://srv-2");
    expect(useDriveStore.getState().selectedServer).toBe("https://srv-2");
    expect(localStorage.getItem("formstr:drive-server")).toBe("https://srv-2");
  });

  it("addCustomServer records, selects, and persists the custom server", () => {
    useDriveStore.getState().addCustomServer("my.server/");
    const state = useDriveStore.getState();
    expect(state.customServers).toContain("https://my.server");
    expect(state.selectedServer).toBe("https://my.server");
    expect(JSON.parse(localStorage.getItem("formstr:drive-custom-servers")!)).toContain(
      "https://my.server",
    );
  });

  it("loadServers fetches with the stored custom servers and stores the result", async () => {
    (driveService.fetchBlossomServers as any).mockResolvedValue([
      { url: "https://blossom.primal.net", source: "default" },
    ]);
    useDriveStore.setState({ customServers: ["https://my.server"] });
    await useDriveStore.getState().loadServers();
    expect(driveService.fetchBlossomServers).toHaveBeenCalledWith(["https://my.server"]);
    expect(useDriveStore.getState().servers).toHaveLength(1);
  });
});

describe("driveStore — custom folders", () => {
  it("addCustomFolder adds a folder that getFolders surfaces", () => {
    (driveService.extractFolders as any).mockReturnValue(["/"]);
    useDriveStore.getState().addCustomFolder("/projects");
    expect(useDriveStore.getState().getFolders()).toContain("/projects");
    expect(JSON.parse(localStorage.getItem("formstr:drive-custom-folders")!)).toContain(
      "/projects",
    );
  });
});
