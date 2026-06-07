import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/app/services", () => ({
  pages: {
    fetchMyPages: vi.fn(),
    savePage: vi.fn(),
    fetchPage: vi.fn(),
    deletePage: vi.fn(),
    sharePage: vi.fn(),
    fetchSharedPages: vi.fn(),
    setDocTags: vi.fn(),
    fetchDocTags: vi.fn(),
  },
}));

import { pages } from "@formstr/app/services";

import { registerPages } from "../src/tools/pages";

function fakeServer() {
  const tools = new Map<string, { handler: (a: any) => Promise<any> }>();
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (a: any) => Promise<any>) =>
      tools.set(name, { handler }),
  } as any;
  return { server, tools };
}

describe("pages tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers read + constructive tools without write access", () => {
    const { server, tools } = fakeServer();
    registerPages(server, { allowWrites: false });
    for (const t of [
      "list_pages",
      "get_page",
      "list_shared_pages",
      "get_page_tags",
      "create_page",
      "save_private_note",
      "update_page",
      "set_page_tags",
    ]) {
      expect(tools.has(t)).toBe(true);
    }
    // Gated tools are hidden without --allow-writes.
    expect(tools.has("delete_page")).toBe(false);
    expect(tools.has("share_page")).toBe(false);
  });

  it("exposes gated tools when writes are allowed", () => {
    const { server, tools } = fakeServer();
    registerPages(server, { allowWrites: true });
    expect(tools.has("delete_page")).toBe(true);
    expect(tools.has("share_page")).toBe(true);
  });

  it("create_page folds the title into the markdown and returns the address", async () => {
    (pages.savePage as any).mockResolvedValue({ address: "33457:pk:abc" });
    const { server, tools } = fakeServer();
    registerPages(server, { allowWrites: false });
    const res = await tools.get("create_page")!.handler({ title: "Notes", content: "Hi" });
    expect(pages.savePage).toHaveBeenCalledWith({ content: "# Notes\n\nHi" });
    expect(res.structuredContent.address).toBe("33457:pk:abc");
  });

  it("get_page fetches by pubkey + docId (+ optional viewKey)", async () => {
    (pages.fetchPage as any).mockResolvedValue({
      address: "33457:pk:abc",
      title: "T",
      content: "# T",
    });
    const { server, tools } = fakeServer();
    registerPages(server, { allowWrites: false });
    await tools.get("get_page")!.handler({ pubkey: "pk", docId: "abc", viewKey: "vk" });
    expect(pages.fetchPage).toHaveBeenCalledWith("pk", "abc", "vk");
  });

  it("delete_page requires confirm", async () => {
    const { server, tools } = fakeServer();
    registerPages(server, { allowWrites: true });
    const blocked = await tools.get("delete_page")!.handler({ address: "33457:pk:abc" });
    expect(blocked.isError).toBe(true);
    expect(pages.deletePage).not.toHaveBeenCalled();
    await tools.get("delete_page")!.handler({ address: "33457:pk:abc", confirm: true });
    expect(pages.deletePage).toHaveBeenCalledWith("33457:pk:abc");
  });

  it("share_page returns the nkeys link (with confirm)", async () => {
    (pages.sharePage as any).mockResolvedValue({
      url: "http://x/pages/naddr1#nkeys1",
      viewKey: "vk",
    });
    const { server, tools } = fakeServer();
    registerPages(server, { allowWrites: true });
    const res = await tools
      .get("share_page")!
      .handler({ address: "33457:pk:abc", content: "# T", canEdit: false, confirm: true });
    expect(pages.sharePage).toHaveBeenCalledWith(
      expect.objectContaining({ address: "33457:pk:abc", content: "# T", canEdit: false }),
    );
    expect(res.structuredContent.url).toContain("#nkeys1");
  });
});
