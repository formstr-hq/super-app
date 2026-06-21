import { signerManager, nostrRuntime, nip44SelfEncrypt, nip44SelfDecrypt } from "@formstr/core";
import type { Event } from "nostr-tools";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { publish: vi.fn(), fetchOne: vi.fn(), querySync: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.test"]) },
  nip44SelfEncrypt: vi.fn(),
  nip44SelfDecrypt: vi.fn(),
  // Real-ish nkeys: encode "viewKey:editKey?" so tests can assert round-trips.
  encodeNKeys: vi.fn((obj: Record<string, string>) => `nkeys1${Object.values(obj).join(".")}`),
  decodeNKeys: vi.fn((s: string) => {
    const [vk, ek] = s.replace(/^nkeys1/, "").split(".");
    return ek ? { viewKey: vk, editKey: ek } : { viewKey: vk };
  }),
  LocalSigner: class {
    nip44Encrypt = vi.fn();
    nip44Decrypt = vi.fn();
    getPublicKey = vi.fn();
  },
}));

import {
  savePage,
  fetchMyPages,
  fetchPage,
  deletePage,
  sharePage,
  fetchSharedList,
  addSharedPage,
  fetchDocTags,
  setDocTags,
  setDocTitle,
  saveDocMetadata,
  fetchAllDocMetadata,
} from "./service";
import { PAGES_KINDS } from "./types";
import { pubkeyFromHex } from "./viewKey";

const OWNER = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const mockSigner = {
  getPublicKey: vi.fn().mockResolvedValue(OWNER),
  signEvent: vi
    .fn()
    .mockImplementation((e: any) =>
      Promise.resolve({ ...e, id: "eid", sig: "sig", pubkey: OWNER }),
    ),
};

beforeEach(() => {
  vi.clearAllMocks();
  (signerManager.getSigner as any).mockResolvedValue(mockSigner);
  (nostrRuntime.publish as any).mockResolvedValue(undefined);
  (nostrRuntime.querySync as any).mockResolvedValue([]);
  (nostrRuntime.fetchOne as any).mockResolvedValue(null);
  // Owner self-encryption passes the user's signer; viewKey encryption (via
  // encryptWithViewKey → a LocalSigner) passes a different signer. Discriminate
  // so tests can assert which path produced the ciphertext.
  (nip44SelfEncrypt as any).mockImplementation((signer: unknown) =>
    Promise.resolve(signer === mockSigner ? "owner-enc" : "vk-enc"),
  );
  (nip44SelfDecrypt as any).mockResolvedValue("# Hello\n\nbody");
});

describe("savePage — wire format", () => {
  it("publishes kind-33457 with ONLY a d tag (no plaintext title) and owner-encrypted content", async () => {
    await savePage({ content: "# My Doc\n\ntext", existingId: "doc123" });
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.kind).toBe(PAGES_KINDS.document);
    expect(e.tags).toEqual([["d", "doc123"]]);
    expect(e.tags.find((t: string[]) => t[0] === "title")).toBeUndefined();
    expect(e.content).toBe("owner-enc");
    expect(e.pubkey).toBe(OWNER);
  });

  it("derives the title from the first markdown line", async () => {
    const page = await savePage({ content: "# Roadmap\n\nstuff", existingId: "d1" });
    expect(page.title).toBe("Roadmap");
  });

  it("signs with the editKey (event pubkey = editKey pubkey) when one is supplied", async () => {
    const editKey = "11".repeat(32);
    await savePage({ content: "x", existingId: "d2", viewKey: "22".repeat(32), editKey });
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.pubkey).toBe(pubkeyFromHex(editKey));
    // editKey present ⇒ content encrypted under the viewKey, not the owner key
    expect(e.content).toBe("vk-enc");
  });
});

describe("fetchMyPages", () => {
  const doc = (dTag: string, createdAt = 100): Event => ({
    id: `hex-${dTag}`,
    pubkey: OWNER,
    kind: PAGES_KINDS.document,
    created_at: createdAt,
    sig: "s",
    content: "ct",
    tags: [["d", dTag]],
  });

  it("self-decrypts each doc to recover its title and marks it encrypted", async () => {
    (nostrRuntime.querySync as any).mockImplementation((_r: unknown, f: any) =>
      Promise.resolve(f.kinds?.includes(5) ? [] : [doc("a1")]),
    );
    (nip44SelfDecrypt as any).mockResolvedValue("# Meeting notes\n\n- one");
    const pages = await fetchMyPages();
    expect(pages).toHaveLength(1);
    expect(pages[0].title).toBe("Meeting notes");
    expect(pages[0].isEncrypted).toBe(true);
  });

  it("drops a doc the author deleted via NIP-09 (survives refresh)", async () => {
    (nostrRuntime.querySync as any).mockImplementation((_r: unknown, f: any) =>
      Promise.resolve(
        f.kinds?.includes(5)
          ? [
              {
                id: "del",
                pubkey: OWNER,
                kind: 5,
                created_at: 200,
                sig: "s",
                content: "",
                tags: [["a", `${PAGES_KINDS.document}:${OWNER}:gone`]],
              },
            ]
          : [doc("gone"), doc("kept")],
      ),
    );
    const pages = await fetchMyPages();
    expect(pages.map((p) => p.id)).toEqual(["kept"]);
  });
});

describe("fetchPage", () => {
  it("decrypts a shared doc with the supplied viewKey", async () => {
    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "h",
      pubkey: OWNER,
      kind: PAGES_KINDS.document,
      created_at: 1,
      sig: "s",
      content: "ct",
      tags: [["d", "d9"]],
    });
    (nip44SelfDecrypt as any).mockResolvedValue("# Shared\n\nhi");
    const page = await fetchPage(OWNER, "d9", "33".repeat(32));
    expect(page?.title).toBe("Shared");
    expect(page?.content).toBe("# Shared\n\nhi");
  });
});

describe("deletePage", () => {
  it("publishes a NIP-09 kind-5 with the a-tag address", async () => {
    await deletePage(`${PAGES_KINDS.document}:${OWNER}:d1`);
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.kind).toBe(5);
    expect(e.tags).toContainEqual(["a", `${PAGES_KINDS.document}:${OWNER}:d1`]);
  });
});

describe("sharePage", () => {
  it("mints a viewKey, re-publishes the doc and returns an nkeys link (view-only)", async () => {
    const res = await sharePage({
      address: `${PAGES_KINDS.document}:${OWNER}:d1`,
      content: "# T\n\nx",
      canEdit: false,
    });
    expect(res.viewKey).toMatch(/^[0-9a-f]{64}$/);
    expect(res.editKey).toBeUndefined();
    expect(res.url).toContain("/pages/naddr1");
    expect(res.url).toContain("#nkeys1");
    // The doc was re-published encrypted under the viewKey.
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.content).toBe("vk-enc");
  });

  it("mints an editKey too when canEdit, and signs as the editKey", async () => {
    const res = await sharePage({
      address: `${PAGES_KINDS.document}:${OWNER}:d1`,
      content: "x",
      canEdit: true,
    });
    expect(res.editKey).toMatch(/^[0-9a-f]{64}$/);
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.pubkey).toBe(pubkeyFromHex(res.editKey!));
  });
});

/** A kind-34579 metadata event whose ciphertext `ct` the test maps to JSON. */
const metaEvent = (addr: string, ct: string, createdAt = 5): Event => ({
  id: `meta-${addr}-${createdAt}`,
  pubkey: OWNER,
  kind: PAGES_KINDS.docMetadata,
  created_at: createdAt,
  sig: "s",
  content: ct,
  tags: [["d", addr]],
});

/** Dispatch querySync by filter kind; metadata queries optionally by #d. */
const routeQuerySync = (routes: {
  metadata?: (dFilter?: string[]) => Event[];
  legacyList?: Event[];
  docs?: Event[];
  deletions?: Event[];
}) => {
  (nostrRuntime.querySync as any).mockImplementation((_r: unknown, f: any) => {
    if (f.kinds?.includes(PAGES_KINDS.docMetadata)) {
      return Promise.resolve(routes.metadata?.(f["#d"]) ?? []);
    }
    if (f.kinds?.includes(PAGES_KINDS.sharedPagesList)) {
      return Promise.resolve(routes.legacyList ?? []);
    }
    if (f.kinds?.includes(5)) return Promise.resolve(routes.deletions ?? []);
    return Promise.resolve(routes.docs ?? []);
  });
};

describe("doc metadata (kind 34579) — upstream read-merge-write", () => {
  const addr = `${PAGES_KINDS.document}:${OWNER}:d1`;

  it("setDocTags PRESERVES existing viewKey/editKey/sharedAs (no clobber)", async () => {
    routeQuerySync({
      metadata: () => [metaEvent(addr, "ct-meta")],
    });
    (nip44SelfDecrypt as any).mockResolvedValue(
      JSON.stringify({ tags: ["old"], viewKey: "vk", sharedAs: "33457:x:d9" }),
    );
    let written = "";
    (nip44SelfEncrypt as any).mockImplementation((_s: unknown, plain: string) => {
      written = plain;
      return Promise.resolve("enc");
    });
    await setDocTags(addr, ["work", "ideas"]);
    expect(JSON.parse(written)).toEqual({
      tags: ["work", "ideas"],
      viewKey: "vk",
      sharedAs: "33457:x:d9",
    });
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.kind).toBe(PAGES_KINDS.docMetadata);
    expect(e.tags).toContainEqual(["d", addr]);
  });

  it("setDocTitle sets a custom title; blank clears it", async () => {
    routeQuerySync({ metadata: () => [metaEvent(addr, "ct-meta")] });
    (nip44SelfDecrypt as any).mockResolvedValue(JSON.stringify({ tags: ["a"], title: "Old" }));
    const written: string[] = [];
    (nip44SelfEncrypt as any).mockImplementation((_s: unknown, plain: string) => {
      written.push(plain);
      return Promise.resolve("enc");
    });
    await setDocTitle(addr, "Renamed");
    await setDocTitle(addr, "");
    expect(JSON.parse(written[0])).toEqual({ tags: ["a"], title: "Renamed" });
    expect(JSON.parse(written[1])).toEqual({ tags: ["a"] }); // title removed
  });

  it("always writes a tags array even when the patch omits it (upstream DocMetadata.tags is required)", async () => {
    // No existing metadata for this address → merged object would otherwise have
    // no `tags` key, which makes pages.formstr.app's DocMetadataContext throw on
    // `meta.tags.length` and lose ALL doc titles/tags/sharedAs.
    routeQuerySync({ metadata: () => [] });
    let written = "";
    (nip44SelfEncrypt as any).mockImplementation((_s: unknown, plain: string) => {
      written = plain;
      return Promise.resolve("enc");
    });
    await saveDocMetadata(addr, { viewKey: "vk" });
    const obj = JSON.parse(written);
    expect(Array.isArray(obj.tags)).toBe(true);
    expect(obj).toEqual({ tags: [], viewKey: "vk" });
  });

  it("saveDocMetadata preserves UNKNOWN upstream keys on rewrite", async () => {
    routeQuerySync({ metadata: () => [metaEvent(addr, "ct-meta")] });
    (nip44SelfDecrypt as any).mockResolvedValue(JSON.stringify({ futureField: 42 }));
    let written = "";
    (nip44SelfEncrypt as any).mockImplementation((_s: unknown, plain: string) => {
      written = plain;
      return Promise.resolve("enc");
    });
    await saveDocMetadata(addr, { viewKey: "vk" });
    expect(JSON.parse(written)).toEqual({ futureField: 42, viewKey: "vk", tags: [] });
  });

  it("fetchDocTags returns a map of address -> tags", async () => {
    routeQuerySync({ metadata: () => [metaEvent(addr, "ct-meta")] });
    (nip44SelfDecrypt as any).mockResolvedValue(JSON.stringify({ tags: ["work"] }));
    const map = await fetchDocTags([addr]);
    expect(map.get(addr)).toEqual(["work"]);
  });

  it("fetchAllDocMetadata keeps only the newest event per address", async () => {
    routeQuerySync({
      metadata: () => [metaEvent(addr, "ct-old", 1), metaEvent(addr, "ct-new", 9)],
    });
    (nip44SelfDecrypt as any).mockImplementation((_s: unknown, ct: string) =>
      Promise.resolve(
        ct === "ct-new" ? JSON.stringify({ tags: ["new"] }) : JSON.stringify({ tags: ["old"] }),
      ),
    );
    const all = await fetchAllDocMetadata();
    expect(all.get(addr)).toEqual({ tags: ["new"] });
  });
});

describe("shared docs — kind-34579 viewKey entries (upstream model)", () => {
  const shared = `${PAGES_KINDS.document}:bbbb:dx`;

  it("fetchSharedList returns metadata entries that carry a viewKey", async () => {
    routeQuerySync({
      metadata: () => [metaEvent(shared, "ct-shared"), metaEvent("33457:cccc:dt", "ct-tagsonly")],
    });
    (nip44SelfDecrypt as any).mockImplementation((_s: unknown, ct: string) =>
      Promise.resolve(
        ct === "ct-shared"
          ? JSON.stringify({ tags: [], viewKey: "vk1", editKey: "ek1" })
          : JSON.stringify({ tags: ["work"] }),
      ),
    );
    const entries = await fetchSharedList();
    expect(entries).toEqual([[shared, "vk1", "ek1"]]);
  });

  it("migrates legacy kind-11234 entries into doc metadata", async () => {
    routeQuerySync({
      metadata: () => [],
      legacyList: [
        {
          id: "x",
          pubkey: OWNER,
          kind: PAGES_KINDS.sharedPagesList,
          created_at: 5,
          sig: "s",
          content: "ct-legacy",
          tags: [],
        },
      ],
    });
    (nip44SelfDecrypt as any).mockImplementation((_s: unknown, ct: string) =>
      ct === "ct-legacy"
        ? Promise.resolve(JSON.stringify([[shared, "vk1"]]))
        : Promise.reject(new Error("nope")),
    );
    const entries = await fetchSharedList();
    expect(entries).toEqual([[shared, "vk1"]]);
    // The legacy entry was republished as kind-34579 metadata for that address.
    const metaPublish = (nostrRuntime.publish as any).mock.calls
      .map((c: any[]) => c[1])
      .find((e: any) => e.kind === PAGES_KINDS.docMetadata);
    expect(metaPublish).toBeDefined();
    expect(metaPublish.tags).toContainEqual(["d", shared]);
  });

  it("addSharedPage writes the keys into the doc's metadata", async () => {
    routeQuerySync({ metadata: () => [] });
    let written = "";
    (nip44SelfEncrypt as any).mockImplementation((_s: unknown, plain: string) => {
      written = plain;
      return Promise.resolve("enc");
    });
    await addSharedPage([shared, "vk1", "ek1"]);
    expect(JSON.parse(written)).toEqual({ viewKey: "vk1", editKey: "ek1", tags: [] });
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.kind).toBe(PAGES_KINDS.docMetadata);
    expect(e.tags).toContainEqual(["d", shared]);
  });
});

describe("sharePage — upstream bookkeeping", () => {
  const original = `${PAGES_KINDS.document}:${OWNER}:d1`;

  it("records the share keys in the new address's doc metadata", async () => {
    const written: string[] = [];
    (nip44SelfEncrypt as any).mockImplementation((signer: unknown, plain: string) => {
      if (signer === mockSigner) written.push(plain);
      return Promise.resolve(signer === mockSigner ? "owner-enc" : "vk-enc");
    });
    const res = await sharePage({ address: original, content: "# T\n\nx", canEdit: false });
    const metaWrite = written.map((w) => JSON.parse(w)).find((o) => o.viewKey);
    expect(metaWrite).toEqual({ viewKey: res.viewKey, tags: [] });
  });

  it("edit-share marks the ORIGINAL doc with sharedAs (owner's doc)", async () => {
    const written: string[] = [];
    (nip44SelfEncrypt as any).mockImplementation((signer: unknown, plain: string) => {
      if (signer === mockSigner) written.push(plain);
      return Promise.resolve("enc");
    });
    const res = await sharePage({ address: original, content: "x", canEdit: true });
    const sharedAddress = `${PAGES_KINDS.document}:${pubkeyFromHex(res.editKey!)}:d1`;
    const parsed = written.map((w) => JSON.parse(w));
    expect(parsed).toContainEqual({ viewKey: res.viewKey, editKey: res.editKey, tags: [] });
    expect(parsed).toContainEqual({ sharedAs: sharedAddress, tags: [] });
    expect(res.address).toBe(sharedAddress);
  });

  it("edit RE-share returns the existing link WITHOUT republishing (no edit-stomp)", async () => {
    const sharedAddr = `${PAGES_KINDS.document}:eeee:d1`;
    routeQuerySync({
      metadata: (dFilter) => {
        if (dFilter?.includes(original)) return [metaEvent(original, "ct-orig")];
        if (dFilter?.includes(sharedAddr)) return [metaEvent(sharedAddr, "ct-shared")];
        return [];
      },
    });
    (nip44SelfDecrypt as any).mockImplementation((_s: unknown, ct: string) =>
      Promise.resolve(
        ct === "ct-orig"
          ? JSON.stringify({ sharedAs: sharedAddr })
          : JSON.stringify({ viewKey: "vk1", editKey: "ek1" }),
      ),
    );
    const res = await sharePage({ address: original, content: "stale local copy", canEdit: true });
    expect(nostrRuntime.publish).not.toHaveBeenCalled();
    expect(res.address).toBe(sharedAddr);
    expect(res.viewKey).toBe("vk1");
    expect(res.editKey).toBe("ek1");
  });
});

describe("fetchMyPages — metadata integration", () => {
  it("uses the metadata title/viewKey/sharedAs for renamed + shared docs", async () => {
    const addr = `${PAGES_KINDS.document}:${OWNER}:a1`;
    routeQuerySync({
      docs: [
        {
          id: "hex-a1",
          pubkey: OWNER,
          kind: PAGES_KINDS.document,
          created_at: 100,
          sig: "s",
          content: "ct-doc",
          tags: [["d", "a1"]],
        },
      ],
      metadata: () => [metaEvent(addr, "ct-meta")],
    });
    (nip44SelfDecrypt as any).mockImplementation((_s: unknown, ct: string) =>
      ct === "ct-meta"
        ? Promise.resolve(
            JSON.stringify({ title: "Renamed", viewKey: "vk1", sharedAs: "33457:e:a1" }),
          )
        : Promise.reject(new Error("owner cannot decrypt a viewKey-encrypted doc")),
    );
    const pages = await fetchMyPages();
    expect(pages[0].title).toBe("Renamed");
    expect(pages[0].viewKey).toBe("vk1");
    expect(pages[0].sharedAs).toBe("33457:e:a1");
  });
});

describe("deletePage — version e-tags", () => {
  it("e-tags every version of the doc in the kind-5 (upstream deleteEvent)", async () => {
    const addr = `${PAGES_KINDS.document}:${OWNER}:d1`;
    routeQuerySync({
      docs: [
        {
          id: "v1",
          pubkey: OWNER,
          kind: 33457,
          created_at: 1,
          sig: "s",
          content: "",
          tags: [["d", "d1"]],
        },
        {
          id: "v2",
          pubkey: OWNER,
          kind: 33457,
          created_at: 2,
          sig: "s",
          content: "",
          tags: [["d", "d1"]],
        },
      ],
    });
    await deletePage(addr);
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.tags).toContainEqual(["a", addr]);
    expect(e.tags).toContainEqual(["e", "v1"]);
    expect(e.tags).toContainEqual(["e", "v2"]);
  });
});

describe("fetchPage — metadata viewKey fallback", () => {
  it("decrypts with the doc-metadata viewKey when self-decrypt fails", async () => {
    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "h",
      pubkey: "ffff",
      kind: PAGES_KINDS.document,
      created_at: 1,
      sig: "s",
      content: "ct-doc",
      tags: [["d", "d9"]],
    });
    routeQuerySync({
      metadata: () => [metaEvent(`${PAGES_KINDS.document}:ffff:d9`, "ct-meta")],
    });
    (nip44SelfDecrypt as any).mockImplementation((signer: unknown, ct: string) => {
      if (ct === "ct-meta") return Promise.resolve(JSON.stringify({ viewKey: "11".repeat(32) }));
      if (signer === mockSigner) return Promise.reject(new Error("not ours"));
      return Promise.resolve("# Via metadata\n\nx"); // LocalSigner(viewKey) path
    });
    const page = await fetchPage("ffff", "d9");
    expect(page?.title).toBe("Via metadata");
    expect(page?.isEncrypted).toBe(false);
    expect(page?.viewKey).toBe("11".repeat(32));
  });
});
