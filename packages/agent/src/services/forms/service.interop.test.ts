import { generateSecretKey, getPublicKey } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Partial mock: real crypto (LocalSigner / NIP-44), stub only the network surface
// and the signer singleton.
vi.mock("@formstr/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    signerManager: { getSigner: vi.fn(), getSignerIfAvailable: vi.fn(() => null) },
    nostrRuntime: {
      publish: vi.fn(),
      fetchOne: vi.fn(),
      querySync: vi.fn(),
      subscribe: vi.fn(),
    },
    relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.test"]) },
  };
});

import { sha256 } from "@noble/hashes/sha256";
import { LocalSigner, nostrRuntime, signerManager, nip44SelfEncrypt } from "@formstr/core";
import type { Event } from "nostr-tools";
import { finalizeEvent, getEventHash, verifyEvent } from "nostr-tools";

import { fetchForm, fetchFormKeys, shareForm } from "./service";

/**
 * Interop fixtures built exactly the way formstr.app builds them
 * (upstream/nostr-forms `nostr/createForm.ts`): the FULL spec tag array —
 * d, name, settings, field rows — NIP-44-encrypted by the ephemeral signing
 * key to the view pubkey; outer tags carry only d + name.
 */
async function buildUpstreamEncryptedEvent(
  signingKey: Uint8Array,
  viewKey: Uint8Array,
  formId: string,
  name: string,
  spec: string[][],
): Promise<Event> {
  const content = await new LocalSigner(signingKey).nip44Encrypt(
    getPublicKey(viewKey),
    JSON.stringify(spec),
  );
  return {
    id: "interop-event",
    kind: 30168,
    pubkey: getPublicKey(signingKey),
    created_at: 1000,
    sig: "sig",
    content,
    tags: [
      ["d", formId],
      ["name", name],
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchForm — decrypts a formstr.app-authored encrypted form", () => {
  it("returns name, settings, and renderElement-typed fields from the full spec", async () => {
    const signingKey = generateSecretKey();
    const viewKey = generateSecretKey();

    const spec: string[][] = [
      ["d", "form1"],
      ["name", "Upstream Form"],
      ["settings", JSON.stringify({ description: "Top secret", thankYouPage: true })],
      ["field", "q1", "text", "Your name", "[]", '{"renderElement":"shortText","required":true}'],
      [
        "field",
        "q2",
        "option",
        "Pick one",
        JSON.stringify([
          ["c1", "Yes"],
          ["c2", "No"],
        ]),
        '{"renderElement":"radioButton"}',
      ],
    ];
    const event = await buildUpstreamEncryptedEvent(
      signingKey,
      viewKey,
      "form1",
      "Upstream Form",
      spec,
    );
    (nostrRuntime.fetchOne as any).mockResolvedValue(event);

    const form = await fetchForm(getPublicKey(signingKey), "form1", bytesToHex(viewKey));

    expect(form).not.toBeNull();
    expect(form!.isEncrypted).toBe(true);
    expect(form!.name).toBe("Upstream Form");
    expect(form!.settings).toMatchObject({ description: "Top secret", thankYouPage: true });
    expect(form!.fields).toHaveLength(2);
    expect(form!.fields[0]).toMatchObject({
      id: "q1",
      type: "shortText",
      label: "Your name",
      required: true,
    });
    expect(form!.fields[1].type).toBe("radioButton");
    expect(form!.fields[1].options).toEqual([
      { id: "c1", label: "Yes" },
      { id: "c2", label: "No" },
    ]);
  });

  it("returns empty fields (not garbage) when the view key is wrong", async () => {
    const signingKey = generateSecretKey();
    const viewKey = generateSecretKey();
    const event = await buildUpstreamEncryptedEvent(signingKey, viewKey, "form1", "Enc", [
      ["d", "form1"],
      ["name", "Enc"],
      ["field", "q1", "text", "Q", "[]", "{}"],
    ]);
    (nostrRuntime.fetchOne as any).mockResolvedValue(event);

    const wrongKey = bytesToHex(generateSecretKey());
    const form = await fetchForm(getPublicKey(signingKey), "form1", wrongKey);

    expect(form!.isEncrypted).toBe(true);
    expect(form!.fields).toHaveLength(0);
  });
});

describe("fetchForm — still decodes legacy super-app encrypted events", () => {
  it("parses field-rows-only content with the outer settings/encryption tags", async () => {
    const signingKey = generateSecretKey();
    const viewKey = generateSecretKey();

    // Legacy layout: content = field rows ONLY, settings left plaintext in outer
    // tags, plus the nonstandard ["encryption","view-key"] marker.
    const fieldRows = [["field", "f1", "shortText", "Legacy Q", "[]", '{"required":true}']];
    const content = await new LocalSigner(signingKey).nip44Encrypt(
      getPublicKey(viewKey),
      JSON.stringify(fieldRows),
    );
    const event: Event = {
      id: "legacy-event",
      kind: 30168,
      pubkey: getPublicKey(signingKey),
      created_at: 1000,
      sig: "sig",
      content,
      tags: [
        ["d", "form2"],
        ["name", "Legacy Form"],
        ["encryption", "view-key"],
        ["settings", JSON.stringify({ description: "outer desc" })],
      ],
    };
    (nostrRuntime.fetchOne as any).mockResolvedValue(event);

    const form = await fetchForm(getPublicKey(signingKey), "form2", bytesToHex(viewKey));

    expect(form!.isEncrypted).toBe(true);
    expect(form!.name).toBe("Legacy Form");
    expect(form!.settings.description).toBe("outer desc");
    expect(form!.fields).toHaveLength(1);
    expect(form!.fields[0]).toMatchObject({ type: "shortText", label: "Legacy Q", required: true });
  });
});

// ── Access grants (upstream nostr/accessControl.ts protocol) ──

const aliasFor = (author: string, formId: string, recipient: string) =>
  bytesToHex(sha256(`30168:${author}:${formId}:${recipient}`));

const now = () => Math.round(Date.now() / 1000);

describe("shareForm → upstream fetchKeys round-trip (real crypto)", () => {
  it("recipient recovers ViewAccess (and EditAccess for editors) via the alias filter", async () => {
    const userSk = generateSecretKey();
    const userSigner = new LocalSigner(userSk);
    const signingSk = generateSecretKey();
    const signingHex = bytesToHex(signingSk);
    const signingPub = getPublicKey(signingSk);
    const viewHex = bytesToHex(generateSecretKey());
    const viewerSk = generateSecretKey();
    const viewerPub = getPublicKey(viewerSk);
    const editorSk = generateSecretKey();
    const editorPub = getPublicKey(editorSk);

    (signerManager.getSigner as any).mockResolvedValue(userSigner);

    // Real, self-encrypted kind-14083 list carrying the form's keys
    const listContent = await nip44SelfEncrypt(
      userSigner,
      JSON.stringify([["f", `${signingPub}:form1`, "wss://r", `${signingHex}:${viewHex}`]]),
    );
    (nostrRuntime.querySync as any)
      .mockResolvedValueOnce([
        {
          id: "l",
          pubkey: await userSigner.getPublicKey(),
          kind: 14083,
          created_at: 1,
          sig: "s",
          content: listContent,
          tags: [],
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await shareForm({
      formId: "form1",
      formPubkey: signingPub,
      recipients: [viewerPub],
      editors: [editorPub],
    });
    expect(result).toEqual({ published: 2, failed: [] });

    const wraps: Event[] = (nostrRuntime.publish as any).mock.calls
      .map((c: unknown[]) => c[1] as Event)
      .filter((e: Event) => e.kind === 1059);

    // Decrypt exactly like upstream utils/formUtils.ts fetchKeys
    const unwrapAs = async (recipientSk: Uint8Array, recipientPub: string) => {
      const wrap = wraps.find((w) => w.tags[0][1] === aliasFor(signingPub, "form1", recipientPub));
      expect(wrap).toBeTruthy();
      const me = new LocalSigner(recipientSk);
      const seal = JSON.parse(await me.nip44Decrypt(wrap!.pubkey, wrap!.content)) as Event;
      expect(seal.kind).toBe(13);
      expect(seal.pubkey).toBe(signingPub); // sealed by the form's signing key
      expect(verifyEvent(seal)).toBe(true);
      const rumor = JSON.parse(await me.nip44Decrypt(seal.pubkey, seal.content));
      expect(rumor.kind).toBe(18);
      expect(rumor.pubkey).toBe(signingPub);
      expect(rumor.id).toMatch(/^[0-9a-f]{64}$/);
      return rumor.tags as string[][];
    };

    const viewerTags = await unwrapAs(viewerSk, viewerPub);
    expect(viewerTags).toContainEqual(["ViewAccess", viewHex]);
    expect(viewerTags.some((t) => t[0] === "EditAccess")).toBe(false);

    const editorTags = await unwrapAs(editorSk, editorPub);
    expect(editorTags).toContainEqual(["ViewAccess", viewHex]);
    expect(editorTags).toContainEqual(["EditAccess", signingHex]);
  });
});

describe("fetchFormKeys / fetchForm — reads upstream-authored access grants", () => {
  it("auto-decrypts an encrypted form from an upstream-shaped wrap, no explicit viewKey", async () => {
    const userSk = generateSecretKey();
    const userPub = getPublicKey(userSk);
    const userSigner = new LocalSigner(userSk);
    const signingSk = generateSecretKey();
    const signingHex = bytesToHex(signingSk);
    const signingPub = getPublicKey(signingSk);
    const viewSk = generateSecretKey();
    const viewHex = bytesToHex(viewSk);

    // Build the grant exactly like upstream accessControl.ts grantAccess
    const rumor: Record<string, unknown> = {
      kind: 18,
      pubkey: signingPub,
      created_at: now(),
      content: "",
      tags: [
        ["EditAccess", signingHex],
        ["ViewAccess", viewHex],
      ],
    };
    rumor.id = getEventHash(rumor as Parameters<typeof getEventHash>[0]);
    const seal = finalizeEvent(
      {
        kind: 13,
        content: await new LocalSigner(signingSk).nip44Encrypt(userPub, JSON.stringify(rumor)),
        created_at: now(),
        tags: [],
      },
      signingSk,
    );
    const randomSk = generateSecretKey();
    const wrap = finalizeEvent(
      {
        kind: 1059,
        content: await new LocalSigner(randomSk).nip44Encrypt(userPub, JSON.stringify(seal)),
        created_at: now(),
        tags: [["p", aliasFor(signingPub, "form1", userPub)]],
      },
      randomSk,
    );

    (signerManager.getSignerIfAvailable as any).mockReturnValue(userSigner);
    (nostrRuntime.querySync as any).mockResolvedValue([wrap]);

    const keys = await fetchFormKeys(signingPub, "form1");
    expect(keys).toEqual({ viewKey: viewHex, signingKey: signingHex });

    // End-to-end: fetchForm with NO viewKey discovers the grant and decrypts
    const event = await buildUpstreamEncryptedEvent(signingSk, viewSk, "form1", "Shared", [
      ["d", "form1"],
      ["name", "Shared"],
      ["field", "q1", "text", "Granted Q", "[]", '{"renderElement":"shortText"}'],
    ]);
    (nostrRuntime.fetchOne as any).mockResolvedValue(event);

    const form = await fetchForm(signingPub, "form1");
    expect(form!.fields).toHaveLength(1);
    expect(form!.fields[0].label).toBe("Granted Q");
  });
});
