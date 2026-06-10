import { generateSecretKey, getPublicKey, nip44 } from "nostr-tools";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Partial mock: real crypto (LocalSigner / NIP-44), stub only the network surface
// and the signer singleton.
vi.mock("@formstr/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    signerManager: { getSigner: vi.fn() },
    nostrRuntime: { publish: vi.fn(), querySync: vi.fn() },
    relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.test"]) },
  };
});

import { LocalSigner, nostrRuntime, signerManager } from "@formstr/core";
import type { Event } from "nostr-tools";
import { finalizeEvent } from "nostr-tools";

import { publishPageComment, fetchPageComments, parsePageComment } from "./comments";
import { PAGES_KINDS } from "./types";

const ownerKey = generateSecretKey();
const OWNER = getPublicKey(ownerKey);
const commenterKey = generateSecretKey();
const viewKey = generateSecretKey();
const viewKeyHex = bytesToHex(viewKey);
const DOC_ADDRESS = `${PAGES_KINDS.document}:${OWNER}:doc123`;
const DOC_EVENT_ID = "e".repeat(64);

/** Exactly upstream nostr-docs `publishComment` (src/nostr/comments.ts). */
function buildUpstreamComment(innerTags: string[][]): Event {
  const conversationKey = nip44.getConversationKey(
    hexToBytes(viewKeyHex),
    getPublicKey(hexToBytes(viewKeyHex)),
  );
  return finalizeEvent(
    {
      kind: 1494,
      created_at: 1700000000,
      content: nip44.encrypt(JSON.stringify(innerTags), conversationKey),
      tags: [
        ["a", DOC_ADDRESS],
        ["e", DOC_EVENT_ID],
        ["p", OWNER],
      ],
    },
    commenterKey,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (signerManager.getSigner as any).mockResolvedValue(new LocalSigner(commenterKey));
  (nostrRuntime.publish as any).mockResolvedValue(undefined);
  (nostrRuntime.querySync as any).mockResolvedValue([]);
});

describe("publishPageComment — upstream kind-1494 wire", () => {
  it("anchors with a/e/p tags and viewKey-encrypts the inner tag array", async () => {
    const signed = await publishPageComment(
      {
        content: "Looks wrong",
        type: "suggestion",
        quote: "the quick fox",
        context: { prefix: "before ", suffix: " after" },
      },
      viewKeyHex,
      DOC_ADDRESS,
      DOC_EVENT_ID,
    );

    expect(signed.kind).toBe(1494);
    expect(signed.tags).toEqual([
      ["a", DOC_ADDRESS],
      ["e", DOC_EVENT_ID],
      ["p", OWNER],
    ]);

    // Decrypt exactly the way upstream CommentContext does.
    const conversationKey = nip44.getConversationKey(viewKey, getPublicKey(viewKey));
    const inner = JSON.parse(nip44.decrypt(signed.content, conversationKey)) as string[][];
    expect(inner).toEqual([
      ["content", "Looks wrong"],
      ["type", "suggestion"],
      ["quote", "the quick fox"],
      ["context", "before ", " after"],
    ]);
  });
});

describe("fetchPageComments — reads upstream-built comments", () => {
  it("decrypts and parses a comment formstr.app published", async () => {
    const upstream = buildUpstreamComment([
      ["content", "Nice paragraph"],
      ["type", "comment"],
      ["quote", "some text"],
    ]);
    (nostrRuntime.querySync as any).mockResolvedValue([upstream]);

    const comments = await fetchPageComments(DOC_ADDRESS, viewKeyHex);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      content: "Nice paragraph",
      type: "comment",
      quote: "some text",
      author: getPublicKey(commenterKey),
    });
  });

  it("skips comments encrypted under a different viewKey", async () => {
    const upstream = buildUpstreamComment([
      ["content", "secret"],
      ["type", "comment"],
    ]);
    (nostrRuntime.querySync as any).mockResolvedValue([upstream]);
    const comments = await fetchPageComments(DOC_ADDRESS, bytesToHex(generateSecretKey()));
    expect(comments).toEqual([]);
  });

  it("sorts comments oldest-first", async () => {
    const a = buildUpstreamComment([
      ["content", "first"],
      ["type", "comment"],
    ]);
    const b = {
      ...buildUpstreamComment([
        ["content", "second"],
        ["type", "comment"],
      ]),
    };
    (a as any).created_at = 100;
    (b as any).created_at = 50;
    (nostrRuntime.querySync as any).mockResolvedValue([a, b]);
    const comments = await fetchPageComments(DOC_ADDRESS, viewKeyHex);
    expect(comments.map((c) => c.content)).toEqual(["second", "first"]);
  });
});

describe("parsePageComment", () => {
  it("defaults a malformed type to 'comment' and tolerates a missing context", async () => {
    const upstream = buildUpstreamComment([
      ["content", "x"],
      ["type", "weird"],
    ]);
    const parsed = await parsePageComment(upstream, viewKeyHex);
    expect(parsed).toMatchObject({ content: "x", type: "comment" });
    expect(parsed?.context).toBeUndefined();
  });

  it("returns undefined for inner payloads without a content row", async () => {
    const upstream = buildUpstreamComment([["type", "comment"]]);
    expect(await parsePageComment(upstream, viewKeyHex)).toBeUndefined();
  });
});
