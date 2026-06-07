import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services", () => ({
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

import { pages } from "../src/services";
import { pagesTools } from "../src/tools/pages";
import type { ToolCtx } from "../src/tools/types";

type FakeTools = Map<string, { handler: (a: any) => Promise<any> }>;

function fakeServer(): { server: { tools: FakeTools }; tools: FakeTools } {
  const tools: FakeTools = new Map();
  return { server: { tools }, tools };
}

// Replicates the stdio adapter's gating: skip `write` tools unless allowWrites,
// and inject the ctx so the existing single-arg handler call sites still work.
function registerPages(server: { tools: FakeTools }, ctx: ToolCtx) {
  for (const t of pagesTools) {
    if (t.write && !ctx.allowWrites) continue;
    server.tools.set(t.name, { handler: (a: any) => t.handler(a, ctx) });
  }
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
    expect(res.data.address).toBe("33457:pk:abc");
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
    expect(blocked.ok).toBe(false);
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
    expect(res.data.url).toContain("#nkeys1");
  });
});
