import {
  signerManager,
  nostrRuntime,
  relayManager,
  nip44Encrypt,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
  LocalSigner,
  wrapManyEvents,
  createRef,
} from "@formstr/core";
import type { SubscriptionHandle, NostrSigner } from "@formstr/core";
import type { EventTemplate, Event, Filter } from "nostr-tools";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";

import {
  encodeFormKeys,
  decodeFormKeys,
  makeViewKeySigner,
  makeSigningKeySigner,
  hexToBytes,
} from "./keys";
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
    baseTags.push(buildFieldTag(field));
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

    const encTags: string[][] = [
      ["d", formId],
      ["name", params.name],
      ["encryption", "view-key"],
    ];
    if (params.settings) encTags.push(["settings", JSON.stringify(params.settings)]);

    const event: EventTemplate = {
      kind: FORM_KINDS.template,
      created_at: Math.floor(Date.now() / 1000),
      tags: encTags,
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

/**
 * Fetch the user's kind-14083 list, choosing the newest across all relays.
 *
 * kind-14083 is a replaceable event; relays can diverge (e.g. one relay serves a
 * stale copy while others have the latest). `fetchOne` resolves with whichever relay
 * answers first, so it can return a stale list. Collecting from all relays and taking
 * the highest `created_at` avoids that.
 */
async function fetchLatestMyFormsEvent(
  relays: string[],
  userPubkey: string,
): Promise<Event | null> {
  const events = await nostrRuntime.querySync(relays, {
    kinds: [FORM_KINDS.myFormsList],
    authors: [userPubkey],
  } as Filter);
  return events.reduce<Event | null>(
    (newest, e) => (!newest || e.created_at > newest.created_at ? e : newest),
    null,
  );
}

export async function fetchMyForms(): Promise<FormSummary[]> {
  const signer = await signerManager.getSigner();
  const userPubkey = await signer.getPublicKey();
  const relays = relayManager.getRelaysForModule("forms");

  const listEvent = await fetchLatestMyFormsEvent(relays, userPubkey);

  let entries: string[][] = [];
  if (listEvent?.content) {
    try {
      let decrypted = "";
      if (listEvent.content.includes("?iv=")) {
        if (!signer.decrypt) throw new Error("Signer cannot decrypt");
        decrypted = await signer.decrypt(userPubkey, listEvent.content);
      } else {
        decrypted = await nip44SelfDecrypt(signer, listEvent.content);
      }
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

  // Read the newest list across relays (not first-responder) so we never append to a
  // stale copy and accidentally drop entries when republishing.
  const existing = await fetchLatestMyFormsEvent(relays, userPubkey);

  let entries: string[][] = [];
  if (existing?.content) {
    try {
      let decrypted = "";
      if (existing.content.includes("?iv=")) {
        if (!signer.decrypt) throw new Error("Signer cannot decrypt");
        decrypted = await signer.decrypt(userPubkey, existing.content);
      } else {
        decrypted = await nip44SelfDecrypt(signer, existing.content);
      }
      const parsed = JSON.parse(decrypted);
      entries = Array.isArray(parsed) ? parsed : [];
    } catch {
      entries = [];
    }
  }

  // Normalise any legacy 3-element entries to the canonical 4-element shape.
  // formstr.app's loader does `secretData.split(":")` on entry[3] with no guard,
  // so a missing 4th element crashes its entire My-Forms load.
  entries = entries.map((e) =>
    e[0] === "f" && e.length < 4 ? ["f", e[1] ?? "", e[2] ?? "", ""] : e,
  );

  const coordKey = `${formPubkey}:${formId}`;
  if (!entries.some((e) => e[1] === coordKey)) {
    // 4th segment: "signingKey:viewKey" for encrypted forms, "" for public ones.
    const secrets = signingKeyHex ? encodeFormKeys(signingKeyHex, viewKeyHex) : "";
    entries.push(["f", coordKey, relay, secrets]);
  }

  // kind-14083 uses NIP-44 self-encryption — formstr.app decrypts the list with
  // signer.nip44Decrypt(userPub, content); NIP-04 here breaks its loader.
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

  // Canonical 4-element entry: ["f", "pubkey:formId", relay, "signingKey:viewKey"|""].
  const entries: string[][] = summaries.map((s) => [
    "f",
    `${s.pubkey}:${s.id}`,
    "",
    s.signingKey ? encodeFormKeys(s.signingKey, s.viewKey) : "",
  ]);

  // kind-14083 uses NIP-44 self-encryption — matches formstr.app's loader.
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

// ── Update Form ─────────────────────────────────────────

export interface UpdateFormParams {
  formId: string;
  /** Form author pubkey (the user's pubkey for public forms; the signing pubkey for encrypted). */
  pubkey: string;
  name?: string;
  fields?: FormField[];
  settings?: FormSettings;
}

/**
 * Republish a form's kind-30168 (a replaceable event keyed by `d`=formId), merging the
 * provided changes over the current definition. Public forms are signed with the user's
 * key; encrypted forms re-encrypt fields to the view key and are signed with the form's
 * signing key (looked up from the user's my-forms list — fails if the user isn't the owner).
 */
export async function updateForm(params: UpdateFormParams): Promise<void> {
  const relays = relayManager.getRelaysForModule("forms");
  const existing = await fetchForm(params.pubkey, params.formId);
  if (!existing) throw new Error(`Form not found: ${params.formId}`);

  const name = params.name ?? existing.name;
  const settings: FormSettings = { ...existing.settings, ...params.settings };
  const fields = params.fields ?? existing.fields;

  if (existing.isEncrypted) {
    const summary = (await fetchMyForms()).find(
      (f) => f.id === params.formId && f.pubkey === params.pubkey,
    );
    if (!summary?.signingKey || !summary?.viewKey) {
      throw new Error("Not the form owner or signing key unavailable");
    }
    const signingKeyBytes = hexToBytes(summary.signingKey);
    const formSigner = makeSigningKeySigner(summary.signingKey);
    const viewPubkey = getPublicKey(hexToBytes(summary.viewKey));
    const fieldTags = fields.map(buildFieldTag);
    const content = await formSigner.nip44Encrypt!(viewPubkey, JSON.stringify(fieldTags));

    const tags: string[][] = [
      ["d", params.formId],
      ["name", name],
      ["encryption", "view-key"],
      ["settings", JSON.stringify(settings)],
    ];
    const event: EventTemplate = {
      kind: FORM_KINDS.template,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content,
    };
    await nostrRuntime.publish(relays, finalizeEvent(event, signingKeyBytes));
    return;
  }

  // Public form — signed with the user's own key.
  const signer = await signerManager.getSigner();
  const tags: string[][] = [
    ["d", params.formId],
    ["name", name],
    ["settings", JSON.stringify(settings)],
  ];
  for (const field of fields) tags.push(buildFieldTag(field));
  if (settings.publicForm) tags.push(["t", "public"]);
  const event: EventTemplate = {
    kind: FORM_KINDS.template,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  await nostrRuntime.publish(relays, await signer.signEvent(event));
}

// ── Share Form (NIP-59 view-key gift-wrap) ──────────────

export interface ShareFormParams {
  formId: string;
  formPubkey: string;
  /** Hex pubkeys of collaborators who should be able to decrypt the form. */
  recipients: string[];
}

export interface ShareFormResult {
  published: number;
  /** Recipients whose gift-wrap failed to publish. */
  failed: string[];
}

/**
 * Distribute an encrypted form's **view key** to collaborators via NIP-59 gift-wrap.
 * Each recipient receives a kind-1059 wrap carrying a rumor with the form coordinate and
 * view key, so their client can decrypt the fields. Only the view key is shared — never
 * the signing key (collaborators can read, not edit/delete).
 */
export async function shareForm(params: ShareFormParams): Promise<ShareFormResult> {
  const relays = relayManager.getRelaysForModule("forms");
  const summary = (await fetchMyForms()).find(
    (f) => f.id === params.formId && f.pubkey === params.formPubkey,
  );
  if (!summary?.viewKey) {
    throw new Error("Not the form owner or view key unavailable");
  }

  const coordinate = `${FORM_KINDS.template}:${params.formPubkey}:${params.formId}`;
  const naddr = createRef("forms", FORM_KINDS.template, params.formPubkey, params.formId);
  const signer = await signerManager.getSigner();
  const rumor = {
    kind: 14,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["a", coordinate],
      ["viewKey", summary.viewKey],
    ],
    content: `Formstr form view key for ${naddr}`,
  };

  const failed: string[] = [];
  let published = 0;
  for (const recipient of params.recipients) {
    try {
      const wraps = await wrapManyEvents(rumor, signer, [recipient]);
      for (const wrap of wraps) await nostrRuntime.publish(relays, wrap);
      published++;
    } catch {
      failed.push(recipient);
    }
  }
  return { published, failed };
}

// ── Import Form (by ref → my-forms list) ────────────────

/** Resolve a public form by author+id into a FormSummary (read-only; carries no keys). */
export async function fetchFormSummaryFromRef(
  pubkey: string,
  formId: string,
): Promise<FormSummary | null> {
  const tpl = await fetchForm(pubkey, formId);
  if (!tpl) return null;
  return {
    id: tpl.id,
    name: tpl.name,
    pubkey: tpl.pubkey,
    createdAt: tpl.createdAt,
    isEncrypted: tpl.isEncrypted,
  };
}

/** Append an externally-discovered form to the user's kind-14083 list (idempotent). */
export async function importForm(summary: FormSummary): Promise<void> {
  const current = await fetchMyForms();
  if (current.some((f) => f.id === summary.id && f.pubkey === summary.pubkey)) return;
  await saveToMyForms([...current, summary]);
}

// ── Helpers ─────────────────────────────────────────────

/** Build a kind-30168 `field` tag: ["field", id, type, label, optionsJSON, configJSON]. */
function buildFieldTag(field: FormField): string[] {
  const options = field.options ? JSON.stringify(field.options.map((o) => [o.id, o.label])) : "[]";
  const config = JSON.stringify({ required: field.required, placeholder: field.placeholder });
  return ["field", field.id, field.type, field.label, options, config];
}

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
