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
  signerManager,
  nostrRuntime,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
  LocalSigner,
} from "@formstr/core";

import { createForm, fetchForm, fetchResponses, fetchMyForms, deleteForm } from "./service";

const mockSigner = {
  getPublicKey: vi.fn().mockResolvedValue("aabbccdd"),
  signEvent: vi
    .fn()
    .mockImplementation((e: any) =>
      Promise.resolve({ ...e, id: "eid", sig: "sig", pubkey: "aabbccdd" }),
    ),
  nip44Encrypt: vi.fn(),
  nip44Decrypt: vi.fn(),
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

    // kind-14083 published
    const listEvent = calls[1][1];
    expect(listEvent.kind).toBe(14083);
    expect(nip44SelfEncrypt).toHaveBeenCalledWith(
      mockSigner,
      expect.stringContaining(result.signingKey!),
    );
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
    (nostrRuntime.fetchOne as any).mockResolvedValueOnce({
      id: "list",
      pubkey: "aabbccdd",
      kind: 14083,
      created_at: 1000,
      sig: "sig",
      content: "enc_list",
      tags: [],
    } satisfies Event);
    (nip44SelfDecrypt as any).mockResolvedValue(
      JSON.stringify([["f", "formpub:form1", "wss://relay.test", "sigKey:viewKey"]]),
    );
    (nostrRuntime.querySync as any).mockResolvedValue([
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

    const forms = await fetchMyForms();
    expect(forms).toHaveLength(1);
    expect(forms[0].signingKey).toBe("sigKey");
    expect(forms[0].viewKey).toBe("viewKey");
    expect(forms[0].isEncrypted).toBe(true);
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
