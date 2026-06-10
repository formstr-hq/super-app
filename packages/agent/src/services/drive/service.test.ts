import {
  signerManager,
  nostrRuntime,
  relayManager,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
  BlossomClient,
  encryptFileWithKey,
  decryptFileWithKey,
} from "@formstr/core";
import type { Event } from "nostr-tools";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { publish: vi.fn(), querySync: vi.fn(), fetchOne: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.module"]) },
  // passthrough self-encryption so metadata JSON flows through events unchanged
  nip44SelfEncrypt: vi.fn((_s: unknown, plaintext: string) => Promise.resolve(plaintext)),
  nip44SelfDecrypt: vi.fn((_s: unknown, ciphertext: string) => Promise.resolve(ciphertext)),
  BlossomClient: vi.fn(),
  createBlossomAuthEvent: vi.fn(() => Promise.resolve({ kind: 24242 })),
  encryptFileWithKey: vi.fn(() =>
    Promise.resolve({ ciphertext: "CIPHERTEXT", privateKeyHex: "deadbeef" }),
  ),
  encryptFileWithExistingKey: vi.fn(() => Promise.resolve("PREVIEW-CIPHERTEXT")),
  decryptFileWithKey: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
}));

import {
  fetchFileIndex,
  uploadFile,
  downloadFile,
  updateFileMetadata,
  renameFile,
  moveFile,
  deleteFile,
  extractFolders,
  fetchBlossomServers,
} from "./service";
import type { FileMetadata } from "./types";

const AUTHOR = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const mockSigner = {
  getPublicKey: vi.fn().mockResolvedValue(AUTHOR),
  signEvent: vi
    .fn()
    .mockImplementation((e: Event) =>
      Promise.resolve({ ...e, id: "sid", sig: "sig", pubkey: AUTHOR }),
    ),
};

function meta(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return {
    name: "file.txt",
    hash: "h1",
    size: 10,
    type: "text/plain",
    folder: "/",
    uploadedAt: 1000,
    server: "https://blossom.example",
    encryptionKey: "key1",
    ...overrides,
  };
}

/** A kind-34578 event whose content is the (passthrough-"encrypted") metadata JSON. */
function metaEvent(m: FileMetadata, created_at: number): Event {
  return {
    id: `ev-${m.hash}-${created_at}`,
    pubkey: AUTHOR,
    created_at,
    kind: 34578,
    tags: [["d", m.hash]],
    content: JSON.stringify(m),
    sig: "",
  } as Event;
}

beforeEach(() => {
  vi.clearAllMocks();
  (signerManager.getSigner as any).mockResolvedValue(mockSigner);
  (nostrRuntime.publish as any).mockResolvedValue(undefined);
  (nostrRuntime.querySync as any).mockResolvedValue([]);
  (relayManager.getRelaysForModule as any).mockReturnValue(["wss://relay.module"]);
  (nip44SelfEncrypt as any).mockImplementation((_s: unknown, p: string) => Promise.resolve(p));
  (nip44SelfDecrypt as any).mockImplementation((_s: unknown, c: string) => Promise.resolve(c));
});

describe("fetchFileIndex — latest-per-d dedup + delete-that-sticks", () => {
  it("keeps only the latest event per file hash (by created_at)", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      metaEvent(meta({ hash: "h1", name: "old.txt" }), 1000),
      metaEvent(meta({ hash: "h1", name: "new.txt" }), 2000),
    ]);
    const files = await fetchFileIndex();
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("new.txt");
  });

  it("drops files whose latest event is soft-deleted", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      metaEvent(meta({ hash: "h1" }), 1000),
      metaEvent(meta({ hash: "h1", deleted: true }), 2000),
    ]);
    expect(await fetchFileIndex()).toHaveLength(0);
  });

  it("a stale non-deleted event cannot resurrect a deleted file", async () => {
    // newest event marks it deleted; an older, lingering non-deleted event must not win
    (nostrRuntime.querySync as any).mockResolvedValue([
      metaEvent(meta({ hash: "h1", deleted: true }), 3000),
      metaEvent(meta({ hash: "h1" }), 1000),
    ]);
    expect(await fetchFileIndex()).toHaveLength(0);
  });
});

describe("uploadFile", () => {
  it("encrypts with a per-file key, stores the secret key, and uploads to the chosen server", async () => {
    const uploadMock = vi.fn().mockResolvedValue({ sha256: "serverhash", url: "u", size: 3 });
    (BlossomClient as any).mockImplementation(() => ({ upload: uploadMock }));

    const bytes = new Uint8Array([1, 2, 3]);
    const file = {
      name: "doc.pdf",
      type: "application/pdf",
      size: bytes.byteLength,
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    } as unknown as File;
    const result = await uploadFile({ file, folder: "/work", blossomServer: "https://srv" });

    expect(encryptFileWithKey).toHaveBeenCalled();
    expect(BlossomClient).toHaveBeenCalledWith("https://srv");
    expect(result.encryptionKey).toBe("deadbeef");
    expect(result.hash).toBe("serverhash");
    expect(result.folder).toBe("/work");
    // metadata published as kind-34578 keyed by the blob hash
    const [, event] = (nostrRuntime.publish as any).mock.calls[0];
    expect(event.kind).toBe(34578);
    expect(event.tags).toContainEqual(["d", "serverhash"]);
    // upstream contract: the algorithm field is always written
    expect(JSON.parse(event.content).encryptionAlgorithm).toBe("aes-gcm");
  });

  it("encrypts a preview with the SAME per-file key and records previewHash", async () => {
    const uploadMock = vi
      .fn()
      .mockResolvedValueOnce({ sha256: "filehash", url: "u", size: 3 })
      .mockResolvedValueOnce({ sha256: "previewhash", url: "u", size: 1 });
    (BlossomClient as any).mockImplementation(() => ({ upload: uploadMock }));

    const bytes = new Uint8Array([1, 2, 3]);
    const file = {
      name: "pic.png",
      type: "image/png",
      size: bytes.byteLength,
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    } as unknown as File;
    const preview = new Uint8Array([9, 9]);
    const result = await uploadFile({ file, blossomServer: "https://srv", preview });

    const { encryptFileWithExistingKey } = await import("@formstr/core");
    expect(encryptFileWithExistingKey).toHaveBeenCalledWith(preview, "deadbeef");
    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(result.previewHash).toBe("previewhash");
    const [, event] = (nostrRuntime.publish as any).mock.calls[0];
    expect(JSON.parse(event.content).previewHash).toBe("previewhash");
  });

  it("a failed preview upload does not fail the file upload", async () => {
    const uploadMock = vi
      .fn()
      .mockResolvedValueOnce({ sha256: "filehash", url: "u", size: 3 })
      .mockRejectedValueOnce(new Error("preview server down"));
    (BlossomClient as any).mockImplementation(() => ({ upload: uploadMock }));

    const bytes = new Uint8Array([1]);
    const file = {
      name: "pic.png",
      type: "image/png",
      size: 1,
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    } as unknown as File;
    const result = await uploadFile({
      file,
      blossomServer: "https://srv",
      preview: new Uint8Array([9]),
    });
    expect(result.hash).toBe("filehash");
    expect(result.previewHash).toBeUndefined();
  });
});

describe("saveFileMetadata — algorithm backfill", () => {
  it("renameFile preserves previewHash and backfills encryptionAlgorithm on legacy entries", async () => {
    const { renameFile: rename } = await import("./service");
    await rename(meta({ hash: "h1", previewHash: "ph" }), "new-name.txt");
    const [, event] = (nostrRuntime.publish as any).mock.calls[0];
    const written = JSON.parse(event.content);
    expect(written.name).toBe("new-name.txt");
    expect(written.previewHash).toBe("ph");
    expect(written.encryptionAlgorithm).toBe("aes-gcm");
  });
});

describe("downloadFile", () => {
  it("downloads the blob and decrypts it with the stored secret key", async () => {
    const downloadMock = vi.fn().mockResolvedValue(new TextEncoder().encode("CIPHERTEXT"));
    (BlossomClient as any).mockImplementation(() => ({ download: downloadMock }));

    const out = await downloadFile(meta({ hash: "h9", encryptionKey: "sk9" }));
    expect(downloadMock).toHaveBeenCalledWith("h9", expect.anything());
    expect(decryptFileWithKey).toHaveBeenCalledWith("CIPHERTEXT", "sk9");
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });
});

describe("updateFileMetadata / renameFile / moveFile", () => {
  it("republishes a kind-34578 with the SAME d tag and merged content", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      metaEvent(meta({ hash: "h1", name: "a.txt", folder: "/" }), 1000),
    ]);
    await updateFileMetadata("h1", { name: "b.txt", folder: "/docs" });

    const [, event] = (nostrRuntime.publish as any).mock.calls[0];
    expect(event.tags).toContainEqual(["d", "h1"]);
    const published = JSON.parse(event.content) as FileMetadata;
    expect(published.name).toBe("b.txt");
    expect(published.folder).toBe("/docs");
    expect(published.encryptionKey).toBe("key1"); // preserved
  });

  it("renameFile only changes the name", async () => {
    await renameFile(meta({ hash: "h2", name: "old", folder: "/x" }), "new");
    const [, event] = (nostrRuntime.publish as any).mock.calls[0];
    const published = JSON.parse(event.content) as FileMetadata;
    expect(published.name).toBe("new");
    expect(published.folder).toBe("/x");
  });

  it("moveFile only changes the folder", async () => {
    await moveFile(meta({ hash: "h3", name: "keep", folder: "/a" }), "/b");
    const [, event] = (nostrRuntime.publish as any).mock.calls[0];
    const published = JSON.parse(event.content) as FileMetadata;
    expect(published.folder).toBe("/b");
    expect(published.name).toBe("keep");
  });
});

describe("deleteFile", () => {
  it("soft-deletes by republishing with deleted:true and the same d tag", async () => {
    await deleteFile(meta({ hash: "h5" }));
    const [, event] = (nostrRuntime.publish as any).mock.calls[0];
    expect(event.tags).toContainEqual(["d", "h5"]);
    expect(JSON.parse(event.content).deleted).toBe(true);
  });
});

describe("extractFolders", () => {
  it("includes root and every ancestor path, sorted", () => {
    const folders = extractFolders([
      meta({ hash: "a", folder: "/work/docs" }),
      meta({ hash: "b", folder: "/photos" }),
    ]);
    expect(folders).toEqual(["/", "/photos", "/work", "/work/docs"]);
  });
});

describe("fetchBlossomServers", () => {
  it("merges defaults ∪ relay(36363) ∪ custom and normalizes URLs", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        kind: 36363,
        tags: [["d", "blossom.from-relay.com/"]],
        pubkey: "x",
        created_at: 1,
        content: "",
        id: "1",
        sig: "",
      },
      // duplicate of a default → should not appear twice
      {
        kind: 36363,
        tags: [["d", "https://blossom.primal.net"]],
        pubkey: "x",
        created_at: 1,
        content: "",
        id: "2",
        sig: "",
      },
    ]);

    const servers = await fetchBlossomServers(["my.custom.server/"]);
    const byUrl = new Map(servers.map((s) => [s.url, s.source]));

    expect(byUrl.get("https://blossom.primal.net")).toBe("default");
    expect(byUrl.get("https://my.custom.server")).toBe("custom");
    expect(byUrl.get("https://blossom.from-relay.com")).toBe("relay");
    // no duplicates
    expect(servers.length).toBe(new Set(servers.map((s) => s.url)).size);
    // queried kind 36363 from drive relays
    expect(nostrRuntime.querySync).toHaveBeenCalledWith(
      ["wss://relay.module"],
      expect.objectContaining({ kinds: [36363] }),
    );
  });
});
