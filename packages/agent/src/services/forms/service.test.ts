import {
  signerManager,
  nostrRuntime,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
  LocalSigner,
  wrapManyEvents,
} from "@formstr/core";
import type { Event } from "nostr-tools";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
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
  wrapManyEvents: vi.fn(),
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
  (nostrRuntime.publish as any).mockResolvedValue(undefined);
  (nostrRuntime.fetchOne as any).mockResolvedValue(null);
  (nostrRuntime.querySync as any).mockResolvedValue([]);
});

// ── createForm ────────────────────────────────────────────────

describe("createForm — plain form", () => {
  it("publishes kind-30168 with field tags in content='' and appends to kind-14083", async () => {
    (nip44SelfEncrypt as any).mockResolvedValue("enc_list");

    const result = await createForm({
      name: "Survey",
      fields: [{ id: "f1", type: "shortText" as any, label: "Name" }],
    });

    // First publish: kind-30168
    const calls = (nostrRuntime.publish as any).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const formEvent = calls[0][1];
    expect(formEvent.kind).toBe(30168);
    expect(formEvent.content).toBe("");
    expect(formEvent.tags.some((t: string[]) => t[0] === "field")).toBe(true);
    expect(result.formId).toBeTruthy();
    expect(result.pubkey).toBe("aabbccdd");
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

    subscribeToResponses("formpub", "form1", vi.fn(), undefined, undefined, [
      "wss://custom.relay",
    ]);

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
});

// ── saveToMyForms ─────────────────────────────────────────────

describe("saveToMyForms", () => {
  it("serialises FormSummary[] as tag-tuples and publishes kind-14083", async () => {
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
      },
      { id: "f2", name: "Public", pubkey: "pub2", createdAt: 0, isEncrypted: false },
    ]);

    expect(nip44SelfEncrypt).toHaveBeenCalledWith(mockSigner, expect.stringContaining("pub1:f1"));
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

describe("shareForm — distributes the view key via NIP-59 gift-wrap", () => {
  it("publishes one wrap per recipient and reports the count", async () => {
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
      .mockResolvedValueOnce([
        {
          id: "fe",
          pubkey: "formpub",
          kind: 30168,
          created_at: 1000,
          sig: "s",
          content: "enc",
          tags: [
            ["d", "form1"],
            ["name", "Enc"],
            ["encryption", "view-key"],
          ],
        },
      ]);
    (nip44SelfDecrypt as any).mockResolvedValue(
      JSON.stringify([["f", "formpub:form1", "wss://relay.test", "sigKeyHex:viewKeyHex"]]),
    );
    (wrapManyEvents as any).mockResolvedValue([{ kind: 1059, id: "w1" }]);

    const result = await shareForm({
      formId: "form1",
      formPubkey: "formpub",
      recipients: ["recipA", "recipB"],
    });

    expect(result).toEqual({ published: 2, failed: [] });
    expect(wrapManyEvents).toHaveBeenCalledTimes(2);
    const wrapPublishes = (nostrRuntime.publish as any).mock.calls.filter(
      (c: any[]) => c[1]?.kind === 1059,
    );
    expect(wrapPublishes).toHaveLength(2);
  });

  it("throws when the user does not hold the form view key", async () => {
    await expect(shareForm({ formId: "nope", formPubkey: "x", recipients: ["a"] })).rejects.toThrow(
      "view key",
    );
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
