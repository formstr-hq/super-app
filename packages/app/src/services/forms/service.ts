import {
  signerManager,
  nostrRuntime,
  relayManager,
  nip44Encrypt,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
} from "@formstr/core";
import type { SubscriptionHandle } from "@formstr/core";
import type { EventTemplate, Event, Filter } from "nostr-tools";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";

import {
  FORM_KINDS,
  type FormField,
  type FormSettings,
  type FormTemplate,
  type FormResponse,
  type FormResponseEvent,
  type FormSummary,
} from "./types";

// ── Create Form ─────────────────────────────────────────

export interface CreateFormParams {
  name: string;
  fields: FormField[];
  settings?: FormSettings;
  encrypt?: boolean;
}

export interface CreateFormResult {
  formId: string;
  pubkey: string;
  signingKey?: string;
  viewKey?: string;
}

export async function createForm(params: CreateFormParams): Promise<CreateFormResult> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const formId = crypto.randomUUID().slice(0, 8);

  // Build NIP-101 tag array
  const tags: string[][] = [
    ["d", formId],
    ["name", params.name],
  ];

  if (params.settings) {
    tags.push(["settings", JSON.stringify(params.settings)]);
  }

  for (const field of params.fields) {
    const options = field.options
      ? JSON.stringify(field.options.map((o) => [o.id, o.label]))
      : "[]";
    const config = JSON.stringify({ required: field.required, placeholder: field.placeholder });
    tags.push(["field", field.id, field.type, field.label, options, config]);
  }

  if (params.settings?.publicForm) {
    tags.push(["t", "public"]);
  }

  let content = "";
  let signingKeyHex: string | undefined;
  let viewKeyHex: string | undefined;

  if (params.encrypt) {
    // Generate signing keypair for encrypted form
    const signingKey = generateSecretKey();
    signingKeyHex = bytesToHex(signingKey);
    const signingPubkey = getPublicKey(signingKey);

    // Generate view key for content encryption
    const viewKey = generateSecretKey();
    viewKeyHex = bytesToHex(viewKey);
    const viewPubkey = getPublicKey(viewKey);

    // Encrypt form spec with view key (NIP-44 to view pubkey)
    content = await nip44Encrypt(
      signer,
      viewPubkey,
      JSON.stringify(tags.filter((t) => t[0] === "field")),
    );

    // Publish with signing key
    const event: EventTemplate = {
      kind: FORM_KINDS.template,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["d", formId],
        ["name", params.name],
      ],
      content,
    };

    const signed = finalizeEvent(event, signingKey);
    const relays = relayManager.getRelaysForModule("forms");
    await nostrRuntime.publish(relays, signed);

    return { formId, pubkey: signingPubkey, signingKey: signingKeyHex, viewKey: viewKeyHex };
  }

  // Unencrypted form
  const event: EventTemplate = {
    kind: FORM_KINDS.template,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };

  const signed = await signer.signEvent(event);
  const relays = relayManager.getRelaysForModule("forms");
  await nostrRuntime.publish(relays, signed);

  return { formId, pubkey };
}

// ── Fetch Form ──────────────────────────────────────────

export async function fetchForm(pubkey: string, formId: string): Promise<FormTemplate | null> {
  const relays = relayManager.getRelaysForModule("forms");
  const filter: Filter = {
    kinds: [FORM_KINDS.template],
    authors: [pubkey],
    "#d": [formId],
    limit: 1,
  };

  const event = await nostrRuntime.fetchOne(relays, filter);
  if (!event) return null;

  const template = parseFormEvent(event);

  // Attempt to decrypt encrypted forms if we are the author
  if (template.isEncrypted && event.content) {
    try {
      const signer = await signerManager.getSigner();
      const decrypted = await nip44SelfDecrypt(signer, event.content);
      const fieldTags = JSON.parse(decrypted) as string[][];
      template.fields = fieldTags
        .filter((t) => t[0] === "field")
        .map((t) => ({
          id: t[1],
          type: t[2] as FormField["type"],
          label: t[3],
          options: t[4] ? safeParseOptions(t[4]) : undefined,
          required: t[5] ? JSON.parse(t[5])?.required : undefined,
        }));
    } catch {
      // Decryption failed — user may not be the author, fields stay empty
    }
  }

  return template;
}

// ── Submit Response ─────────────────────────────────────

export async function submitResponse(
  formPubkey: string,
  formId: string,
  responses: FormResponse[],
  encrypt = false,
): Promise<void> {
  const signer = await signerManager.getSigner();

  const responseTags = responses.map((r) => ["response", r.fieldId, r.answer, r.metadata ?? ""]);
  const tags: string[][] = [
    ["a", `${FORM_KINDS.template}:${formPubkey}:${formId}`],
    ...responseTags,
  ];

  let content = "";
  if (encrypt) {
    content = await nip44Encrypt(signer, formPubkey, JSON.stringify(responseTags));
    // Remove inline response tags when encrypted
    tags.length = 1;
  }

  const event: EventTemplate = {
    kind: FORM_KINDS.response,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };

  const signed = await signer.signEvent(event);
  const relays = relayManager.getRelaysForModule("forms");
  await nostrRuntime.publish(relays, signed);
}

// ── Fetch Responses ─────────────────────────────────────

export function subscribeToResponses(
  formPubkey: string,
  formId: string,
  onResponse: (response: FormResponseEvent) => void,
  onEose?: () => void,
): SubscriptionHandle {
  const relays = relayManager.getRelaysForModule("forms");
  const filter: Filter = {
    kinds: [FORM_KINDS.response],
    "#a": [`${FORM_KINDS.template}:${formPubkey}:${formId}`],
  };

  return nostrRuntime.subscribe(relays, [filter], {
    onEvent: (event: Event) => {
      const parsed = parseResponseEvent(event);
      if (parsed) onResponse(parsed);
    },
    onEose,
  });
}

export async function fetchResponses(
  formPubkey: string,
  formId: string,
): Promise<FormResponseEvent[]> {
  const relays = relayManager.getRelaysForModule("forms");
  const filter: Filter = {
    kinds: [FORM_KINDS.response],
    "#a": [`${FORM_KINDS.template}:${formPubkey}:${formId}`],
  };

  const events = await nostrRuntime.querySync(relays, filter);
  return events
    .map(parseResponseEvent)
    .filter((r: FormResponseEvent | null): r is FormResponseEvent => r !== null);
}

// ── My Forms List (kind 14083) ──────────────────────────

/** Reference stored in the encrypted tag array */
interface FormRef {
  pubkey: string;
  formId: string;
  relay?: string;
  secretKey?: string;
  viewKey?: string;
}

/**
 * Fetch the user's form list.
 * The encrypted content is a JSON array of tag tuples:
 *   ["f", "pubkey:formId", relay, "secret:viewKey"]
 */
export async function fetchMyForms(): Promise<FormSummary[]> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const relays = relayManager.getRelaysForModule("forms");

  const filter: Filter = {
    kinds: [FORM_KINDS.myFormsList],
    authors: [pubkey],
    limit: 1,
  };

  const event = await nostrRuntime.fetchOne(relays, filter);
  if (!event || !event.content) {
    // Fallback: query kind 30168 by author to discover forms
    return fetchMyFormsByAuthor(pubkey, relays);
  }

  try {
    const decrypted = await nip44SelfDecrypt(signer, event.content);
    const raw = JSON.parse(decrypted) as unknown;

    // Already structured objects (from our own saveToMyForms)
    if (
      Array.isArray(raw) &&
      raw.length > 0 &&
      typeof raw[0] === "object" &&
      !Array.isArray(raw[0])
    ) {
      return raw as FormSummary[];
    }

    // Tag-tuple format from the original formstr app
    const tags = raw as string[][];
    const refs: FormRef[] = tags
      .filter((t) => t[0] === "f" && t[1])
      .map((t) => {
        const [refPubkey, formId] = t[1].split(":");
        const keys = t[3]?.split(":") ?? [];
        return { pubkey: refPubkey, formId, relay: t[2], secretKey: keys[0], viewKey: keys[1] };
      });

    if (refs.length === 0) return [];

    // Batch-fetch form events to get names + metadata
    const formFilter: Filter = {
      kinds: [FORM_KINDS.template],
      authors: refs.map((r) => r.pubkey),
    };
    const formEvents = await nostrRuntime.querySync(relays, formFilter);

    const eventMap = new Map<string, Event>();
    for (const e of formEvents) {
      const dTag = e.tags.find((t: string[]) => t[0] === "d")?.[1];
      if (dTag) eventMap.set(`${e.pubkey}:${dTag}`, e);
    }

    return refs.map((ref) => {
      const evt = eventMap.get(`${ref.pubkey}:${ref.formId}`);
      const name = evt?.tags.find((t: string[]) => t[0] === "name")?.[1] ?? "Untitled";
      return {
        id: ref.formId,
        name,
        pubkey: ref.pubkey,
        createdAt: evt?.created_at ?? 0,
        isEncrypted:
          (evt?.content?.length ?? 0) > 0 &&
          (evt?.tags.filter((t: string[]) => t[0] === "field").length ?? 0) === 0,
      };
    });
  } catch {
    return [];
  }
}

export async function saveToMyForms(forms: FormSummary[]): Promise<void> {
  const signer = await signerManager.getSigner();
  const encrypted = await nip44SelfEncrypt(signer, JSON.stringify(forms));

  const event: EventTemplate = {
    kind: FORM_KINDS.myFormsList,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: encrypted,
  };

  const signed = await signer.signEvent(event);
  const relays = relayManager.getRelaysForModule("forms");
  await nostrRuntime.publish(relays, signed);
}

// ── Fallback: discover forms by author ──────────────────

async function fetchMyFormsByAuthor(pubkey: string, relays: string[]): Promise<FormSummary[]> {
  const filter: Filter = {
    kinds: [FORM_KINDS.template],
    authors: [pubkey],
  };
  const events = await nostrRuntime.querySync(relays, filter);
  return events.map((evt: Event) => {
    const dTag = evt.tags.find((t: string[]) => t[0] === "d")?.[1] ?? "";
    const name = evt.tags.find((t: string[]) => t[0] === "name")?.[1] ?? "Untitled";
    const hasFieldTags = evt.tags.some((t: string[]) => t[0] === "field");
    return {
      id: dTag,
      name,
      pubkey: evt.pubkey,
      createdAt: evt.created_at,
      isEncrypted: evt.content.length > 0 && !hasFieldTags,
    };
  });
}

// ── Delete Form ─────────────────────────────────────────

export async function deleteForm(formId: string, formPubkey: string): Promise<void> {
  const signer = await signerManager.getSigner();
  const coordinate = `${FORM_KINDS.template}:${formPubkey}:${formId}`;

  const event: EventTemplate = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["a", coordinate],
      ["k", String(FORM_KINDS.template)],
    ],
    content: "Deleted via Formstr",
  };

  const signed = await signer.signEvent(event);
  const relays = relayManager.getRelaysForModule("forms");
  await nostrRuntime.publish(relays, signed);
}

// ── Helpers ─────────────────────────────────────────────

function parseFormEvent(event: Event): FormTemplate {
  const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  const nameTag = event.tags.find((t) => t[0] === "name")?.[1] ?? "Untitled";
  const settingsTag = event.tags.find((t) => t[0] === "settings")?.[1];

  const fields: FormField[] = event.tags
    .filter((t) => t[0] === "field")
    .map((t) => ({
      id: t[1],
      type: t[2] as FormField["type"],
      label: t[3],
      options: t[4] ? safeParseOptions(t[4]) : undefined,
      required: t[5] ? JSON.parse(t[5])?.required : undefined,
    }));

  return {
    id: dTag,
    name: nameTag,
    fields,
    settings: settingsTag ? JSON.parse(settingsTag) : {},
    pubkey: event.pubkey,
    createdAt: event.created_at,
    isEncrypted: event.content.length > 0 && fields.length === 0,
    event,
  };
}

function parseResponseEvent(event: Event): FormResponseEvent | null {
  const responses: FormResponse[] = event.tags
    .filter((t) => t[0] === "response")
    .map((t) => ({ fieldId: t[1], answer: t[2], metadata: t[3] }));

  return {
    id: event.id,
    pubkey: event.pubkey,
    responses,
    createdAt: event.created_at,
    event,
  };
}

function safeParseOptions(json: string): FormTemplate["fields"][0]["options"] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return undefined;
    return arr.map((o: [string, string]) => ({ id: o[0], label: o[1] }));
  } catch {
    return undefined;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
