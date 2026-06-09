import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services", () => ({
  drive: {
    fetchFileIndex: vi.fn(),
    extractFolders: vi.fn(() => ["/work"]),
    deleteFile: vi.fn(() => Promise.resolve()),
    renameFile: vi.fn(() => Promise.resolve()),
    moveFile: vi.fn(() => Promise.resolve()),
  },
}));

import { drive } from "../src/services";
import { driveTools } from "../src/tools/drive";
import type { ToolCtx } from "../src/tools/types";

type FakeTools = Map<string, { handler: (a: any) => Promise<any> }>;

function fakeServer(): { server: { tools: FakeTools }; tools: FakeTools } {
  const tools: FakeTools = new Map();
  return { server: { tools }, tools };
}

// Replicates the stdio adapter's gating: skip `write` tools unless allowWrites,
// and inject the ctx so the existing single-arg handler call sites still work.
function registerDrive(server: { tools: FakeTools }, ctx: ToolCtx) {
  for (const t of driveTools) {
    if (t.write && !ctx.allowWrites) continue;
    server.tools.set(t.name, { handler: (a: any) => t.handler(a, ctx) });
  }
}

const FILE = {
  name: "a.txt",
  size: 10,
  type: "text/plain",
  folder: "/work",
  hash: "h",
  server: "s",
  encryptionKey: "SECRET",
  uploadedAt: 0,
};

describe("drive tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("browse_files never exposes secrets and skips deleted files", async () => {
    (drive.fetchFileIndex as any).mockResolvedValue([
      FILE,
      { ...FILE, name: "gone.txt", hash: "h2", deleted: true },
    ]);
    const { server, tools } = fakeServer();
    registerDrive(server, { allowWrites: false });
    const res = await tools.get("browse_files")!.handler({});
    const json = JSON.stringify(res);
    expect(json).not.toMatch(/SECRET/);
    expect(json).not.toMatch(/encryptionKey/);
    expect(res.data.files).toEqual([
      { name: "a.txt", size: 10, type: "text/plain", folder: "/work" },
    ]);
  });

  it("get_file_info returns safe metadata and never exposes the key/hash/server", async () => {
    (drive.fetchFileIndex as any).mockResolvedValue([FILE]);
    const { server, tools } = fakeServer();
    registerDrive(server, { allowWrites: false });
    const res = await tools.get("get_file_info")!.handler({ name: "a.txt" });
    const json = JSON.stringify(res);
    expect(json).not.toMatch(/SECRET/);
    expect(json).not.toMatch(/encryptionKey/);
    expect(res.data.file).toEqual({
      name: "a.txt",
      size: 10,
      type: "text/plain",
      folder: "/work",
      uploadedAt: 0,
    });
  });

  it("does not register write tools when allowWrites is false", () => {
    const { server, tools } = fakeServer();
    registerDrive(server, { allowWrites: false });
    expect(tools.has("delete_file")).toBe(false);
    expect(tools.has("rename_file")).toBe(false);
    expect(tools.has("move_file")).toBe(false);
  });

  it("delete_file is gated: blocked without confirm, deletes with confirm", async () => {
    (drive.fetchFileIndex as any).mockResolvedValue([FILE]);
    const { server, tools } = fakeServer();
    registerDrive(server, { allowWrites: true });

    const blocked = await tools.get("delete_file")!.handler({ name: "a.txt" });
    expect(blocked.ok).toBe(false);
    expect(drive.deleteFile).not.toHaveBeenCalled();

    await tools.get("delete_file")!.handler({ name: "a.txt", confirm: true });
    expect(drive.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ hash: "h" }));
  });

  it("rename_file renames the resolved file when confirmed", async () => {
    (drive.fetchFileIndex as any).mockResolvedValue([FILE]);
    const { server, tools } = fakeServer();
    registerDrive(server, { allowWrites: true });
    await tools.get("rename_file")!.handler({ name: "a.txt", newName: "b.txt", confirm: true });
    expect(drive.renameFile).toHaveBeenCalledWith(expect.objectContaining({ hash: "h" }), "b.txt");
  });

  it("move_file moves the resolved file when confirmed", async () => {
    (drive.fetchFileIndex as any).mockResolvedValue([FILE]);
    const { server, tools } = fakeServer();
    registerDrive(server, { allowWrites: true });
    await tools.get("move_file")!.handler({ name: "a.txt", newFolder: "/done", confirm: true });
    expect(drive.moveFile).toHaveBeenCalledWith(expect.objectContaining({ hash: "h" }), "/done");
  });

  it("fails clearly when the named file is not found", async () => {
    (drive.fetchFileIndex as any).mockResolvedValue([]);
    const { server, tools } = fakeServer();
    registerDrive(server, { allowWrites: true });
    const res = await tools.get("delete_file")!.handler({ name: "missing.txt", confirm: true });
    expect(res.ok).toBe(false);
    expect(drive.deleteFile).not.toHaveBeenCalled();
  });

  it("fails when a name is ambiguous across folders (asks to disambiguate)", async () => {
    (drive.fetchFileIndex as any).mockResolvedValue([
      FILE,
      { ...FILE, folder: "/other", hash: "h3" },
    ]);
    const { server, tools } = fakeServer();
    registerDrive(server, { allowWrites: true });
    const res = await tools.get("delete_file")!.handler({ name: "a.txt", confirm: true });
    expect(res.ok).toBe(false);
    expect(drive.deleteFile).not.toHaveBeenCalled();
  });
});
