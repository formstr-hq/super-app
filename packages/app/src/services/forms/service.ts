import {
  signerManager,
  nostrRuntime,
  relayManager,
  nip44Encrypt,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
  LocalSigner,
} from "@formstr/core";
import type { SubscriptionHandle, NostrSigner } from "@formstr/core";
import type { EventTemplate, Event, Filter } from "nostr-tools";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";

import { encodeFormKeys, decodeFormKeys, makeViewKeySigner, makeSigningKeySigner } from "./keys";
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
  const userPubkey = await signer.getPublicKey();
  const formId = crypto.randomUUID().slice(0, 8);
  const relays = relayManager.getRelaysForModule("forms");

  const baseTags: string[][] = [
    ["d", formId],
    ["name", params.name],
  ];
  if (params.settings) baseTags.push(["settings", JSON.stringify(params.settings)]);
  for (const field of params.fields) {
    const options = field.options
      ? JSON.stringify(field.options.map((o) => [o.id, o.label]))
      : "[]";
    const config = JSON.stringify({ required: field.required, placeholder: field.placeholder });
    baseTags.push(["field", field.id, field.type, field.label, options, config]);
  }

  if (params.encrypt) {
    const signingKey = generateSecretKey();
    const signingKeyHex = bytesToHex(signingKey);
    const signingPubkey = getPublicKey(signingKey);

    const viewKey = generateSecretKey();
    const viewKeyHex = bytesToHex(viewKey);
    const viewPubkey = getPublicKey(viewKey);

    // Encrypt fields: formSigner→viewPubkey so the view key can decrypt
    const formSigner = new LocalSigner(signingKey);
    const fieldTags = baseTags.filter((t) => t[0] === "field");
    const content = await formSigner.nip44Encrypt(viewPubkey, JSON.stringify(fieldTags));

    const event: EventTemplate = {
      kind: FORM_KINDS.template,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["d", formId],
        ["name", params.name],
        ["encryption", "view-key"],
      ],
      content,
    };
    const signed = finalizeEvent(event, signingKey);
    await nostrRuntime.publish(relays, signed);

    await appendToMyFormsList(signingPubkey, formId, relays[0] ?? "", signingKeyHex, viewKeyHex);

    return { formId, pubkey: signingPubkey, signingKey: signingKeyHex, viewKey: viewKeyHex };
  }

  // Public form — user signs with their own key
  if (params.settings?.publicForm) baseTags.push(["t", "public"]);
  const event: EventTemplate = {
    kind: FORM_KINDS.template,
    created_at: Math.floor(Date.now() / 1000),
    tags: baseTags,
    content: "",
  };
  const signed = await signer.signEvent(event);
  await nostrRuntime.publish(relays, signed);

  // Public form: store pubkey:formId in list (no key segment needed)
  await appendToMyFormsList(userPubkey, formId, relays[0] ?? "", undefined, undefined);

  return { formId, pubkey: userPubkey };
}

// ── Fetch Form ──────────────────────────────────────────

export async function fetchForm(
  pubkey: string,
  formId: string,
  viewKey?: string,
): Promise<FormTemplate | null> {
  const relays = relayManager.getRelaysForModule("forms");
  const event = await nostrRuntime.fetchOne(relays, {
    kinds: [FORM_KINDS.template],
    authors: [pubkey],
    "#d": [formId],
    limit: 1,
  } as Filter);
  if (!event) return null;

  const template = parseFormEvent(event);

  if (template.isEncrypted && event.content && viewKey) {
    try {
      const viewSigner = makeViewKeySigner(viewKey);
      const decrypted = await viewSigner.nip44Decrypt(pubkey, event.content);
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
      // viewKey wrong or content malformed — leave fields empty
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
  overrideSigner?: NostrSigner,
): Promise<void> {
  const signer = overrideSigner ?? (await signerManager.getSigner());

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
  signingKey?: string,
): SubscriptionHandle {
  const relays = relayManager.getRelaysForModule("forms");
  const formSigner = signingKey ? makeSigningKeySigner(signingKey) : undefined;

  return nostrRuntime.subscribe(
    relays,
    [{ kinds: [FORM_KINDS.response], "#a": [`${FORM_KINDS.template}:${formPubkey}:${formId}`] }],
    {
      onEvent: (event: Event) => {
        const parsed = parseResponseEvent(event);
        if (!parsed.wasEncrypted || !formSigner || !event.content) {
          onResponse(parsed);
          return;
        }
        void formSigner
          .nip44Decrypt(event.pubkey, event.content)
          .then((decrypted) => {
            const tags = JSON.parse(decrypted) as string[][];
            onResponse({
              ...parsed,
              responses: tags
                .filter((t) => t[0] === "response")
                .map((t) => ({ fieldId: t[1], answer: t[2], metadata: t[3] })),
            });
          })
          .catch(() => onResponse(parsed));
      },
      onEose,
    },
  );
}

export async function fetchResponses(
  formPubkey: string,
  formId: string,
  signingKey?: string,
): Promise<FormResponseEvent[]> {
  const relays = relayManager.getRelaysForModule("forms");
  const events = await nostrRuntime.querySync(relays, {
    kinds: [FORM_KINDS.response],
    "#a": [`${FORM_KINDS.template}:${formPubkey}:${formId}`],
  } as Filter);

  const parsed = events.map(parseResponseEvent).filter((r): r is FormResponseEvent => r !== null);

  if (!signingKey) return parsed;

  const formSigner = makeSigningKeySigner(signingKey);
  return Promise.all(
    parsed.map(async (r) => {
      if (!r.wasEncrypted || !r.event.content) return r;
      try {
        const decrypted = await formSigner.nip44Decrypt(r.event.pubkey, r.event.content);
        const tags = JSON.parse(decrypted) as string[][];
        return {
          ...r,
          responses: tags
            .filter((t) => t[0] === "response")
            .map((t) => ({ fieldId: t[1], answer: t[2], metadata: t[3] })),
        };
      } catch {
        return r; // wasEncrypted=true, responses=[] — can't decrypt
      }
    }),
  );
}

// ── My Forms List (kind 14083) ──────────────────────────

export async function fetchMyForms(): Promise<FormSummary[]> {
  const signer = await signerManager.getSigner();
  const userPubkey = await signer.getPublicKey();
  const relays = relayManager.getRelaysForModule("forms");

  const listEvent = await nostrRuntime.fetchOne(relays, {
    kinds: [FORM_KINDS.myFormsList],
    authors: [userPubkey],
    limit: 1,
  } as Filter);

  let entries: string[][] = [];
  if (listEvent?.content) {
    try {
      const decrypted = await nip44SelfDecrypt(signer, listEvent.content);
      const parsed = JSON.parse(decrypted);
      entries = Array.isArray(parsed) ? parsed : [];
    } catch {
      // Fallback to author-query below
    }
  }

  if (entries.length === 0) return fetchMyFormsByAuthor(userPubkey, relays);

  // Batch-fetch form events to get names + metadata
  const dTags = entries.map((e) => e[1]?.split(":")?.[1]).filter(Boolean);
  const pubkeys = entries.map((e) => e[1]?.split(":")?.[0]).filter(Boolean);
  const formEvents = await nostrRuntime.querySync(relays, {
    kinds: [FORM_KINDS.template],
    "#d": dTags,
    authors: pubkeys,
  } as Filter);

  const eventMap = new Map<string, Event>();
  for (const evt of formEvents) {
    const d = evt.tags.find((t: string[]) => t[0] === "d")?.[1];
    if (d) eventMap.set(`${evt.pubkey}:${d}`, evt);
  }

  return entries
    .filter((e) => e[0] === "f" && e[1])
    .map((entry) => {
      const [, coordKey, , keySegment] = entry;
      const [formPubkey, formId] = coordKey.split(":");
      if (!formPubkey || !formId) return null;

      const evt = eventMap.get(coordKey);
      const name = evt?.tags.find((t: string[]) => t[0] === "name")?.[1] ?? "Untitled";
      const hasEncTag = evt?.tags.some((t: string[]) => t[0] === "encryption");
      const hasFieldTags = evt?.tags.some((t: string[]) => t[0] === "field") ?? false;
      const isEncrypted = hasEncTag || ((evt?.content?.length ?? 0) > 0 && !hasFieldTags);

      const keys = keySegment ? decodeFormKeys(keySegment) : undefined;
      const summary: FormSummary = {
        id: formId,
        name,
        pubkey: formPubkey,
        createdAt: evt?.created_at ?? 0,
        isEncrypted,
        signingKey: keys?.signingKey,
        viewKey: keys?.viewKey,
      };
      return summary;
    })
    .filter((s): s is FormSummary => s !== null);
}

/**
 * Internal: read-modify-write the user's kind-14083 list, appending one new entry.
 * Format per entry: ["f", "formPubkey:formId", relay, "signingKeyHex:viewKeyHex"]
 * Public forms omit the key segment.
 */
async function appendToMyFormsList(
  formPubkey: string,
  formId: string,
  relay: string,
  signingKeyHex?: string,
  viewKeyHex?: string,
): Promise<void> {
  const signer = await signerManager.getSigner();
  const userPubkey = await signer.getPublicKey();
  const relays = relayManager.getRelaysForModule("forms");

  const existing = await nostrRuntime.fetchOne(relays, {
    kinds: [FORM_KINDS.myFormsList],
    authors: [userPubkey],
    limit: 1,
  } as Filter);

  let entries: string[][] = [];
  if (existing?.content) {
    try {
      const decrypted = await nip44SelfDecrypt(signer, existing.content);
      const parsed = JSON.parse(decrypted);
      entries = Array.isArray(parsed) ? parsed : [];
    } catch {
      entries = [];
    }
  }

  const coordKey = `${formPubkey}:${formId}`;
  if (!entries.some((e) => e[1] === coordKey)) {
    const entry: string[] = ["f", coordKey, relay];
    if (signingKeyHex) entry.push(encodeFormKeys(signingKeyHex, viewKeyHex));
    entries.push(entry);
  }

  const encrypted = await nip44SelfEncrypt(signer, JSON.stringify(entries));
  const listEvent: EventTemplate = {
    kind: FORM_KINDS.myFormsList,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: encrypted,
  };
  const signed = await signer.signEvent(listEvent);
  await nostrRuntime.publish(relays, signed);
}

/** Public API: overwrite the user's kind-14083 list with the given summaries. */
export async function saveToMyForms(summaries: FormSummary[]): Promise<void> {
  const signer = await signerManager.getSigner();
  const relays = relayManager.getRelaysForModule("forms");

  const entries: string[][] = summaries.map((s) => {
    const entry: string[] = ["f", `${s.pubkey}:${s.id}`, ""];
    if (s.signingKey) entry.push(encodeFormKeys(s.signingKey, s.viewKey));
    return entry;
  });

  const encrypted = await nip44SelfEncrypt(signer, JSON.stringify(entries));
  const event: EventTemplate = {
    kind: FORM_KINDS.myFormsList,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: encrypted,
  };
  const signed = await signer.signEvent(event);
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
  const encTag = event.tags.find((t) => t[0] === "encryption")?.[1];

  const fields: FormField[] = event.tags
    .filter((t) => t[0] === "field")
    .map((t) => ({
      id: t[1],
      type: t[2] as FormField["type"],
      label: t[3],
      options: t[4] ? safeParseOptions(t[4]) : undefined,
      required: t[5] ? JSON.parse(t[5])?.required : undefined,
    }));

  // Explicit tag takes precedence; fall back to heuristic for old events
  const isEncrypted =
    encTag != null ? encTag === "view-key" : event.content.length > 0 && fields.length === 0;

  return {
    id: dTag,
    name: nameTag,
    fields,
    settings: settingsTag ? JSON.parse(settingsTag) : {},
    pubkey: event.pubkey,
    createdAt: event.created_at,
    isEncrypted,
    event,
  };
}

function parseResponseEvent(event: Event): FormResponseEvent {
  const responses: FormResponse[] = event.tags
    .filter((t) => t[0] === "response")
    .map((t) => ({ fieldId: t[1], answer: t[2], metadata: t[3] }));

  const isEncrypted = event.content.length > 0 && responses.length === 0;

  return {
    id: event.id,
    pubkey: event.pubkey,
    responses,
    createdAt: event.created_at,
    wasEncrypted: isEncrypted,
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
