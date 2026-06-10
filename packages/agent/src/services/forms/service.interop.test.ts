import { generateSecretKey, getPublicKey } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Partial mock: real crypto (LocalSigner / NIP-44), stub only the network surface.
vi.mock("@formstr/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    nostrRuntime: {
      publish: vi.fn(),
      fetchOne: vi.fn(),
      querySync: vi.fn(),
      subscribe: vi.fn(),
    },
    relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.test"]) },
  };
});

import { LocalSigner, nostrRuntime } from "@formstr/core";
import type { Event } from "nostr-tools";

import { fetchForm } from "./service";

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
