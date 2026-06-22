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
import { sha256 } from "@noble/hashes/sha256";
import type { EventTemplate, Event, Filter, UnsignedEvent } from "nostr-tools";
import { generateSecretKey, getPublicKey, finalizeEvent, getEventHash } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";

import { buildFieldTag, parseFieldTag } from "./fieldCodec";
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

/** Module relays ∪ a form's own `["relay"]` hints — upstream submits/fetches on both. */
function relaysForForm(formRelays?: string[]): string[] {
  return Array.from(new Set([...relayManager.getRelaysForModule("forms"), ...(formRelays ?? [])]));
}

/**
 * The form **spec** rows — d, name, settings, field rows. For plaintext forms these are
 * published as event tags; for encrypted forms the whole array is NIP-44'd into `content`
 * (upstream `nostr/createForm.ts` encrypts the full spec, not just the field rows).
 */
function buildSpecRows(formId: string, name: string, fields: FormField[], settings?: FormSettings) {
  const rows: string[][] = [
    ["d", formId],
    ["name", name],
  ];
  if (settings) rows.push(["settings", JSON.stringify(settings)]);
  for (const field of fields) rows.push(buildFieldTag(field));
  return rows;
}

/**
 * Access-control tags upstream reads off the kind-30168 event — `["allowed", pk]`
 * (the submit gate) and `["p", pk]` (allowed ∪ collaborators). Upstream's
 * `createForm` tags **every** form this way (public and encrypted alike), and
 * formstr.app's FormRenderer enforces the gate from these tags, not from settings —
 * so both our paths must emit them or a gated form is open-submit cross-app.
 */
function buildParticipantTags(settings?: FormSettings): string[][] {
  const tags: string[][] = [];
  const allowed = settings?.allowedResponders ?? [];
  const pTags = new Set([...allowed, ...(settings?.collaborators ?? [])]);
  for (const pk of allowed) tags.push(["allowed", pk]);
  for (const pk of pTags) tags.push(["p", pk]);
  return tags;
}

/**
 * Outer tags for an **encrypted** template: only d/name/relay plus the participant
 * access-control tags. No settings, no `encryption` marker: formstr.app detects
 * encryption purely via `content !== ""`.
 */
function buildEncryptedOuterTags(
  formId: string,
  name: string,
  relays: string[],
  settings?: FormSettings,
): string[][] {
  return [
    ["d", formId],
    ["name", name],
    ...relays.map((r) => ["relay", r]),
    ...buildParticipantTags(settings),
  ];
}

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
  await signerManager.getSigner(); // fail fast when logged out — the my-forms list write needs an identity
  const formId = crypto.randomUUID().slice(0, 8);
  const relays = relayManager.getRelaysForModule("forms");

  const specRows = buildSpecRows(formId, params.name, params.fields, params.settings);

  // Upstream signs EVERY form (public too) with an ephemeral signing key, so
  // formstr.app can edit it later by republishing 30168:signingPub:formId with the
  // key from the 14083 entry. Signing public forms with the user key would fork the
  // address on cross-app edits.
  const signingKey = generateSecretKey();
  const signingKeyHex = bytesToHex(signingKey);
  const signingPubkey = getPublicKey(signingKey);

  if (params.encrypt) {
    const viewKey = generateSecretKey();
    const viewKeyHex = bytesToHex(viewKey);
    const viewPubkey = getPublicKey(viewKey);

    // Encrypt the FULL spec (d/name/settings/fields): formSigner→viewPubkey so the
    // view key can decrypt — and formstr.app gets name+settings back, not just fields.
    const formSigner = new LocalSigner(signingKey);
    const content = await formSigner.nip44Encrypt(viewPubkey, JSON.stringify(specRows));

    const event: EventTemplate = {
      kind: FORM_KINDS.template,
      created_at: Math.floor(Date.now() / 1000),
      tags: buildEncryptedOuterTags(formId, params.name, relays, params.settings),
      content,
    };
    const signed = finalizeEvent(event, signingKey);
    await nostrRuntime.publish(relays, signed);

    await appendToMyFormsList(signingPubkey, formId, relays[0] ?? "", signingKeyHex, viewKeyHex);

    return { formId, pubkey: signingPubkey, signingKey: signingKeyHex, viewKey: viewKeyHex };
  }

  // Plaintext form. Upstream tags EVERY plaintext form ["t","public"] (its public
  // browse filter), not just publicForm ones — and emits the same allowed/p access
  // tags as encrypted forms so a gated public form stays gated on formstr.app.
  const tags: string[][] = [
    ...specRows,
    ["t", "public"],
    ...relays.map((r) => ["relay", r]),
    ...buildParticipantTags(params.settings),
  ];
  const event: EventTemplate = {
    kind: FORM_KINDS.template,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  const signed = finalizeEvent(event, signingKey);
  await nostrRuntime.publish(relays, signed);

  // 4th segment carries the signing key only (no view key for public forms).
  await appendToMyFormsList(signingPubkey, formId, relays[0] ?? "", signingKeyHex, undefined);

  return { formId, pubkey: signingPubkey, signingKey: signingKeyHex };
}

// ── Fetch Form ──────────────────────────────────────────

export async function fetchForm(
  pubkey: string,
  formId: string,
  viewKey?: string,
  relayHints?: string[],
): Promise<FormTemplate | null> {
  const relays = relaysForForm(relayHints);
  const event = await nostrRuntime.fetchOne(relays, {
    kinds: [FORM_KINDS.template],
    authors: [pubkey],
    "#d": [formId],
    limit: 1,
  } as Filter);
  if (!event) return null;

  // No explicit view key for an encrypted form? Look for an inbound access grant
  // (formstr.app's grantAccess wraps) before giving up.
  let effectiveViewKey = viewKey;
  if (!effectiveViewKey && event.content && !event.tags.some((t) => t[0] === "field")) {
    const keys = await fetchFormKeys(pubkey, formId).catch(() => null);
    effectiveViewKey = keys?.viewKey;
  }

  let decryptedRows: string[][] | undefined;
  if (event.content && effectiveViewKey) {
    try {
      const viewSigner = makeViewKeySigner(effectiveViewKey);
      const decrypted = await viewSigner.nip44Decrypt(pubkey, event.content);
      const rows = JSON.parse(decrypted);
      if (Array.isArray(rows)) decryptedRows = rows as string[][];
    } catch {
      // viewKey wrong or content malformed — fall through to outer tags only
    }
  }

  return parseFormEvent(event, decryptedRows);
}

// ── Access grants (NIP-59-style, formstr.app protocol) ──

/** sha256 alias used as the wrap's `p` tag — upstream `accessControl.ts createWrap`. */
function accessGrantAlias(formAuthor: string, formId: string, recipient: string): string {
  return bytesToHex(sha256(`${FORM_KINDS.template}:${formAuthor}:${formId}:${recipient}`));
}

export interface FormAccessKeys {
  viewKey?: string;
  signingKey?: string;
}

/**
 * Discover access keys granted to the current user for a form (port of upstream
 * `formUtils.fetchKeys`): query kind-1059 wraps `p`-tagged with the sha256 alias
 * `30168:author:formId:userPub`, then unwrap wrap → seal → kind-18 rumor and read
 * the `ViewAccess` / `EditAccess` tags.
 *
 * Returns null without throwing when no signer is available — this runs on read
 * paths and must not trigger the login modal.
 */
export async function fetchFormKeys(
  formAuthor: string,
  formId: string,
): Promise<FormAccessKeys | null> {
  const signer = signerManager.getSignerIfAvailable();
  if (!signer?.nip44Decrypt) return null;
  const userPub = await signer.getPublicKey();

  const relays = relayManager.getRelaysForModule("forms");
  const wraps = await nostrRuntime.querySync(relays, {
    kinds: [FORM_KINDS.giftWrap],
    "#p": [accessGrantAlias(formAuthor, formId, userPub)],
  } as Filter);

  for (const wrap of wraps) {
    try {
      const seal = JSON.parse(await signer.nip44Decrypt(wrap.pubkey, wrap.content)) as Event;
      const rumor = JSON.parse(await signer.nip44Decrypt(seal.pubkey, seal.content)) as {
        tags?: string[][];
      };
      const viewKey = rumor.tags?.find((t) => t[0] === "ViewAccess")?.[1];
      const signingKey = rumor.tags?.find((t) => t[0] === "EditAccess")?.[1];
      if (viewKey || signingKey) return { viewKey, signingKey };
    } catch {
      // wrap not decryptable / malformed — try the next one
    }
  }
  return null;
}

// ── Submit Response ─────────────────────────────────────

export async function submitResponse(
  formPubkey: string,
  formId: string,
  responses: FormResponse[],
  encrypt = false,
  overrideSigner?: NostrSigner,
  formRelays?: string[],
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
  await nostrRuntime.publish(relaysForForm(formRelays), signed);
}

// ── Fetch Responses ─────────────────────────────────────

export function subscribeToResponses(
  formPubkey: string,
  formId: string,
  onResponse: (response: FormResponseEvent) => void,
  onEose?: () => void,
  signingKey?: string,
  formRelays?: string[],
): SubscriptionHandle {
  const relays = relaysForForm(formRelays);
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
  formRelays?: string[],
): Promise<FormResponseEvent[]> {
  const events = await nostrRuntime.querySync(relaysForForm(formRelays), {
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

/**
 * Decrypt a kind-14083 payload to its entry tuples. NIP-44 self-encryption is the
 * canonical format; legacy NIP-04 content (`?iv=`) is tolerated on read.
 * Throws when the signer can't decrypt — callers decide whether that's fatal.
 */
async function decryptListEntries(
  signer: NostrSigner,
  userPubkey: string,
  content: string,
): Promise<string[][]> {
  let decrypted = "";
  if (content.includes("?iv=")) {
    if (!signer.decrypt) throw new Error("Signer cannot decrypt");
    decrypted = await signer.decrypt(userPubkey, content);
  } else {
    decrypted = await nip44SelfDecrypt(signer, content);
  }
  const parsed = JSON.parse(decrypted);
  return Array.isArray(parsed) ? parsed : [];
}

/** Self-encrypt and publish the kind-14083 list (formstr.app reads NIP-44 only). */
async function publishMyFormsList(
  signer: NostrSigner,
  relays: string[],
  entries: string[][],
): Promise<void> {
  const encrypted = await nip44SelfEncrypt(signer, JSON.stringify(entries));
  const event: EventTemplate = {
    kind: FORM_KINDS.myFormsList,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: encrypted,
  };
  await nostrRuntime.publish(relays, await signer.signEvent(event));
}

export async function fetchMyForms(): Promise<FormSummary[]> {
  const signer = await signerManager.getSigner();
  const userPubkey = await signer.getPublicKey();
  const relays = relayManager.getRelaysForModule("forms");

  const listEvent = await fetchLatestMyFormsEvent(relays, userPubkey);

  let entries: string[][] = [];
  if (listEvent?.content) {
    try {
      entries = await decryptListEntries(signer, userPubkey, listEvent.content);
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
      const [, coordKey, relayHint, keySegment] = entry;
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
        relay: relayHint || undefined,
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
      entries = await decryptListEntries(signer, userPubkey, existing.content);
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
    // 4th segment: "signingKey:viewKey" for encrypted forms, "signingKey" for public.
    const secrets = signingKeyHex ? encodeFormKeys(signingKeyHex, viewKeyHex) : "";
    entries.push(["f", coordKey, relay, secrets]);
  }

  // kind-14083 uses NIP-44 self-encryption — formstr.app decrypts the list with
  // signer.nip44Decrypt(userPub, content); NIP-04 here breaks its loader.
  await publishMyFormsList(signer, relays, entries);
}

/** Public API: overwrite the user's kind-14083 list with the given summaries. */
export async function saveToMyForms(summaries: FormSummary[]): Promise<void> {
  const signer = await signerManager.getSigner();
  const relays = relayManager.getRelaysForModule("forms");

  // Canonical 4-element entry: ["f", "pubkey:formId", relay, "signingKey:viewKey"|""].
  // The relay hint is preserved — formstr.app's per-form retry path reads it.
  const entries: string[][] = summaries.map((s) => [
    "f",
    `${s.pubkey}:${s.id}`,
    s.relay ?? "",
    s.signingKey ? encodeFormKeys(s.signingKey, s.viewKey) : "",
  ]);

  // kind-14083 uses NIP-44 self-encryption — matches formstr.app's loader.
  await publishMyFormsList(signer, relays, entries);
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
  const userPubkey = await signer.getPublicKey();
  const relays = relayManager.getRelaysForModule("forms");
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
  await nostrRuntime.publish(relays, await signer.signEvent(event));

  // Upstream "deletes" by rewriting the kind-14083 list — without this the entry
  // resurrects on the next load (and in formstr.app, which ignores our kind-5).
  // Operate on the raw entries so untouched rows keep relay + key segments verbatim.
  const listEvent = await fetchLatestMyFormsEvent(relays, userPubkey);
  if (!listEvent?.content) return;
  let entries: string[][];
  try {
    entries = await decryptListEntries(signer, userPubkey, listEvent.content);
  } catch {
    return; // unreadable list — don't risk overwriting it
  }
  const coordKey = `${formPubkey}:${formId}`;
  const trimmed = entries.filter((e) => e[1] !== coordKey);
  if (trimmed.length === entries.length) return; // form wasn't in the list
  await publishMyFormsList(signer, relays, trimmed);
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
  const summary = (await fetchMyForms()).find(
    (f) => f.id === params.formId && f.pubkey === params.pubkey,
  );
  // Pass the cached viewKey so an encrypted form's current name/settings/fields
  // decrypt — otherwise the merge below would silently drop them.
  const existing = await fetchForm(params.pubkey, params.formId, summary?.viewKey);
  if (!existing) throw new Error(`Form not found: ${params.formId}`);

  const name = params.name ?? existing.name;
  const settings: FormSettings = { ...existing.settings, ...params.settings };
  const fields = params.fields ?? existing.fields;

  const specRows = buildSpecRows(params.formId, name, fields, settings);

  if (existing.isEncrypted) {
    if (!summary?.signingKey || !summary?.viewKey) {
      throw new Error("Not the form owner or signing key unavailable");
    }
    const signingKeyBytes = hexToBytes(summary.signingKey);
    const formSigner = makeSigningKeySigner(summary.signingKey);
    const viewPubkey = getPublicKey(hexToBytes(summary.viewKey));
    const content = await formSigner.nip44Encrypt!(viewPubkey, JSON.stringify(specRows));

    const event: EventTemplate = {
      kind: FORM_KINDS.template,
      created_at: Math.floor(Date.now() / 1000),
      tags: buildEncryptedOuterTags(params.formId, name, relays, settings),
      content,
    };
    await nostrRuntime.publish(relays, finalizeEvent(event, signingKeyBytes));
    return;
  }

  // Public form — sign with the form's signing key when we hold it (upstream model;
  // keeps the address 30168:signingPub:formId stable across apps). Fall back to the
  // user signer for legacy forms authored under the identity key.
  const tags: string[][] = [
    ...specRows,
    ["t", "public"],
    ...relays.map((r) => ["relay", r]),
    ...buildParticipantTags(settings),
  ];
  const event: EventTemplate = {
    kind: FORM_KINDS.template,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  if (summary?.signingKey) {
    await nostrRuntime.publish(relays, finalizeEvent(event, hexToBytes(summary.signingKey)));
    return;
  }
  const signer = await signerManager.getSigner();
  await nostrRuntime.publish(relays, await signer.signEvent(event));
}

// ── Share Form (upstream accessControl.ts grantAccess) ──

export interface ShareFormParams {
  formId: string;
  formPubkey: string;
  /** Hex pubkeys granted view access (the view key). */
  recipients: string[];
  /** Hex pubkeys additionally granted edit access (the signing key). */
  editors?: string[];
}

export interface ShareFormResult {
  published: number;
  /** Recipients whose gift-wrap failed to publish. */
  failed: string[];
}

/**
 * Grant form access via formstr.app's wrap protocol: a kind-18 rumor authored by the
 * form's signing key carrying `["ViewAccess", viewKeyHex]` (and `["EditAccess",
 * signingKeyHex]` for editors), sealed (kind 13) by the signing key, wrapped (kind
 * 1059) by a random key whose only `p` tag is the sha256 alias
 * `30168:signingPub:formId:recipient` — recipients discover grants by that alias, so
 * a recipient-pubkey `p` tag would be invisible to formstr.app.
 *
 * Timestamps are real (upstream's fetchKeys filter has no tolerance for the core
 * wrapEvent's ±2-day randomization), which is why this builds the layers manually.
 */
export async function shareForm(params: ShareFormParams): Promise<ShareFormResult> {
  const relays = relayManager.getRelaysForModule("forms");
  const summary = (await fetchMyForms()).find(
    (f) => f.id === params.formId && f.pubkey === params.formPubkey,
  );
  if (!summary?.signingKey) {
    throw new Error("Not the form owner or form keys unavailable");
  }
  const signingKeyBytes = hexToBytes(summary.signingKey);
  const signingPubkey = getPublicKey(signingKeyBytes);
  const formSigner = new LocalSigner(signingKeyBytes);
  const now = () => Math.round(Date.now() / 1000);

  const editors = new Set(params.editors ?? []);
  const targets = [...new Set([...params.recipients, ...editors])];

  const failed: string[] = [];
  let published = 0;
  for (const recipient of targets) {
    try {
      // Rumor tag order matches upstream createTag: EditAccess before ViewAccess.
      const accessTags: string[][] = [];
      if (editors.has(recipient)) accessTags.push(["EditAccess", summary.signingKey]);
      if (summary.viewKey) accessTags.push(["ViewAccess", summary.viewKey]);

      const rumor: UnsignedEvent & { id?: string } = {
        kind: 18,
        pubkey: signingPubkey,
        created_at: now(),
        content: "",
        tags: accessTags,
      };
      rumor.id = getEventHash(rumor);

      const seal = finalizeEvent(
        {
          kind: 13,
          content: await formSigner.nip44Encrypt(recipient, JSON.stringify(rumor)),
          created_at: now(),
          tags: [],
        },
        signingKeyBytes,
      );

      const randomKey = generateSecretKey();
      const wrap = finalizeEvent(
        {
          kind: 1059,
          content: await new LocalSigner(randomKey).nip44Encrypt(recipient, JSON.stringify(seal)),
          created_at: now(),
          tags: [["p", accessGrantAlias(signingPubkey, params.formId, recipient)]],
        },
        randomKey,
      );

      await nostrRuntime.publish(relays, wrap);
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

/**
 * Parse a kind-30168 template, optionally merging the decrypted spec rows.
 *
 * Outer tags come first, so `find` resolves name/settings from the plaintext tags when
 * present — which covers both upstream full-spec payloads (outer name == inner name,
 * settings only inside) and legacy super-app events (settings plaintext outside,
 * field rows only inside).
 */
function parseFormEvent(event: Event, decryptedRows?: string[][]): FormTemplate {
  const merged = decryptedRows ? [...event.tags, ...decryptedRows] : event.tags;

  const dTag = merged.find((t) => t[0] === "d")?.[1] ?? "";
  const nameTag = merged.find((t) => t[0] === "name")?.[1] ?? "Untitled";
  const settingsTag = merged.find((t) => t[0] === "settings")?.[1];
  const encTag = event.tags.find((t) => t[0] === "encryption")?.[1];
  const relays = event.tags.filter((t) => t[0] === "relay" && t[1]).map((t) => t[1]);

  const fields: FormField[] = merged.filter((t) => t[0] === "field").map(parseFieldTag);

  // Legacy explicit tag takes precedence; otherwise upstream's heuristic — non-empty
  // content with no plaintext field rows means the spec is encrypted.
  const outerHasFields = event.tags.some((t) => t[0] === "field");
  const isEncrypted =
    encTag != null ? encTag === "view-key" : event.content.length > 0 && !outerHasFields;

  let settings: FormSettings = {};
  if (settingsTag) {
    try {
      settings = JSON.parse(settingsTag);
    } catch {
      // malformed settings — keep the form renderable
    }
  }

  return {
    id: dTag,
    name: nameTag,
    fields,
    settings,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    isEncrypted,
    ...(relays.length > 0 && { relays }),
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
