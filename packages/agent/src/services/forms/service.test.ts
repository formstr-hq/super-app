import {
  signerManager,
  nostrRuntime,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
  LocalSigner,
} from "@formstr/core";
import { sha256 } from "@noble/hashes/sha256";
import type { Event } from "nostr-tools";
import { getPublicKey } from "nostr-tools";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn(), getSignerIfAvailable: vi.fn() },
  nostrRuntime: {
    publish: vi.fn(),
    fetchOne: vi.fn(),
    querySync: vi.fn(),
    subscribe: vi.fn(),
  },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.test"]) },
  nip44Encrypt: vi.fn(),
  nip44SelfEncrypt: vi.fn(),
  nip44SelfDecrypt: vi.fn(),
  createRef: vi.fn(() => "naddr1mockref"),
  LocalSigner: vi.fn().mockImplementation(() => ({
    nip44Encrypt: vi.fn(),
    nip44Decrypt: vi.fn(),
    getPublicKey: vi.fn(),
    signEvent: vi.fn(),
  })),
}));

import {
  createForm,
  fetchForm,
  fetchResponses,
  fetchMyForms,
  deleteForm,
  saveToMyForms,
  submitResponse,
  subscribeToResponses,
  updateForm,
  shareForm,
  fetchFormKeys,
  fetchFormSummaryFromRef,
  importForm,
} from "./service";

const mockSigner = {
  getPublicKey: vi.fn().mockResolvedValue("aabbccdd"),
  signEvent: vi
    .fn()
    .mockImplementation((e: any) =>
      Promise.resolve({ ...e, id: "eid", sig: "sig", pubkey: "aabbccdd" }),
    ),
  nip44Encrypt: vi.fn(),
  nip44Decrypt: vi.fn(),
  encrypt: vi.fn().mockResolvedValue("nip04_enc"),
  decrypt: vi.fn().mockResolvedValue("[]"),
};

beforeEach(() => {
  vi.clearAllMocks();
  (signerManager.getSigner as any).mockResolvedValue(mockSigner);
  (signerManager.getSignerIfAvailable as any).mockReturnValue(null);
  (nostrRuntime.publish as any).mockResolvedValue(undefined);
  (nostrRuntime.fetchOne as any).mockResolvedValue(null);
  (nostrRuntime.querySync as any).mockResolvedValue([]);
});

// ── createForm ────────────────────────────────────────────────

describe("createForm — plain form", () => {
  it("signs with an ephemeral signing key (upstream model), not the user identity key", async () => {
    (nip44SelfEncrypt as any).mockResolvedValue("enc_list");

    const result = await createForm({
      name: "Survey",
      fields: [{ id: "f1", type: "shortText" as any, label: "Name" }],
    });

    // First publish: kind-30168, finalizeEvent-signed by the signing key
    const calls = (nostrRuntime.publish as any).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const formEvent = calls[0][1];
    expect(formEvent.kind).toBe(30168);
    expect(formEvent.content).toBe("");
    expect(formEvent.tags.some((t: string[]) => t[0] === "field")).toBe(true);
    expect(result.formId).toBeTruthy();
    expect(result.pubkey).not.toBe("aabbccdd"); // ephemeral signing pubkey
    expect(formEvent.pubkey).toBe(result.pubkey);
    expect(result.signingKey).toMatch(/^[0-9a-f]{64}$/);
    expect(result.viewKey).toBeUndefined();

    // 14083 entry 4th segment carries the signing key (formstr.app needs it to edit)
    expect(nip44SelfEncrypt).toHaveBeenCalledWith(
      mockSigner,
      expect.stringContaining(result.signingKey!),
    );
  });

  it("does NOT clobber the my-forms list when the existing one can't be decrypted", async () => {
    // Regression: a transient decrypt failure (common with a flaky nip46 bunker)
    // must never cause the 14083 list to be rewritten with only the new form —
    // that destroys every previously-saved form. Match deleteForm: bail safely.
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "list",
        pubkey: "aabbccdd",
        kind: 14083,
        created_at: 1000,
        sig: "s",
        content: "enc_list_unreadable",
        tags: [],
      },
    ]);
    (nip44SelfDecrypt as any).mockRejectedValue(new Error("bunker timeout"));
    (nip44SelfEncrypt as any).mockResolvedValue("enc_list");

    await expect(
      createForm({
        name: "Survey",
        fields: [{ id: "f1", type: "shortText" as any, label: "Name" }],
      }),
    ).rejects.toThrow();

    // The 30168 may have been published, but the 14083 list must NOT be rewritten.
    const listPublishes = (nostrRuntime.publish as any).mock.calls.filter(
      (c: any[]) => c[1]?.kind === 14083,
    );
    expect(listPublishes).toHaveLength(0);
  });

  it("always tags plaintext forms public and writes per-relay relay tags (upstream parity)", async () => {
    (nip44SelfEncrypt as any).mockResolvedValue("enc_list");

    // no settings.publicForm — upstream tags EVERY plaintext form ["t","public"]
    await createForm({
      name: "Survey",
      fields: [{ id: "f1", type: "shortText" as any, label: "Name" }],
    });

    const formEvent = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(formEvent.tags).toContainEqual(["t", "public"]);
    expect(formEvent.tags).toContainEqual(["relay", "wss://relay.test"]);
  });

  it("writes field tags through the upstream codec (primitive slot + renderElement)", async () => {
    (nip44SelfEncrypt as any).mockResolvedValue("enc_list");

    await createForm({
      name: "Survey",
      fields: [{ id: "f1", type: "shortText" as any, label: "Name" }],
    });

    const formEvent = (nostrRuntime.publish as any).mock.calls[0][1];
    const fieldTag = formEvent.tags.find((t: string[]) => t[0] === "field");
    expect(fieldTag[2]).toBe("text"); // primitive, not the AnswerType
    expect(JSON.parse(fieldTag[5]).renderElement).toBe("shortText");
  });

  it("writes allowed/p outer tags on plaintext forms too (upstream tags EVERY form)", async () => {
    (nip44SelfEncrypt as any).mockResolvedValue("enc_list");

    // A public (plaintext) form may still gate submissions to specific npubs.
    // formstr.app's FormRenderer enforces that gate from the ["allowed"] *tags*,
    // not from settings — so the plaintext path must emit them like the encrypted one.
    await createForm({
      name: "Gated public",
      fields: [{ id: "f1", type: "shortText" as any, label: "Name" }],
      settings: { allowedResponders: ["pubA"], collaborators: ["pubB"] },
    });

    const formEvent = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(formEvent.content).toBe(""); // still a plaintext form
    expect(formEvent.tags).toContainEqual(["t", "public"]);
    expect(formEvent.tags).toContainEqual(["allowed", "pubA"]);
    // p = allowed ∪ collaborators
    expect(formEvent.tags).toContainEqual(["p", "pubA"]);
    expect(formEvent.tags).toContainEqual(["p", "pubB"]);
  });
});

describe("createForm — encrypted form", () => {
  it("encrypts the FULL spec into content; outer tags carry no settings/encryption", async () => {
    const mockFormSigner = { nip44Encrypt: vi.fn().mockResolvedValue("enc_spec") };
    (LocalSigner as any).mockImplementationOnce(() => mockFormSigner);
    (nip44SelfEncrypt as any).mockResolvedValue("enc_list");

    const result = await createForm({
      name: "Secret",
      fields: [{ id: "f1", type: "shortText" as any, label: "Q" }],
      encrypt: true,
    });

    expect(result.signingKey).toBeTruthy();
    expect(result.viewKey).toBeTruthy();
    expect(result.pubkey).not.toBe("aabbccdd"); // ephemeral pubkey, not user pubkey

    const calls = (nostrRuntime.publish as any).mock.calls;
    const formEvent = calls[0][1];
    expect(formEvent.kind).toBe(30168);
    expect(formEvent.content).toBe("enc_spec");

    // Upstream layout: detection is content !== "" — NO nonstandard encryption tag,
    // NO plaintext settings tag; outer tags are only d/name/relay (+allowed/p).
    expect(formEvent.tags.some((t: string[]) => t[0] === "encryption")).toBe(false);
    expect(formEvent.tags.some((t: string[]) => t[0] === "settings")).toBe(false);
    expect(formEvent.tags).toContainEqual(["d", result.formId]);
    expect(formEvent.tags).toContainEqual(["name", "Secret"]);
    expect(formEvent.tags).toContainEqual(["relay", "wss://relay.test"]);

    // The encrypted payload is the full spec tag array: d + name + field rows
    expect(mockFormSigner.nip44Encrypt).toHaveBeenCalledWith(
      expect.any(String), // viewPubkey
      expect.stringContaining('"field"'),
    );
    const specJson = mockFormSigner.nip44Encrypt.mock.calls[0][1];
    const spec = JSON.parse(specJson) as string[][];
    expect(spec.some((t) => t[0] === "d" && t[1] === result.formId)).toBe(true);
    expect(spec.some((t) => t[0] === "name" && t[1] === "Secret")).toBe(true);

    // kind-14083 published with NIP-44 self-encryption, keys serialised in payload
    const listEvent = calls[1][1];
    expect(listEvent.kind).toBe(14083);
    expect(nip44SelfEncrypt).toHaveBeenCalledWith(
      mockSigner,
      expect.stringContaining(result.signingKey!),
    );
  });

  it("puts settings inside the encrypted spec, not in plaintext outer tags", async () => {
    const mockFormSigner = { nip44Encrypt: vi.fn().mockResolvedValue("enc_spec") };
    (LocalSigner as any).mockImplementationOnce(() => mockFormSigner);

    await createForm({
      name: "Secret",
      fields: [{ id: "f1", type: "shortText" as any, label: "Q" }],
      settings: { thankYouText: "Cheers", disallowAnonymous: true },
      encrypt: true,
    });

    const formEvent = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(formEvent.tags.some((t: string[]) => t[0] === "settings")).toBe(false);

    const spec = JSON.parse(mockFormSigner.nip44Encrypt.mock.calls[0][1]) as string[][];
    const settingsRow = spec.find((t) => t[0] === "settings");
    expect(settingsRow).toBeTruthy();
    expect(JSON.parse(settingsRow![1])).toMatchObject({ thankYouText: "Cheers" });
  });

  it("writes allowed/p outer tags from allowedResponders and collaborators", async () => {
    const mockFormSigner = { nip44Encrypt: vi.fn().mockResolvedValue("enc_spec") };
    (LocalSigner as any).mockImplementationOnce(() => mockFormSigner);

    await createForm({
      name: "Secret",
      fields: [{ id: "f1", type: "shortText" as any, label: "Q" }],
      settings: { allowedResponders: ["pubA"], collaborators: ["pubB"] },
      encrypt: true,
    });

    const formEvent = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(formEvent.tags).toContainEqual(["allowed", "pubA"]);
    // p = allowed ∪ collaborators
    expect(formEvent.tags).toContainEqual(["p", "pubA"]);
    expect(formEvent.tags).toContainEqual(["p", "pubB"]);
  });
});

// ── fetchForm ─────────────────────────────────────────────────

describe("fetchForm — plain form", () => {
  it("returns parsed form with fields, isEncrypted=false", async () => {
    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "eid",
      pubkey: "formpub",
      kind: 30168,
      created_at: 1000,
      sig: "sig",
      content: "",
      tags: [
        ["d", "form1"],
        ["name", "My Form"],
        ["field", "f1", "shortText", "Name", "[]", '{"required":false}'],
      ],
    } satisfies Event);

    const form = await fetchForm("formpub", "form1");
    expect(form).not.toBeNull();
    expect(form!.fields).toHaveLength(1);
    expect(form!.isEncrypted).toBe(false);
  });

  it("collects relay tags into template.relays and resolves renderElement types", async () => {
    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "eid",
      pubkey: "formpub",
      kind: 30168,
      created_at: 1000,
      sig: "sig",
      content: "",
      tags: [
        ["d", "form1"],
        ["name", "My Form"],
        ["relay", "wss://custom.relay"],
        ["relay", "wss://other.relay"],
        // upstream-authored field: primitive in slot 2, widget in renderElement
        ["field", "f1", "text", "Birthday", "[]", '{"renderElement":"date","required":true}'],
      ],
    } satisfies Event);

    const form = await fetchForm("formpub", "form1");
    expect(form!.relays).toEqual(["wss://custom.relay", "wss://other.relay"]);
    expect(form!.fields[0].type).toBe("date");
    expect(form!.fields[0].required).toBe(true);
  });

  it("queries module relays ∪ naddr relay hints when hints are supplied", async () => {
    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "eid",
      pubkey: "formpub",
      kind: 30168,
      created_at: 1000,
      sig: "sig",
      content: "",
      tags: [
        ["d", "form1"],
        ["name", "My Form"],
      ],
    } satisfies Event);

    await fetchForm("formpub", "form1", undefined, ["wss://hint.relay", "wss://relay.test"]);

    const relaysArg = (nostrRuntime.fetchOne as any).mock.calls[0][0] as string[];
    expect(relaysArg).toContain("wss://relay.test"); // module default
    expect(relaysArg).toContain("wss://hint.relay"); // naddr hint
    // deduplicated
    expect(relaysArg.filter((r) => r === "wss://relay.test")).toHaveLength(1);
  });
});

describe("fetchForm — encrypted, correct viewKey", () => {
  it("decrypts an upstream full-spec payload: name/settings/fields from content", async () => {
    const mockViewSigner = {
      nip44Decrypt: vi.fn().mockResolvedValue(
        JSON.stringify([
          ["d", "form1"],
          ["name", "Enc Form"],
          ["settings", '{"description":"hidden desc"}'],
          ["field", "f1", "text", "Secret Q", "[]", '{"renderElement":"shortText"}'],
        ]),
      ),
    };
    (LocalSigner as any).mockImplementationOnce(() => mockViewSigner);

    // Upstream-shaped event: outer tags only d+name, no settings/encryption tags
    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "eid",
      pubkey: "formpub",
      kind: 30168,
      created_at: 1000,
      sig: "sig",
      content: "enc_blob",
      tags: [
        ["d", "form1"],
        ["name", "Enc Form"],
      ],
    } satisfies Event);

    const form = await fetchForm(
      "formpub",
      "form1",
      "aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd",
    );
    expect(form!.isEncrypted).toBe(true);
    expect(form!.fields).toHaveLength(1);
    expect(form!.fields[0].label).toBe("Secret Q");
    expect(form!.settings.description).toBe("hidden desc");
    expect(mockViewSigner.nip44Decrypt).toHaveBeenCalledWith("formpub", "enc_blob");
  });

  it("still decodes a legacy super-app event (field-rows-only content + encryption tag)", async () => {
    const mockViewSigner = {
      nip44Decrypt: vi
        .fn()
        .mockResolvedValue(
          JSON.stringify([["field", "f1", "shortText", "Secret Q", "[]", '{"required":false}']]),
        ),
    };
    (LocalSigner as any).mockImplementationOnce(() => mockViewSigner);

    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "eid",
      pubkey: "formpub",
      kind: 30168,
      created_at: 1000,
      sig: "sig",
      content: "enc_blob",
      tags: [
        ["d", "form1"],
        ["name", "Enc Form"],
        ["encryption", "view-key"],
        ["settings", '{"description":"outer desc"}'],
      ],
    } satisfies Event);

    const form = await fetchForm(
      "formpub",
      "form1",
      "aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd",
    );
    expect(form!.isEncrypted).toBe(true);
    expect(form!.fields).toHaveLength(1);
    expect(form!.fields[0].label).toBe("Secret Q");
    // legacy events keep settings in the outer tag
    expect(form!.settings.description).toBe("outer desc");
  });
});

describe("fetchForm — encrypted, no viewKey", () => {
  it("detects encryption from non-empty content with no field tags (upstream shape)", async () => {
    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "eid",
      pubkey: "formpub",
      kind: 30168,
      created_at: 1000,
      sig: "sig",
      content: "enc_blob",
      tags: [
        ["d", "form1"],
        ["name", "Enc Form"],
      ],
    } satisfies Event);

    const form = await fetchForm("formpub", "form1");
    expect(form!.isEncrypted).toBe(true);
    expect(form!.fields).toHaveLength(0);
  });
});

// ── fetchResponses ────────────────────────────────────────────

describe("fetchResponses — plain", () => {
  it("returns responses with fieldId/answer populated, wasEncrypted=false", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "r1",
        pubkey: "respondent",
        kind: 1069,
        created_at: 2000,
        sig: "sig",
        content: "",
        tags: [
          ["a", "30168:formpub:form1"],
          ["response", "f1", "Alice", ""],
        ],
      } satisfies Event,
    ]);

    const responses = await fetchResponses("formpub", "form1");
    expect(responses).toHaveLength(1);
    expect(responses[0].responses[0].answer).toBe("Alice");
    expect(responses[0].wasEncrypted).toBe(false);
  });
});

describe("fetchResponses — encrypted, with signingKey", () => {
  it("decrypts response content using signing key signer", async () => {
    const mockFormSigner = {
      nip44Decrypt: vi
        .fn()
        .mockResolvedValue(JSON.stringify([["response", "f1", "Secret answer", ""]])),
    };
    (LocalSigner as any).mockImplementationOnce(() => mockFormSigner);

    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "r1",
        pubkey: "respondent",
        kind: 1069,
        created_at: 2000,
        sig: "sig",
        content: "enc_resp",
        tags: [["a", "30168:formpub:form1"]],
      } satisfies Event,
    ]);

    const responses = await fetchResponses(
      "formpub",
      "form1",
      "aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd",
    );
    expect(responses[0].responses[0].answer).toBe("Secret answer");
    expect(mockFormSigner.nip44Decrypt).toHaveBeenCalledWith("respondent", "enc_resp");
  });
});

describe("fetchResponses — encrypted, no signingKey", () => {
  it("returns wasEncrypted=true with empty responses array", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "r1",
        pubkey: "respondent",
        kind: 1069,
        created_at: 2000,
        sig: "sig",
        content: "enc_resp",
        tags: [["a", "30168:formpub:form1"]],
      } satisfies Event,
    ]);

    const responses = await fetchResponses("formpub", "form1");
    expect(responses[0].wasEncrypted).toBe(true);
    expect(responses[0].responses).toHaveLength(0);
  });
});

// ── form-relay targeting (template ["relay"] hints) ───────────

describe("response paths honor the form's relay hints", () => {
  it("submitResponse publishes to formRelays ∪ module relays", async () => {
    await submitResponse(
      "formpub",
      "form1",
      [{ fieldId: "f1", answer: "A" }],
      false,
      undefined,
      ["wss://custom.relay", "wss://relay.test"], // overlap must dedupe
    );

    const [relays, event] = (nostrRuntime.publish as any).mock.calls[0];
    expect(event.kind).toBe(1069);
    expect([...relays].sort()).toEqual(["wss://custom.relay", "wss://relay.test"]);
  });

  it("fetchResponses queries formRelays ∪ module relays", async () => {
    await fetchResponses("formpub", "form1", undefined, ["wss://custom.relay"]);

    const [relays] = (nostrRuntime.querySync as any).mock.calls[0];
    expect([...relays].sort()).toEqual(["wss://custom.relay", "wss://relay.test"]);
  });

  it("subscribeToResponses subscribes on formRelays ∪ module relays", () => {
    (nostrRuntime.subscribe as any).mockReturnValue({ unsub: vi.fn() });

    subscribeToResponses("formpub", "form1", vi.fn(), undefined, undefined, ["wss://custom.relay"]);

    const [relays] = (nostrRuntime.subscribe as any).mock.calls[0];
    expect([...relays].sort()).toEqual(["wss://custom.relay", "wss://relay.test"]);
  });
});

// ── fetchMyForms ──────────────────────────────────────────────

describe("fetchMyForms — parses tag-tuples and returns keys", () => {
  it("returns FormSummary[] with signingKey and viewKey from kind-14083", async () => {
    // 1st querySync call = kind-14083 list read (newest-wins); 2nd = batch form events
    (nostrRuntime.querySync as any)
      .mockResolvedValueOnce([
        {
          id: "list",
          pubkey: "aabbccdd",
          kind: 14083,
          created_at: 1000,
          sig: "sig",
          content: "enc_list",
          tags: [],
        } satisfies Event,
      ])
      .mockResolvedValueOnce([
        {
          id: "fe",
          pubkey: "formpub",
          kind: 30168,
          created_at: 1000,
          sig: "sig",
          content: "enc",
          tags: [
            ["d", "form1"],
            ["name", "Enc Form"],
            ["encryption", "view-key"],
          ],
        } satisfies Event,
      ]);
    (nip44SelfDecrypt as any).mockResolvedValue(
      JSON.stringify([["f", "formpub:form1", "wss://relay.test", "sigKey:viewKey"]]),
    );

    const forms = await fetchMyForms();
    expect(forms).toHaveLength(1);
    expect(forms[0].signingKey).toBe("sigKey");
    expect(forms[0].viewKey).toBe("viewKey");
    expect(forms[0].isEncrypted).toBe(true);
    // relay hint from entry[2] survives (formstr.app's retry path uses it)
    expect(forms[0].relay).toBe("wss://relay.test");
  });
});

// ── fetchMyForms — newest-wins (anti-staleness) ───────────────

describe("fetchMyForms — picks the newest kind-14083 across relays", () => {
  it("uses the list event with the highest created_at when relays diverge", async () => {
    (nostrRuntime.querySync as any)
      .mockResolvedValueOnce([
        {
          id: "stale",
          pubkey: "aabbccdd",
          kind: 14083,
          created_at: 1000,
          sig: "s",
          content: "stale_enc",
          tags: [],
        },
        {
          id: "fresh",
          pubkey: "aabbccdd",
          kind: 14083,
          created_at: 2000,
          sig: "s",
          content: "fresh_enc",
          tags: [],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "fe",
          pubkey: "formpub",
          kind: 30168,
          created_at: 2000,
          sig: "s",
          content: "",
          tags: [
            ["d", "newform"],
            ["name", "Fresh Form"],
            ["field", "f1", "shortText", "Q", "[]", "{}"],
          ],
        },
      ]);
    (nip44SelfDecrypt as any).mockImplementation((_s: unknown, content: string) =>
      Promise.resolve(
        content === "fresh_enc"
          ? JSON.stringify([["f", "formpub:newform", "", ""]])
          : JSON.stringify([["f", "formpub:oldform", "", ""]]),
      ),
    );

    const forms = await fetchMyForms();
    // Decrypted the FRESH list, not the stale one
    expect(nip44SelfDecrypt).toHaveBeenCalledWith(mockSigner, "fresh_enc");
    expect(forms.map((f) => f.id)).toEqual(["newform"]);
  });
});

// ── deleteForm ────────────────────────────────────────────────

describe("deleteForm", () => {
  it("publishes kind-5 with correct a-tag and k-tag", async () => {
    await deleteForm("form1", "formpub");
    const [, event] = (nostrRuntime.publish as any).mock.calls[0];
    expect(event.kind).toBe(5);
    expect(event.tags).toContainEqual(["a", "30168:formpub:form1"]);
    expect(event.tags).toContainEqual(["k", "30168"]);
  });

  it("republishes the trimmed kind-14083 so the delete sticks (other entries verbatim)", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "list",
        pubkey: "aabbccdd",
        kind: 14083,
        created_at: 1000,
        sig: "s",
        content: "enc_list",
        tags: [],
      },
    ]);
    (nip44SelfDecrypt as any).mockResolvedValue(
      JSON.stringify([
        ["f", "formpub:form1", "wss://a.relay", "sk1:vk1"],
        ["f", "otherpub:form9", "wss://b.relay", "sk9:vk9"],
      ]),
    );
    (nip44SelfEncrypt as any).mockResolvedValue("enc_trimmed");

    await deleteForm("form1", "formpub");

    const listPublishes = (nostrRuntime.publish as any).mock.calls.filter(
      (c: any[]) => c[1]?.kind === 14083,
    );
    expect(listPublishes).toHaveLength(1);
    const written = JSON.parse((nip44SelfEncrypt as any).mock.calls[0][1]);
    // deleted entry gone; the survivor keeps its relay + key segments byte-for-byte
    expect(written).toEqual([["f", "otherpub:form9", "wss://b.relay", "sk9:vk9"]]);
  });

  it("skips the list republish when no kind-14083 exists (nothing to trim)", async () => {
    await deleteForm("form1", "formpub");
    const listPublishes = (nostrRuntime.publish as any).mock.calls.filter(
      (c: any[]) => c[1]?.kind === 14083,
    );
    expect(listPublishes).toHaveLength(0);
  });
});

// ── saveToMyForms ─────────────────────────────────────────────

describe("saveToMyForms", () => {
  it("serialises FormSummary[] as tag-tuples, preserving relay hints", async () => {
    (nip44SelfEncrypt as any).mockResolvedValue("enc_list");

    await saveToMyForms([
      {
        id: "f1",
        name: "Form",
        pubkey: "pub1",
        createdAt: 0,
        isEncrypted: true,
        signingKey: "sk",
        viewKey: "vk",
        relay: "wss://hint.relay",
      },
      { id: "f2", name: "Public", pubkey: "pub2", createdAt: 0, isEncrypted: false },
    ]);

    expect(nip44SelfEncrypt).toHaveBeenCalledWith(mockSigner, expect.stringContaining("pub1:f1"));
    const entries = JSON.parse((nip44SelfEncrypt as any).mock.calls[0][1]);
    // relay slot is no longer blanked — formstr.app's retry path reads it
    expect(entries[0]).toEqual(["f", "pub1:f1", "wss://hint.relay", "sk:vk"]);
    expect(entries[1]).toEqual(["f", "pub2:f2", "", ""]);
    const [, event] = (nostrRuntime.publish as any).mock.calls[0];
    expect(event.kind).toBe(14083);
  });
});

// ── fetchMyForms — fallback to author query ───────────────────

describe("fetchMyForms — fallback to author query", () => {
  it("calls querySync by author when no kind-14083 event exists", async () => {
    // 1st querySync = kind-14083 list read → none; falls back to author query (2nd querySync)
    (nostrRuntime.querySync as any).mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "fe",
        pubkey: "aabbccdd",
        kind: 30168,
        created_at: 1000,
        sig: "sig",
        content: "",
        tags: [
          ["d", "form1"],
          ["name", "Plain Form"],
          ["field", "f1", "shortText", "Q", "[]", "{}"],
        ],
      } satisfies Event,
    ]);

    const forms = await fetchMyForms();
    expect(forms).toHaveLength(1);
    expect(forms[0].name).toBe("Plain Form");
    expect(forms[0].isEncrypted).toBe(false);
  });
});

// ── subscribeToResponses ──────────────────────────────────────

describe("subscribeToResponses — plain response", () => {
  it("calls onResponse immediately for plain (unencrypted) events", () => {
    const handle = { unsub: vi.fn() };
    let capturedOnEvent: ((e: Event) => void) | undefined;
    (nostrRuntime.subscribe as any).mockImplementation((_relays: any, _filters: any, opts: any) => {
      capturedOnEvent = opts.onEvent;
      return handle;
    });

    const onResponse = vi.fn();
    subscribeToResponses("formpub", "form1", onResponse);

    const event: Event = {
      id: "r1",
      pubkey: "resp",
      kind: 1069,
      created_at: 0,
      sig: "sig",
      content: "",
      tags: [
        ["a", "30168:formpub:form1"],
        ["response", "f1", "Alice", ""],
      ],
    };
    capturedOnEvent!(event);

    expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({ wasEncrypted: false }));
  });
});

// ── updateForm ────────────────────────────────────────────────

describe("updateForm — public form", () => {
  it("republishes kind-30168 with the new name and field set", async () => {
    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "eid",
      pubkey: "aabbccdd",
      kind: 30168,
      created_at: 1000,
      sig: "sig",
      content: "",
      tags: [
        ["d", "form1"],
        ["name", "Old Name"],
        ["field", "f1", "shortText", "Q", "[]", "{}"],
      ],
    } satisfies Event);

    await updateForm({
      formId: "form1",
      pubkey: "aabbccdd",
      name: "New Name",
      fields: [
        { id: "f1", type: "shortText" as any, label: "Q1" },
        { id: "f2", type: "shortText" as any, label: "Q2" },
      ],
    });

    const [, event] = (nostrRuntime.publish as any).mock.calls.at(-1);
    expect(event.kind).toBe(30168);
    expect(event.tags).toContainEqual(["name", "New Name"]);
    expect(event.tags.filter((t: string[]) => t[0] === "field")).toHaveLength(2);
    // plaintext republish keeps upstream-parity tags
    expect(event.tags).toContainEqual(["t", "public"]);
    expect(event.tags).toContainEqual(["relay", "wss://relay.test"]);
  });
});

describe("updateForm — public form with a stored signing key", () => {
  it("republishes with finalizeEvent(signingKey) so the address stays 30168:signingPub:formId", async () => {
    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "eid",
      pubkey: SIGNING_PUB,
      kind: 30168,
      created_at: 1000,
      sig: "sig",
      content: "",
      tags: [
        ["d", "form1"],
        ["name", "Old"],
        ["field", "f1", "text", "Q", "[]", "{}"],
        ["t", "public"],
      ],
    } satisfies Event);
    // my-forms entry carries the signing key (4th segment, no viewKey — public form)
    mockMyFormsList(SIGNING_HEX);

    await updateForm({ formId: "form1", pubkey: SIGNING_PUB, name: "New" });

    const [, event] = (nostrRuntime.publish as any).mock.calls.at(-1);
    expect(event.kind).toBe(30168);
    expect(event.pubkey).toBe(SIGNING_PUB); // NOT the user key — no address fork
    expect(event.sig).toBeTruthy();
    expect(event.tags).toContainEqual(["name", "New"]);
    expect(mockSigner.signEvent).not.toHaveBeenCalled();
  });
});

describe("updateForm — encrypted form", () => {
  it("re-encrypts the FULL spec and keeps outer tags free of settings/encryption", async () => {
    // fetchForm sees an upstream-shaped encrypted event
    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "eid",
      pubkey: "11".repeat(32),
      kind: 30168,
      created_at: 1000,
      sig: "sig",
      content: "enc_blob",
      tags: [
        ["d", "form1"],
        ["name", "Old"],
      ],
    } satisfies Event);
    // my-forms list lookup resolves the signing/view keys
    (nostrRuntime.querySync as any)
      .mockResolvedValueOnce([
        {
          id: "list",
          pubkey: "aabbccdd",
          kind: 14083,
          created_at: 1000,
          sig: "s",
          content: "enc_list",
          tags: [],
        },
      ])
      .mockResolvedValueOnce([]);
    (nip44SelfDecrypt as any).mockResolvedValue(
      JSON.stringify([
        ["f", `${"11".repeat(32)}:form1`, "", `${"22".repeat(32)}:${"33".repeat(32)}`],
      ]),
    );
    const mockFormSigner = { nip44Encrypt: vi.fn().mockResolvedValue("enc_spec2") };
    (LocalSigner as any).mockImplementation(() => mockFormSigner);

    await updateForm({
      formId: "form1",
      pubkey: "11".repeat(32),
      name: "New",
      fields: [{ id: "f1", type: "shortText" as any, label: "Q" }],
    });
    (LocalSigner as any).mockReset();
    (LocalSigner as any).mockImplementation(() => ({
      nip44Encrypt: vi.fn(),
      nip44Decrypt: vi.fn(),
      getPublicKey: vi.fn(),
      signEvent: vi.fn(),
    }));

    const [, event] = (nostrRuntime.publish as any).mock.calls.at(-1);
    expect(event.kind).toBe(30168);
    expect(event.content).toBe("enc_spec2");
    expect(event.tags.some((t: string[]) => t[0] === "settings")).toBe(false);
    expect(event.tags.some((t: string[]) => t[0] === "encryption")).toBe(false);
    expect(event.tags).toContainEqual(["relay", "wss://relay.test"]);

    const spec = JSON.parse(mockFormSigner.nip44Encrypt.mock.calls[0][1]) as string[][];
    expect(spec.some((t) => t[0] === "name" && t[1] === "New")).toBe(true);
    expect(spec.some((t) => t[0] === "field")).toBe(true);
  });
});

// ── shareForm ─────────────────────────────────────────────────

const SIGNING_HEX = "11".repeat(32);
const VIEW_HEX = "22".repeat(32);
const SIGNING_PUB = getPublicKey(hexToBytes(SIGNING_HEX));
const RECIPIENT_PUB = getPublicKey(hexToBytes("33".repeat(32)));
const EDITOR_PUB = getPublicKey(hexToBytes("44".repeat(32)));

const formAlias = (author: string, formId: string, recipient: string) =>
  bytesToHex(sha256(`30168:${author}:${formId}:${recipient}`));

/** Mock the kind-14083 round-trip so fetchMyForms resolves the form's keys. */
function mockMyFormsList(keySegment: string) {
  (nostrRuntime.querySync as any)
    .mockResolvedValueOnce([
      {
        id: "list",
        pubkey: "aabbccdd",
        kind: 14083,
        created_at: 1000,
        sig: "s",
        content: "enc_list",
        tags: [],
      },
    ])
    .mockResolvedValueOnce([]);
  (nip44SelfDecrypt as any).mockResolvedValue(
    JSON.stringify([["f", `${SIGNING_PUB}:form1`, "wss://relay.test", keySegment]]),
  );
}

describe("shareForm — upstream access-grant wraps (kind-18 rumor, alias-addressed 1059)", () => {
  it("publishes one wrap per recipient, p-tagged with the sha256 alias, timestamps un-randomized", async () => {
    mockMyFormsList(`${SIGNING_HEX}:${VIEW_HEX}`);
    (LocalSigner as any).mockImplementation(() => ({
      nip44Encrypt: vi.fn().mockResolvedValue("enc"),
    }));

    const result = await shareForm({
      formId: "form1",
      formPubkey: SIGNING_PUB,
      recipients: [RECIPIENT_PUB],
      editors: [EDITOR_PUB],
    });

    (LocalSigner as any).mockImplementation(() => ({
      nip44Encrypt: vi.fn(),
      nip44Decrypt: vi.fn(),
      getPublicKey: vi.fn(),
      signEvent: vi.fn(),
    }));

    expect(result).toEqual({ published: 2, failed: [] });
    const wraps = (nostrRuntime.publish as any).mock.calls.filter(
      (c: any[]) => c[1]?.kind === 1059,
    );
    expect(wraps).toHaveLength(2);

    const now = Math.floor(Date.now() / 1000);
    const pTags = wraps.map((c: any[]) => c[1].tags[0]);
    expect(pTags).toContainEqual(["p", formAlias(SIGNING_PUB, "form1", RECIPIENT_PUB)]);
    expect(pTags).toContainEqual(["p", formAlias(SIGNING_PUB, "form1", EDITOR_PUB)]);
    for (const [relays, wrap] of wraps) {
      // upstream's fetchKeys filter is alias-only; timestamps are NOT randomized
      expect(Math.abs(wrap.created_at - now)).toBeLessThan(30);
      // ephemeral wrap key — never the signing key, never the user key
      expect(wrap.pubkey).not.toBe(SIGNING_PUB);
      expect(wrap.pubkey).not.toBe("aabbccdd");
      expect(relays).toEqual(["wss://relay.test"]);
    }
  });

  it("throws when the user does not hold the form keys", async () => {
    await expect(shareForm({ formId: "nope", formPubkey: "x", recipients: ["a"] })).rejects.toThrow(
      "form keys",
    );
  });
});

// ── fetchFormKeys (inbound access grants) ─────────────────────

describe("fetchFormKeys — reads alias-addressed wraps back to view/signing keys", () => {
  it("queries kind-1059 by sha256 alias and unwraps wrap→seal→rumor", async () => {
    (signerManager.getSignerIfAvailable as any).mockReturnValue(mockSigner);
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "w1",
        pubkey: "wrappub",
        kind: 1059,
        created_at: 0,
        sig: "s",
        content: "wrap_enc",
        tags: [["p", "alias"]],
      },
    ]);
    mockSigner.nip44Decrypt
      .mockResolvedValueOnce(JSON.stringify({ pubkey: "sealpub", content: "seal_enc" }))
      .mockResolvedValueOnce(
        JSON.stringify({
          kind: 18,
          pubkey: SIGNING_PUB,
          tags: [
            ["EditAccess", SIGNING_HEX],
            ["ViewAccess", VIEW_HEX],
          ],
        }),
      );

    const keys = await fetchFormKeys(SIGNING_PUB, "form1");

    expect(keys).toEqual({ viewKey: VIEW_HEX, signingKey: SIGNING_HEX });
    const [, filter] = (nostrRuntime.querySync as any).mock.calls[0];
    expect(filter.kinds).toEqual([1059]);
    expect(filter["#p"]).toEqual([formAlias(SIGNING_PUB, "form1", "aabbccdd")]);
    expect(mockSigner.nip44Decrypt).toHaveBeenNthCalledWith(1, "wrappub", "wrap_enc");
    expect(mockSigner.nip44Decrypt).toHaveBeenNthCalledWith(2, "sealpub", "seal_enc");
  });

  it("returns null without a signer (read path must not pop the login modal)", async () => {
    const keys = await fetchFormKeys(SIGNING_PUB, "form1");
    expect(keys).toBeNull();
    expect(nostrRuntime.querySync).not.toHaveBeenCalled();
  });
});

describe("fetchForm — discovers the view key from inbound access grants", () => {
  it("decrypts an encrypted form without an explicit viewKey when a grant exists", async () => {
    (signerManager.getSignerIfAvailable as any).mockReturnValue(mockSigner);
    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "eid",
      pubkey: SIGNING_PUB,
      kind: 30168,
      created_at: 1000,
      sig: "sig",
      content: "enc_blob",
      tags: [
        ["d", "form1"],
        ["name", "Shared Form"],
      ],
    } satisfies Event);
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "w1",
        pubkey: "wrappub",
        kind: 1059,
        created_at: 0,
        sig: "s",
        content: "wrap_enc",
        tags: [["p", "alias"]],
      },
    ]);
    mockSigner.nip44Decrypt
      .mockResolvedValueOnce(JSON.stringify({ pubkey: "sealpub", content: "seal_enc" }))
      .mockResolvedValueOnce(JSON.stringify({ kind: 18, tags: [["ViewAccess", VIEW_HEX]] }));
    const mockViewSigner = {
      nip44Decrypt: vi
        .fn()
        .mockResolvedValue(JSON.stringify([["field", "f1", "text", "Granted Q", "[]", "{}"]])),
    };
    (LocalSigner as any).mockImplementationOnce(() => mockViewSigner);

    const form = await fetchForm(SIGNING_PUB, "form1");

    expect(form!.fields).toHaveLength(1);
    expect(form!.fields[0].label).toBe("Granted Q");
    expect(mockViewSigner.nip44Decrypt).toHaveBeenCalledWith(SIGNING_PUB, "enc_blob");
  });
});

// ── fetchFormSummaryFromRef / importForm ──────────────────────

describe("fetchFormSummaryFromRef", () => {
  it("returns null when the form is not found", async () => {
    (nostrRuntime.fetchOne as any).mockResolvedValue(null);
    expect(await fetchFormSummaryFromRef("pub", "id")).toBeNull();
  });

  it("returns a summary for a found form", async () => {
    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "eid",
      pubkey: "formpub",
      kind: 30168,
      created_at: 1000,
      sig: "s",
      content: "",
      tags: [
        ["d", "form1"],
        ["name", "My Form"],
        ["field", "f1", "shortText", "Q", "[]", "{}"],
      ],
    } satisfies Event);

    const s = await fetchFormSummaryFromRef("formpub", "form1");
    expect(s).toMatchObject({
      id: "form1",
      name: "My Form",
      pubkey: "formpub",
      isEncrypted: false,
    });
  });
});

describe("importForm", () => {
  it("appends a new form to the kind-14083 list", async () => {
    (nip44SelfEncrypt as any).mockResolvedValue("enc_list");

    await importForm({
      id: "f9",
      name: "Imported",
      pubkey: "pubX",
      createdAt: 0,
      isEncrypted: false,
    });

    const listPublishes = (nostrRuntime.publish as any).mock.calls.filter(
      (c: any[]) => c[1]?.kind === 14083,
    );
    expect(listPublishes.length).toBeGreaterThanOrEqual(1);
    expect(nip44SelfEncrypt).toHaveBeenCalledWith(mockSigner, expect.stringContaining("pubX:f9"));
  });
});

describe("subscribeToResponses — encrypted response, with signingKey", () => {
  it("decrypts and calls onResponse with answers", async () => {
    const handle = { unsub: vi.fn() };
    let capturedOnEvent: ((e: Event) => void) | undefined;
    (nostrRuntime.subscribe as any).mockImplementation((_relays: any, _filters: any, opts: any) => {
      capturedOnEvent = opts.onEvent;
      return handle;
    });

    const mockFormSigner = {
      nip44Decrypt: vi.fn().mockResolvedValue(JSON.stringify([["response", "f1", "Secret", ""]])),
    };
    (LocalSigner as any).mockImplementationOnce(() => mockFormSigner);

    const onResponse = vi.fn();
    subscribeToResponses(
      "formpub",
      "form1",
      onResponse,
      undefined,
      "aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd",
    );

    const event: Event = {
      id: "r1",
      pubkey: "resp",
      kind: 1069,
      created_at: 0,
      sig: "sig",
      content: "enc_resp",
      tags: [["a", "30168:formpub:form1"]],
    };
    capturedOnEvent!(event);

    // Wait for async decrypt to resolve
    await new Promise((r) => setTimeout(r, 10));

    expect(onResponse).toHaveBeenCalledWith(
      expect.objectContaining({ responses: [expect.objectContaining({ answer: "Secret" })] }),
    );
  });
});
