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
  saveSharedList,
  fetchDocTags,
  setDocTags,
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

describe("shared-with-me list (kind 11234)", () => {
  it("saveSharedList self-encrypts the entries array", async () => {
    (nip44SelfEncrypt as any).mockImplementation((_s: unknown, plain: string) => {
      expect(JSON.parse(plain)).toEqual([["33457:p:d", "vk", "ek"]]);
      return Promise.resolve("enc");
    });
    await saveSharedList([["33457:p:d", "vk", "ek"]]);
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.kind).toBe(PAGES_KINDS.sharedPagesList);
    expect(e.content).toBe("enc");
  });

  it("fetchSharedList self-decrypts the entries array", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "x",
        pubkey: OWNER,
        kind: PAGES_KINDS.sharedPagesList,
        created_at: 5,
        sig: "s",
        content: "ct",
        tags: [],
      },
    ]);
    (nip44SelfDecrypt as any).mockResolvedValue(JSON.stringify([["33457:p:d", "vk"]]));
    const entries = await fetchSharedList();
    expect(entries).toEqual([["33457:p:d", "vk"]]);
  });
});

describe("doc tags (kind 34579)", () => {
  it("setDocTags self-encrypts {tags} keyed by the doc address", async () => {
    const addr = `${PAGES_KINDS.document}:${OWNER}:d1`;
    (nip44SelfEncrypt as any).mockImplementation((_s: unknown, plain: string) => {
      expect(JSON.parse(plain)).toEqual({ tags: ["work", "ideas"] });
      return Promise.resolve("enc");
    });
    await setDocTags(addr, ["work", "ideas"]);
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.kind).toBe(PAGES_KINDS.docMetadata);
    expect(e.tags).toContainEqual(["d", addr]);
  });

  it("fetchDocTags returns a map of address -> tags", async () => {
    const addr = `${PAGES_KINDS.document}:${OWNER}:d1`;
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "m",
        pubkey: OWNER,
        kind: PAGES_KINDS.docMetadata,
        created_at: 5,
        sig: "s",
        content: "ct",
        tags: [["d", addr]],
      },
    ]);
    (nip44SelfDecrypt as any).mockResolvedValue(JSON.stringify({ tags: ["work"] }));
    const map = await fetchDocTags([addr]);
    expect(map.get(addr)).toEqual(["work"]);
  });
});
