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

vi.mock("@formstr/agent/services/pages/service", () => ({
  fetchMyPages: vi.fn(),
  fetchSharedPages: vi.fn(),
  fetchPage: vi.fn(),
  savePage: vi.fn(),
  deletePage: vi.fn(),
  sharePage: vi.fn(),
  addSharedPage: vi.fn(),
  fetchDocTags: vi.fn(),
  setDocTags: vi.fn(),
}));

import * as pagesService from "@formstr/agent/services/pages/service";

import { usePagesStore } from "./pagesStore";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  usePagesStore.setState({
    pages: [],
    sharedPages: [],
    currentPage: null,
    tagsByAddress: {},
    activeTag: null,
    error: null,
  });
  (pagesService.fetchMyPages as any).mockResolvedValue([]);
  (pagesService.fetchDocTags as any).mockResolvedValue(new Map());
});

describe("deletePage", () => {
  it("removes the page optimistically and forwards the address to the service", async () => {
    usePagesStore.setState({
      pages: [
        {
          id: "d1",
          address: "33457:p:d1",
          title: "A",
          pubkey: "p",
          createdAt: 0,
          isEncrypted: true,
        },
        {
          id: "d2",
          address: "33457:p:d2",
          title: "B",
          pubkey: "p",
          createdAt: 0,
          isEncrypted: true,
        },
      ],
    });
    await usePagesStore.getState().deletePage("33457:p:d1");
    expect(pagesService.deletePage).toHaveBeenCalledWith("33457:p:d1");
    expect(usePagesStore.getState().pages.map((p) => p.id)).toEqual(["d2"]);
  });
});

describe("savePage", () => {
  it("persists the viewKey of a shared save and refreshes the list", async () => {
    (pagesService.savePage as any).mockResolvedValue({
      id: "d1",
      address: "33457:p:d1",
      title: "T",
      content: "# T",
      pubkey: "p",
      createdAt: 1,
      isEncrypted: true,
      viewKey: "vk-hex",
    });
    (pagesService.fetchMyPages as any).mockResolvedValue([
      { id: "d1", address: "33457:p:d1", title: "T", pubkey: "p", createdAt: 1, isEncrypted: true },
    ]);
    await usePagesStore.getState().savePage({ content: "# T" });
    expect(localStorage.getItem("formstr:page-viewkey:33457:p:d1")).toBe("vk-hex");
    expect(usePagesStore.getState().pages).toHaveLength(1);
  });
});

describe("sharePage", () => {
  it("shares the current page and persists the returned keys", async () => {
    usePagesStore.setState({
      currentPage: {
        id: "d1",
        address: "33457:p:d1",
        title: "T",
        content: "# T\n\nbody",
        pubkey: "p",
        createdAt: 1,
        isEncrypted: true,
      },
    });
    (pagesService.sharePage as any).mockResolvedValue({
      url: "http://x/pages/naddr1#nkeys1",
      address: "33457:p:d1",
      viewKey: "vk",
      editKey: "ek",
    });
    const res = await usePagesStore.getState().sharePage(true);
    expect(pagesService.sharePage).toHaveBeenCalledWith(
      expect.objectContaining({ address: "33457:p:d1", content: "# T\n\nbody", canEdit: true }),
    );
    expect(res?.url).toContain("#nkeys1");
    expect(localStorage.getItem("formstr:page-viewkey:33457:p:d1")).toBe("vk");
  });

  it("returns null when no page is open", async () => {
    const res = await usePagesStore.getState().sharePage(false);
    expect(res).toBeNull();
    expect(pagesService.sharePage).not.toHaveBeenCalled();
  });
});

describe("setTags", () => {
  it("forwards to the service and updates tagsByAddress", async () => {
    (pagesService.setDocTags as any).mockResolvedValue(undefined);
    await usePagesStore.getState().setTags("33457:p:d1", ["work", "ideas"]);
    expect(pagesService.setDocTags).toHaveBeenCalledWith("33457:p:d1", ["work", "ideas"]);
    expect(usePagesStore.getState().tagsByAddress["33457:p:d1"]).toEqual(["work", "ideas"]);
  });
});
