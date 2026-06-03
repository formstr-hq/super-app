import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/app/services", () => ({
  pages: {
    fetchMyPages: vi.fn(),
    savePage: vi.fn(),
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

  it("registers list_pages, create_page, save_private_note", () => {
    const { server, tools } = fakeServer();
    registerPages(server, { allowWrites: false });
    expect(tools.has("list_pages")).toBe(true);
    expect(tools.has("create_page")).toBe(true);
    expect(tools.has("save_private_note")).toBe(true);
  });

  it("create_page saves and returns the address", async () => {
    (pages.savePage as any).mockResolvedValue({ address: "33457:pk:abc" });
    const { server, tools } = fakeServer();
    registerPages(server, { allowWrites: false });
    const res = await tools.get("create_page")!.handler({ title: "Notes", content: "# Hi" });
    expect(pages.savePage).toHaveBeenCalledWith({ title: "Notes", content: "# Hi" });
    expect(res.structuredContent.address).toBe("33457:pk:abc");
  });
});
