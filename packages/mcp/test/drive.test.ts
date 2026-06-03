import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/app/services", () => ({
  drive: {
    fetchFileIndex: vi.fn(),
    extractFolders: vi.fn(() => ["/work"]),
  },
}));

import { drive } from "@formstr/app/services";

import { registerDrive } from "../src/tools/drive";

function fakeServer() {
  const tools = new Map<string, { handler: (a: any) => Promise<any> }>();
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (a: any) => Promise<any>) =>
      tools.set(name, { handler }),
  } as any;
  return { server, tools };
}

describe("drive tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("browse_files never exposes secrets and skips deleted files", async () => {
    (drive.fetchFileIndex as any).mockResolvedValue([
      {
        name: "a.txt",
        size: 10,
        type: "text/plain",
        folder: "/work",
        hash: "h",
        server: "s",
        encryptionKey: "SECRET",
        uploadedAt: 0,
      },
      {
        name: "gone.txt",
        size: 1,
        type: "text/plain",
        folder: "/work",
        hash: "h2",
        server: "s",
        encryptionKey: "x",
        uploadedAt: 0,
        deleted: true,
      },
    ]);
    const { server, tools } = fakeServer();
    registerDrive(server, { allowWrites: false });
    const res = await tools.get("browse_files")!.handler({});
    const json = JSON.stringify(res);
    expect(json).not.toMatch(/SECRET/);
    expect(json).not.toMatch(/encryptionKey/);
    expect(res.structuredContent.files).toEqual([
      { name: "a.txt", size: 10, type: "text/plain", folder: "/work" },
    ]);
  });
});
