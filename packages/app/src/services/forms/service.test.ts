import {
  signerManager,
  nostrRuntime,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
  LocalSigner,
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
  subscribeToResponses,
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
});

describe("createForm — encrypted form", () => {
  it("encrypts fields with formSigner, adds encryption tag, persists keys to kind-14083", async () => {
    const mockFormSigner = { nip44Encrypt: vi.fn().mockResolvedValue("enc_fields") };
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
    expect(formEvent.content).toBe("enc_fields");
    expect(formEvent.tags.some((t: string[]) => t[0] === "encryption" && t[1] === "view-key")).toBe(
      true,
    );

    // formSigner.nip44Encrypt was called with viewPubkey and the field JSON
    expect(mockFormSigner.nip44Encrypt).toHaveBeenCalledWith(
      expect.any(String), // viewPubkey
      expect.stringContaining('"field"'),
    );

    // kind-14083 published with NIP-44 self-encryption, keys serialised in payload
    const listEvent = calls[1][1];
    expect(listEvent.kind).toBe(14083);
    expect(nip44SelfEncrypt).toHaveBeenCalledWith(
      mockSigner,
      expect.stringContaining(result.signingKey!),
    );
  });

  it("includes a settings tag on the encrypted form event", async () => {
    const mockFormSigner = { nip44Encrypt: vi.fn().mockResolvedValue("enc_fields") };
    (LocalSigner as any).mockImplementationOnce(() => mockFormSigner);

    await createForm({
      name: "Secret",
      fields: [{ id: "f1", type: "shortText" as any, label: "Q" }],
      settings: { thankYouText: "Cheers", disallowAnonymous: true },
      encrypt: true,
    });

    const formEvent = (nostrRuntime.publish as any).mock.calls[0][1];
    const settingsTag = formEvent.tags.find((t: string[]) => t[0] === "settings");
    expect(settingsTag).toBeTruthy();
    expect(JSON.parse(settingsTag[1])).toMatchObject({ thankYouText: "Cheers" });
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
});

describe("fetchForm — encrypted, correct viewKey", () => {
  it("decrypts fields using view key signer", async () => {
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
      ],
    } satisfies Event);

    const form = await fetchForm(
      "formpub",
      "form1",
      "aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd",
    );
    expect(form!.fields).toHaveLength(1);
    expect(form!.fields[0].label).toBe("Secret Q");
    expect(mockViewSigner.nip44Decrypt).toHaveBeenCalledWith("formpub", "enc_blob");
  });
});

describe("fetchForm — encrypted, no viewKey", () => {
  it("returns isEncrypted=true with empty fields", async () => {
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
        { id: "stale", pubkey: "aabbccdd", kind: 14083, created_at: 1000, sig: "s", content: "stale_enc", tags: [] },
        { id: "fresh", pubkey: "aabbccdd", kind: 14083, created_at: 2000, sig: "s", content: "fresh_enc", tags: [] },
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
    (nostrRuntime.querySync as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
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
