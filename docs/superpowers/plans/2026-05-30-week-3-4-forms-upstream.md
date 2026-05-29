# Week 3&4 — Forms Module (Upstream) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 7 encryption/persistence bugs in the forms service, replace the NIP-59 `formsKeyStore` with kind-14083 interop format, split the 1139-LOC `FormsPage` monolith, and add a public fill route with anonymous responder and shareable link.

**Architecture:** Keys (signingKey + viewKey) travel from kind-14083 → `formsStore.myForms[]` → service calls. No NIP-59 subscription. `FormSummary` is extended with `signingKey?/viewKey?` so any service call that needs decryption can find the key. Form content is NIP-44 encrypted using the ephemeral signing key → view key (ECDH), making it decryptable by the view key holder. Responses are NIP-44 encrypted to the form pubkey, decryptable by the signing key holder.

**Tech Stack:** TypeScript, Vitest (jsdom), `@formstr/core` (signerManager, nostrRuntime, relayManager, nip44Encrypt, nip44Decrypt, nip44SelfEncrypt, nip44SelfDecrypt, LocalSigner), nostr-tools, `@noble/hashes/utils`, Zustand, React, MUI v6.

---

## Branch: `upstream-week3&4-pr1`

## Commit prefix: `fix(forms):`

---

## File Map

### PR 1 — `fix(forms): encryption correctness + MyForms persistence + tests`

| Action | File                                              | Responsibility                                                                                                   |
| ------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Modify | `packages/app/src/services/forms/types.ts`        | Add `signingKey?/viewKey?` to `FormSummary`; add `wasEncrypted?` to `FormResponseEvent`; remove giftWrap comment |
| Modify | `packages/app/src/services/forms/keys.ts`         | Remove NIP-59 helpers; add `encodeFormKeys`/`decodeFormKeys` for kind-14083 tag segment                          |
| Modify | `packages/app/src/services/forms/service.ts`      | Fix all 7 bugs (see tasks below)                                                                                 |
| Delete | `packages/app/src/stores/formsKeyStore.ts`        | Gone — replaced by kind-14083                                                                                    |
| Modify | `packages/app/src/stores/formsStore.ts`           | Pass keys to service calls; call saveToMyForms with keys after createForm                                        |
| Modify | `packages/app/src/stores/index.ts`                | Remove formsKeyStore export                                                                                      |
| Modify | `packages/app/src/layout/AppShell.tsx`            | Remove formsKeyStore wiring and hash-based view-key parsing                                                      |
| Create | `packages/app/src/services/forms/service.test.ts` | Service unit tests                                                                                               |
| Create | `packages/app/src/stores/formsStore.test.ts`      | Store unit tests                                                                                                 |

### PR 2 — `refactor(forms): split FormsPage into composable components`

| Action | File                                                          | Responsibility                    |
| ------ | ------------------------------------------------------------- | --------------------------------- |
| Modify | `packages/app/src/pages/FormsPage.tsx`                        | Slim to ~80-LOC orchestrator      |
| Create | `packages/app/src/components/forms/FormListView.tsx`          | Grid/list, empty state, skeletons |
| Create | `packages/app/src/components/forms/FormCard.tsx`              | Single card + hover action row    |
| Create | `packages/app/src/components/forms/CreateFormDialog.tsx`      | Field builder + encryption toggle |
| Create | `packages/app/src/components/forms/FillFormDialog.tsx`        | Field renderer + submit           |
| Create | `packages/app/src/components/forms/ResponsesDialog.tsx`       | Responses table + analytics tab   |
| Create | `packages/app/src/components/forms/FormFieldsRenderer.tsx`    | Shared pure field renderer        |
| Create | `packages/app/src/components/forms/FormListView.test.tsx`     | Component tests                   |
| Create | `packages/app/src/components/forms/FormCard.test.tsx`         | Component tests                   |
| Create | `packages/app/src/components/forms/CreateFormDialog.test.tsx` | Component tests                   |
| Create | `packages/app/src/components/forms/FillFormDialog.test.tsx`   | Component tests                   |
| Create | `packages/app/src/components/forms/ResponsesDialog.test.tsx`  | Component tests                   |

### PR 3 — `feat(forms): public fill route + anonymous responder + shareable link`

| Action | File                                                              | Responsibility                            |
| ------ | ----------------------------------------------------------------- | ----------------------------------------- |
| Create | `packages/app/src/pages/FillPage.tsx`                             | Standalone public fill page               |
| Create | `packages/app/src/components/forms/ResponderIdentityBar.tsx`      | Logged-in vs anonymous toggle             |
| Modify | `packages/app/src/router.tsx`                                     | Add `/forms/fill/:naddr` outside AppShell |
| Modify | `packages/app/src/components/forms/FormCard.tsx`                  | Add copy-link button                      |
| Modify | `packages/app/vitest.config.ts`                                   | Add 80% coverage gate for forms service   |
| Create | `packages/app/src/pages/FillPage.test.tsx`                        | FillPage tests                            |
| Create | `packages/app/src/components/forms/ResponderIdentityBar.test.tsx` | Identity bar tests                        |

---

# PR 1 Tasks

## Task 1: Extend types — FormSummary gets keys, FormResponseEvent gets wasEncrypted

**Files:**

- Modify: `packages/app/src/services/forms/types.ts`

- [ ] **Step 1: Update `FormSummary` and `FormResponseEvent` in types.ts**

Open `packages/app/src/services/forms/types.ts`. Make these targeted changes:

1. In `FormSummary`, add two optional fields after `isEncrypted`:

```ts
export interface FormSummary {
  id: string;
  name: string;
  pubkey: string;
  createdAt: number;
  isEncrypted: boolean;
  /** Hex-encoded ephemeral signing key. Present only for forms you created. */
  signingKey?: string;
  /** Hex-encoded view key. Present only for encrypted forms you created. */
  viewKey?: string;
}
```

2. In `FormResponseEvent`, add `wasEncrypted?` after the existing fields:

```ts
export interface FormResponseEvent {
  id: string;
  pubkey: string;
  responses: FormResponse[];
  createdAt: number;
  wasEncrypted?: boolean;
  event: Event;
}
```

3. In `FORM_KINDS`, remove the comment referencing formsKeyStore on the `giftWrap` line. Change:

```ts
/** NIP-59 gift-wrap kind; formsKeyStore listens on this with "#p" = self. */
giftWrap: 1059,
```

to just:

```ts
giftWrap: 1059,
```

- [ ] **Step 2: Typecheck**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app typecheck
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/services/forms/types.ts
git commit -m "fix(forms): extend FormSummary with signingKey/viewKey; add wasEncrypted to FormResponseEvent"
```

---

## Task 2: Simplify keys.ts — remove NIP-59 helpers, add kind-14083 key encoding

**Files:**

- Modify: `packages/app/src/services/forms/keys.ts`

- [ ] **Step 1: Rewrite keys.ts**

Replace the entire content of `packages/app/src/services/forms/keys.ts` with:

```ts
import { LocalSigner } from "@formstr/core";
import { generateSecretKey, getPublicKey } from "nostr-tools";

export interface FormViewKey {
  secretKey: Uint8Array;
  pubkey: string;
}

/** Generate an ephemeral view key used to encrypt form fields. */
export function generateViewKey(): FormViewKey {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  return { secretKey, pubkey };
}

/**
 * Build a signer backed by the view key — used to decrypt form content.
 * Decrypt with: nip44Decrypt(makeViewKeySigner(viewKeyHex), formPubkey, content)
 */
export function makeViewKeySigner(viewKeyHex: string): LocalSigner {
  return new LocalSigner(hexToBytes(viewKeyHex));
}

/**
 * Build a signer backed by the signing key — used to decrypt encrypted responses.
 * Decrypt with: nip44Decrypt(makeSigningKeySigner(signingKeyHex), respondentPubkey, content)
 */
export function makeSigningKeySigner(signingKeyHex: string): LocalSigner {
  return new LocalSigner(hexToBytes(signingKeyHex));
}

/**
 * Encode signing key (and optional view key) into the kind-14083 tag segment:
 *   "signingKeyHex:viewKeyHex"  (encrypted form)
 *   "signingKeyHex"             (public form)
 *
 * Compatible with the @formstr/sdk and formstr.app wire format.
 */
export function encodeFormKeys(signingKeyHex: string, viewKeyHex?: string): string {
  return viewKeyHex ? `${signingKeyHex}:${viewKeyHex}` : signingKeyHex;
}

/**
 * Decode a kind-14083 tag key segment back into individual keys.
 */
export function decodeFormKeys(segment: string): { signingKey: string; viewKey?: string } {
  const idx = segment.indexOf(":");
  if (idx < 0) return { signingKey: segment };
  return { signingKey: segment.slice(0, idx), viewKey: segment.slice(idx + 1) };
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app typecheck
```

Expected: errors about `wrapFormKeyForRecipient` not found — those are in files we fix in later tasks. Note them and continue.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/services/forms/keys.ts
git commit -m "fix(forms): replace NIP-59 key helpers with kind-14083 encodeFormKeys/decodeFormKeys"
```

---

## Task 3: Fix service.ts — createForm, saveToMyForms, fetchMyForms

**Files:**

- Modify: `packages/app/src/services/forms/service.ts`

This task fixes the key-persistence half of the service. Work top-to-bottom.

- [ ] **Step 1: Update imports in service.ts**

At the top of `packages/app/src/services/forms/service.ts`, change the imports to:

```ts
import {
  signerManager,
  nostrRuntime,
  relayManager,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
  LocalSigner,
} from "@formstr/core";
import type { SubscriptionHandle } from "@formstr/core";
import type { EventTemplate, Event, Filter } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils";
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
import { encodeFormKeys, decodeFormKeys, makeViewKeySigner, makeSigningKeySigner } from "./keys";
```

- [ ] **Step 2: Fix `createForm`**

Replace the existing `createForm` function with:

```ts
export async function createForm(params: CreateFormParams): Promise<CreateFormResult> {
  const signer = await signerManager.getSigner();
  const formId = crypto.randomUUID().slice(0, 8);

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

  const relays = relayManager.getRelaysForModule("forms");

  if (params.encrypt) {
    const signingKey = generateSecretKey();
    const signingKeyHex = bytesToHex(signingKey);
    const signingPubkey = getPublicKey(signingKey);

    const viewKey = generateSecretKey();
    const viewKeyHex = bytesToHex(viewKey);
    const viewPubkey = getPublicKey(viewKey);

    // Encrypt fields using formSigner→viewPubkey so view key holder can decrypt
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

    // Persist keys to kind-14083
    await saveFormToMyList(
      signingPubkey,
      formId,
      relays[0] ?? "",
      signingKeyHex,
      viewKeyHex,
      signer,
    );

    return { formId, pubkey: signingPubkey, signingKey: signingKeyHex, viewKey: viewKeyHex };
  }

  if (params.settings?.publicForm) baseTags.push(["t", "public"]);
  const event: EventTemplate = {
    kind: FORM_KINDS.template,
    created_at: Math.floor(Date.now() / 1000),
    tags: baseTags,
    content: "",
  };
  const signed = await signer.signEvent(event);
  const signingPubkey = signed.pubkey;
  await nostrRuntime.publish(relays, signed);

  // Persist signing key to kind-14083 (public forms: no view key)
  await saveFormToMyList(
    signingPubkey,
    formId,
    relays[0] ?? "",
    bytesToHex(generateSecretKey()),
    undefined,
    signer,
  );

  return { formId, pubkey: signingPubkey };
}
```

Wait — for public forms, the "signing key" IS the user's NIP-07 key (we can't extract it). The kind-14083 list for public forms just needs the pubkey+formId for later lookup. Update to:

```ts
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

  // Public form: store pubkey:formId in list (no key needed for decryption)
  await appendToMyFormsList(userPubkey, formId, relays[0] ?? "", undefined, undefined);

  return { formId, pubkey: userPubkey };
}
```

- [ ] **Step 3: Add `appendToMyFormsList` helper (replaces `saveToMyForms`)**

Add this internal helper just before the existing `fetchMyForms` function. Also replace `saveToMyForms` entirely:

```ts
/**
 * Read-modify-write the user's kind-14083 list, appending one new entry.
 * Format per entry: ["f", "pubkey:formId", relay, "signingKeyHex:viewKeyHex"]
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

  // Fetch existing list
  const existing = await nostrRuntime.fetchOne(relays, {
    kinds: [FORM_KINDS.myFormsList],
    authors: [userPubkey],
    limit: 1,
  });

  let entries: string[][] = [];
  if (existing?.content) {
    try {
      const decrypted = await nip44SelfDecrypt(signer, existing.content);
      entries = JSON.parse(decrypted);
    } catch {
      entries = [];
    }
  }

  const key = `${formPubkey}:${formId}`;
  if (!entries.some((e) => e[1] === key)) {
    const keySegment = signingKeyHex ? encodeFormKeys(signingKeyHex, viewKeyHex) : "";
    const entry: string[] = ["f", key, relay];
    if (keySegment) entry.push(keySegment);
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

/** Public API for formsStore to persist the full list after a createForm. */
export async function saveToMyForms(summaries: FormSummary[]): Promise<void> {
  const signer = await signerManager.getSigner();
  const relays = relayManager.getRelaysForModule("forms");

  const entries: string[][] = summaries.map((s) => {
    const key = `${s.pubkey}:${s.id}`;
    const entry: string[] = ["f", key, ""];
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
```

- [ ] **Step 4: Fix `fetchMyForms` to return keys in summaries**

Replace the existing `fetchMyForms` with:

```ts
export async function fetchMyForms(): Promise<FormSummary[]> {
  const signer = await signerManager.getSigner();
  const userPubkey = await signer.getPublicKey();
  const relays = relayManager.getRelaysForModule("forms");

  const listEvent = await nostrRuntime.fetchOne(relays, {
    kinds: [FORM_KINDS.myFormsList],
    authors: [userPubkey],
    limit: 1,
  });

  let entries: string[][] = [];
  if (listEvent?.content) {
    try {
      const decrypted = await nip44SelfDecrypt(signer, listEvent.content);
      entries = JSON.parse(decrypted);
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
      const isEncrypted = hasEncTag ?? ((evt?.content?.length ?? 0) > 0 && !hasFieldTags);

      const keys = keySegment ? decodeFormKeys(keySegment) : undefined;
      return {
        id: formId,
        name,
        pubkey: formPubkey,
        createdAt: evt?.created_at ?? 0,
        isEncrypted,
        signingKey: keys?.signingKey,
        viewKey: keys?.viewKey,
      } satisfies FormSummary;
    })
    .filter((s): s is FormSummary => s !== null);
}
```

- [ ] **Step 5: Typecheck**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app typecheck
```

Expected: errors only around `fetchForm`/`parseResponseEvent` which we fix in Task 4.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/services/forms/service.ts
git commit -m "fix(forms): createForm persists keys to kind-14083; fetchMyForms returns signingKey/viewKey"
```

---

## Task 4: Fix service.ts — fetchForm, fetchResponses, parseResponseEvent

**Files:**

- Modify: `packages/app/src/services/forms/service.ts`

- [ ] **Step 1: Fix `fetchForm`**

Replace existing `fetchForm` with:

```ts
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
```

- [ ] **Step 2: Fix `parseFormEvent`**

Replace existing `parseFormEvent` helper with:

```ts
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
```

- [ ] **Step 3: Fix `parseResponseEvent` to handle encrypted responses**

Replace existing `parseResponseEvent` helper with:

```ts
function parseResponseEvent(event: Event, signingKey?: string): FormResponseEvent | null {
  const plainResponses: FormResponse[] = event.tags
    .filter((t) => t[0] === "response")
    .map((t) => ({ fieldId: t[1], answer: t[2], metadata: t[3] }));

  if (plainResponses.length > 0) {
    return {
      id: event.id,
      pubkey: event.pubkey,
      responses: plainResponses,
      createdAt: event.created_at,
      wasEncrypted: false,
      event,
    };
  }

  if (event.content && signingKey) {
    try {
      const formSigner = makeSigningKeySigner(signingKey);
      // Respondent encrypted to formPubkey; decrypt using formSigningKey + respondentPubkey
      // nip44Decrypt(formSigner, senderPubkey, ciphertext)
      const decryptedP = formSigner.nip44Decrypt(event.pubkey, event.content);
      // Return a placeholder that resolves async — callers handle via Promise.all
      // For simplicity, return sync-only with empty responses if we can't decrypt inline.
      // The async version is in fetchResponsesEncrypted.
      return {
        id: event.id,
        pubkey: event.pubkey,
        responses: [],
        createdAt: event.created_at,
        wasEncrypted: true,
        event,
        _decryptPromise: decryptedP,
      } as any;
    } catch {
      return {
        id: event.id,
        pubkey: event.pubkey,
        responses: [],
        createdAt: event.created_at,
        wasEncrypted: true,
        event,
      };
    }
  }

  if (event.content && !signingKey) {
    return {
      id: event.id,
      pubkey: event.pubkey,
      responses: [],
      createdAt: event.created_at,
      wasEncrypted: true,
      event,
    };
  }

  return null;
}
```

Actually, async decryption inside an otherwise-sync helper is messy. Let's make `fetchResponses` async-decrypt:

Replace `parseResponseEvent` with the simpler sync version:

```ts
function parseResponseEvent(event: Event): FormResponseEvent | null {
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
```

And fix `fetchResponses` to decrypt encrypted responses after collecting them:

```ts
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

  // Decrypt encrypted responses using the form's signing key
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
        return r; // Leave wasEncrypted=true, responses=[] — can't decrypt
      }
    }),
  );
}
```

Fix `subscribeToResponses` similarly:

```ts
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
      onEvent: async (event: Event) => {
        const parsed = parseResponseEvent(event);
        if (!parsed) return;
        if (parsed.wasEncrypted && formSigner) {
          try {
            const decrypted = await formSigner.nip44Decrypt(event.pubkey, event.content);
            const tags = JSON.parse(decrypted) as string[][];
            onResponse({
              ...parsed,
              responses: tags
                .filter((t) => t[0] === "response")
                .map((t) => ({ fieldId: t[1], answer: t[2], metadata: t[3] })),
            });
            return;
          } catch {
            /* leave as-is */
          }
        }
        onResponse(parsed);
      },
      onEose,
    },
  );
}
```

- [ ] **Step 4: Remove the local `bytesToHex` at the bottom of service.ts**

Delete the local `bytesToHex` function — it's now imported from `@noble/hashes/utils`.

- [ ] **Step 5: Typecheck**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app typecheck
```

Expected: only remaining errors should be in AppShell / formsStore / formsKeyStore.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/services/forms/service.ts
git commit -m "fix(forms): fetchForm uses viewKey; fetchResponses decrypts with signingKey; explicit encryption tag"
```

---

## Task 5: Delete formsKeyStore, update stores/index, fix AppShell

**Files:**

- Delete: `packages/app/src/stores/formsKeyStore.ts`
- Modify: `packages/app/src/stores/index.ts`
- Modify: `packages/app/src/layout/AppShell.tsx`

- [ ] **Step 1: Delete formsKeyStore.ts**

```bash
rm packages/app/src/stores/formsKeyStore.ts
```

- [ ] **Step 2: Remove formsKeyStore from stores/index.ts**

In `packages/app/src/stores/index.ts`, delete the line:

```ts
export { useFormsKeyStore } from "./formsKeyStore";
```

- [ ] **Step 3: Clean up AppShell.tsx**

In `packages/app/src/layout/AppShell.tsx`:

1. Remove the import:

```ts
import { hexToBytes } from "../services/forms/keys";
```

2. Change the stores import from:

```ts
import { useAuthStore, useSettingsStore, useFormsKeyStore } from "../stores";
```

to:

```ts
import { useAuthStore, useSettingsStore } from "../stores";
```

3. Remove these three lines (the formsKeyStore hook calls):

```ts
const startFormsKeyStore = useFormsKeyStore((s) => s.start);
const stopFormsKeyStore = useFormsKeyStore((s) => s.stop);
const rememberViewKey = useFormsKeyStore((s) => s.remember);
```

4. Remove the formsKeyStore start/stop effect (lines ~31-35):

```ts
useEffect(() => {
  if (!isLoggedIn) return;
  startFormsKeyStore();
  return () => stopFormsKeyStore();
}, [isLoggedIn, startFormsKeyStore, stopFormsKeyStore]);
```

5. Remove the hash-based view-key parsing effect (lines ~43-59):

```ts
useEffect(() => {
  const hash = window.location.hash;
  if (!hash.startsWith("#view-key=")) return;
  // ... entire block ...
  }
}, [rememberViewKey]);
```

- [ ] **Step 4: Typecheck**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app typecheck
```

Expected: errors only in formsStore (loadForm/loadResponses don't pass keys yet).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/stores/index.ts packages/app/src/layout/AppShell.tsx
git rm packages/app/src/stores/formsKeyStore.ts
git commit -m "fix(forms): delete formsKeyStore; remove NIP-59 subscription wiring from AppShell"
```

---

## Task 6: Update formsStore to pass keys through service calls

**Files:**

- Modify: `packages/app/src/stores/formsStore.ts`

- [ ] **Step 1: Rewrite formsStore.ts**

Replace the entire content of `packages/app/src/stores/formsStore.ts` with:

```ts
import { create } from "zustand";

import type { FormSummary, FormTemplate, FormResponseEvent } from "../services/forms";
import * as formsService from "../services/forms/service";

interface FormsStore {
  myForms: FormSummary[];
  currentForm: FormTemplate | null;
  responses: FormResponseEvent[];
  isLoading: boolean;
  error: string | null;

  fetchMyForms(): Promise<void>;
  loadForm(pubkey: string, formId: string): Promise<void>;
  loadResponses(pubkey: string, formId: string): Promise<void>;
  createForm(params: formsService.CreateFormParams): Promise<formsService.CreateFormResult>;
  deleteForm(formId: string, formPubkey: string): Promise<void>;
  clearCurrent(): void;
}

export const useFormsStore = create<FormsStore>((set, get) => ({
  myForms: [],
  currentForm: null,
  responses: [],
  isLoading: false,
  error: null,

  async fetchMyForms() {
    set({ isLoading: true, error: null });
    try {
      const forms = await formsService.fetchMyForms();
      set({ myForms: forms, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to fetch forms", isLoading: false });
    }
  },

  async loadForm(pubkey, formId) {
    set({ isLoading: true, error: null, currentForm: null });
    try {
      // Look up viewKey for this form from the cached list
      const summary = get().myForms.find((f) => f.pubkey === pubkey && f.id === formId);
      const form = await formsService.fetchForm(pubkey, formId, summary?.viewKey);
      set({ currentForm: form, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to load form", isLoading: false });
    }
  },

  async loadResponses(pubkey, formId) {
    set({ isLoading: true, error: null });
    try {
      const summary = get().myForms.find((f) => f.pubkey === pubkey && f.id === formId);
      const responses = await formsService.fetchResponses(pubkey, formId, summary?.signingKey);
      set({ responses, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to load responses", isLoading: false });
    }
  },

  async createForm(params) {
    set({ error: null });
    try {
      const result = await formsService.createForm(params);
      const newSummary: FormSummary = {
        id: result.formId,
        name: params.name,
        pubkey: result.pubkey,
        createdAt: Math.floor(Date.now() / 1000),
        isEncrypted: !!params.encrypt,
        signingKey: result.signingKey,
        viewKey: result.viewKey,
      };
      set((state) => ({ myForms: [...state.myForms, newSummary] }));
      return result;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to create form" });
      throw e;
    }
  },

  async deleteForm(formId, formPubkey) {
    try {
      await formsService.deleteForm(formId, formPubkey);
      set((state) => ({
        myForms: state.myForms.filter((f) => !(f.id === formId && f.pubkey === formPubkey)),
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to delete form" });
    }
  },

  clearCurrent() {
    set({ currentForm: null, responses: [] });
  },
}));
```

- [ ] **Step 2: Typecheck — expect zero errors**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Run build to confirm**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app build
```

Expected: successful build.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/stores/formsStore.ts
git commit -m "fix(forms): formsStore passes viewKey to fetchForm, signingKey to fetchResponses"
```

---

## Task 7: Write and run service tests

**Files:**

- Create: `packages/app/src/services/forms/service.test.ts`

- [ ] **Step 1: Create the test file**

Create `packages/app/src/services/forms/service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Event } from "nostr-tools";

// Mock @formstr/core singletons
vi.mock("@formstr/core", () => ({
  signerManager: {
    getSigner: vi.fn(),
  },
  nostrRuntime: {
    publish: vi.fn(),
    fetchOne: vi.fn(),
    querySync: vi.fn(),
    subscribe: vi.fn(),
  },
  relayManager: {
    getRelaysForModule: vi.fn(() => ["wss://relay.test"]),
  },
  nip44SelfEncrypt: vi.fn(),
  nip44SelfDecrypt: vi.fn(),
  LocalSigner: vi.fn().mockImplementation((sk: Uint8Array) => ({
    nip44Encrypt: vi.fn(),
    nip44Decrypt: vi.fn(),
    getPublicKey: vi.fn(),
    signEvent: vi.fn(),
  })),
}));

import {
  signerManager,
  nostrRuntime,
  relayManager,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
  LocalSigner,
} from "@formstr/core";
import { createForm, fetchForm, fetchResponses, fetchMyForms, deleteForm } from "./service";

const mockSigner = {
  getPublicKey: vi.fn().mockResolvedValue("aabbcc"),
  signEvent: vi
    .fn()
    .mockImplementation((e) => Promise.resolve({ ...e, id: "eid", sig: "sig", pubkey: "aabbcc" })),
  nip44Encrypt: vi.fn(),
  nip44Decrypt: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (signerManager.getSigner as any).mockResolvedValue(mockSigner);
  (relayManager.getRelaysForModule as any).mockReturnValue(["wss://relay.test"]);
  (nostrRuntime.publish as any).mockResolvedValue(undefined);
  (nostrRuntime.fetchOne as any).mockResolvedValue(null);
  (nostrRuntime.querySync as any).mockResolvedValue([]);
});

// ── createForm ────────────────────────────────────────────────

describe("createForm — plain form", () => {
  it("publishes kind-30168 with field tags and no content", async () => {
    const result = await createForm({
      name: "My Form",
      fields: [{ id: "f1", type: "shortText" as any, label: "Name" }],
    });
    expect(nostrRuntime.publish).toHaveBeenCalledTimes(2); // form + list
    const [, event] = (nostrRuntime.publish as any).mock.calls[0];
    expect(event.kind).toBe(30168);
    expect(event.content).toBe("");
    expect(event.tags.some((t: string[]) => t[0] === "field")).toBe(true);
    expect(result.formId).toBeTruthy();
    expect(result.pubkey).toBe("aabbcc");
  });
});

describe("createForm — encrypted form", () => {
  it("publishes kind-30168 with encrypted content and saves keys to kind-14083", async () => {
    // Mock the LocalSigner instance that will be created for the form key
    const mockFormSigner = { nip44Encrypt: vi.fn().mockResolvedValue("enc_content") };
    (LocalSigner as any).mockImplementationOnce(() => mockFormSigner);

    // Second LocalSigner instance (for appendToMyFormsList's decrypt attempts - none expected)
    (nostrRuntime.fetchOne as any).mockResolvedValueOnce(null); // no existing list

    (nip44SelfEncrypt as any).mockResolvedValue("enc_list");
    mockSigner.signEvent.mockImplementation((e) =>
      Promise.resolve({ ...e, id: "list-eid", sig: "sig", pubkey: "aabbcc" }),
    );

    const result = await createForm({
      name: "Secret Form",
      fields: [{ id: "f1", type: "shortText" as any, label: "Q1" }],
      encrypt: true,
    });

    expect(result.signingKey).toBeTruthy();
    expect(result.viewKey).toBeTruthy();

    // First publish: kind-30168 with encrypted content
    const [, formEvent] = (nostrRuntime.publish as any).mock.calls[0];
    expect(formEvent.kind).toBe(30168);
    expect(formEvent.content).toBe("enc_content");
    expect(formEvent.tags.some((t: string[]) => t[0] === "encryption" && t[1] === "view-key")).toBe(
      true,
    );

    // Second publish: kind-14083 list
    const [, listEvent] = (nostrRuntime.publish as any).mock.calls[1];
    expect(listEvent.kind).toBe(14083);
    expect(nip44SelfEncrypt).toHaveBeenCalledWith(
      mockSigner,
      expect.stringContaining(result.signingKey!),
    );
  });
});

// ── fetchForm ─────────────────────────────────────────────────

describe("fetchForm — plain form", () => {
  it("returns parsed form with fields", async () => {
    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "eid",
      pubkey: "aabbcc",
      kind: 30168,
      created_at: 1000,
      content: "",
      tags: [
        ["d", "form1"],
        ["name", "My Form"],
        ["field", "f1", "shortText", "Name", "[]", '{"required":false}'],
      ],
      sig: "sig",
    } satisfies Event);

    const form = await fetchForm("aabbcc", "form1");
    expect(form).not.toBeNull();
    expect(form!.fields).toHaveLength(1);
    expect(form!.isEncrypted).toBe(false);
  });
});

describe("fetchForm — encrypted form, correct viewKey", () => {
  it("decrypts fields using viewKey via LocalSigner", async () => {
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
      content: "encrypted_blob",
      tags: [
        ["d", "form1"],
        ["name", "Enc Form"],
        ["encryption", "view-key"],
      ],
      sig: "sig",
    } satisfies Event);

    const form = await fetchForm("formpub", "form1", "viewkeyHex");
    expect(form!.fields).toHaveLength(1);
    expect(form!.fields[0].label).toBe("Secret Q");
    expect(mockViewSigner.nip44Decrypt).toHaveBeenCalledWith("formpub", "encrypted_blob");
  });
});

describe("fetchForm — encrypted form, no viewKey", () => {
  it("returns form with empty fields and isEncrypted=true", async () => {
    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "eid",
      pubkey: "formpub",
      kind: 30168,
      created_at: 1000,
      content: "encrypted_blob",
      tags: [
        ["d", "form1"],
        ["name", "Enc Form"],
        ["encryption", "view-key"],
      ],
      sig: "sig",
    } satisfies Event);

    const form = await fetchForm("formpub", "form1");
    expect(form!.isEncrypted).toBe(true);
    expect(form!.fields).toHaveLength(0);
  });
});

// ── fetchResponses ────────────────────────────────────────────

describe("fetchResponses — plain responses", () => {
  it("returns responses with fields populated", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "r1",
        pubkey: "respondent",
        kind: 1069,
        created_at: 2000,
        content: "",
        tags: [
          ["a", "30168:formpub:form1"],
          ["response", "f1", "Alice", ""],
        ],
        sig: "sig",
      } satisfies Event,
    ]);

    const responses = await fetchResponses("formpub", "form1");
    expect(responses).toHaveLength(1);
    expect(responses[0].responses[0].answer).toBe("Alice");
    expect(responses[0].wasEncrypted).toBe(false);
  });
});

describe("fetchResponses — encrypted response, correct signingKey", () => {
  it("decrypts response content using signingKey", async () => {
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
        content: "enc_response",
        tags: [["a", "30168:formpub:form1"]],
        sig: "sig",
      } satisfies Event,
    ]);

    const responses = await fetchResponses("formpub", "form1", "signingKeyHex");
    expect(responses[0].responses[0].answer).toBe("Secret answer");
    expect(mockFormSigner.nip44Decrypt).toHaveBeenCalledWith("respondent", "enc_response");
  });
});

describe("fetchResponses — encrypted response, no signingKey", () => {
  it("returns response with wasEncrypted=true and empty responses array", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "r1",
        pubkey: "respondent",
        kind: 1069,
        created_at: 2000,
        content: "enc_response",
        tags: [["a", "30168:formpub:form1"]],
        sig: "sig",
      } satisfies Event,
    ]);

    const responses = await fetchResponses("formpub", "form1");
    expect(responses[0].wasEncrypted).toBe(true);
    expect(responses[0].responses).toHaveLength(0);
  });
});

// ── fetchMyForms ──────────────────────────────────────────────

describe("fetchMyForms — returns summaries with keys from kind-14083", () => {
  it("parses tag-tuples and populates signingKey/viewKey on each summary", async () => {
    (nip44SelfDecrypt as any).mockResolvedValue(
      JSON.stringify([["f", "formpub:form1", "wss://relay.test", "sigKey:viewKey"]]),
    );
    (nostrRuntime.fetchOne as any).mockResolvedValueOnce({
      id: "list",
      pubkey: "aabbcc",
      kind: 14083,
      created_at: 1000,
      content: "enc",
      tags: [],
      sig: "sig",
    } satisfies Event);
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "fe",
        pubkey: "formpub",
        kind: 30168,
        created_at: 1000,
        content: "encrypted_blob",
        tags: [
          ["d", "form1"],
          ["name", "Enc Form"],
          ["encryption", "view-key"],
        ],
        sig: "sig",
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
  it("publishes kind-5 with correct a-tag", async () => {
    await deleteForm("form1", "formpub");
    const [, event] = (nostrRuntime.publish as any).mock.calls[0];
    expect(event.kind).toBe(5);
    expect(event.tags).toContainEqual(["a", "30168:formpub:form1"]);
    expect(event.tags).toContainEqual(["k", "30168"]);
  });
});
```

- [ ] **Step 2: Run tests — expect them to fail first**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app test --run packages/app/src/services/forms/service.test.ts
```

Expected: failures — implementation not wired yet in some areas.

- [ ] **Step 3: Run tests after all Task 3-6 changes are in**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app test --run packages/app/src/services/forms/service.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/services/forms/service.test.ts
git commit -m "test(forms): service unit tests — createForm, fetchForm, fetchResponses, fetchMyForms, deleteForm"
```

---

## Task 8: Write and run formsStore tests

**Files:**

- Create: `packages/app/src/stores/formsStore.test.ts`

- [ ] **Step 1: Create the test file**

Create `packages/app/src/stores/formsStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/forms/service", () => ({
  fetchMyForms: vi.fn(),
  fetchForm: vi.fn(),
  fetchResponses: vi.fn(),
  createForm: vi.fn(),
  deleteForm: vi.fn(),
  saveToMyForms: vi.fn(),
}));

import * as formsService from "../services/forms/service";
import { useFormsStore } from "./formsStore";

beforeEach(() => {
  vi.clearAllMocks();
  // Reset zustand store state between tests
  useFormsStore.setState({
    myForms: [],
    currentForm: null,
    responses: [],
    isLoading: false,
    error: null,
  });
});

describe("fetchMyForms", () => {
  it("populates myForms with signingKey and viewKey from service", async () => {
    (formsService.fetchMyForms as any).mockResolvedValue([
      {
        id: "f1",
        name: "Form",
        pubkey: "pub",
        createdAt: 0,
        isEncrypted: true,
        signingKey: "sk",
        viewKey: "vk",
      },
    ]);

    await useFormsStore.getState().fetchMyForms();

    const { myForms } = useFormsStore.getState();
    expect(myForms).toHaveLength(1);
    expect(myForms[0].signingKey).toBe("sk");
    expect(myForms[0].viewKey).toBe("vk");
    expect(useFormsStore.getState().isLoading).toBe(false);
  });
});

describe("loadForm", () => {
  it("passes viewKey from myForms to fetchForm", async () => {
    useFormsStore.setState({
      myForms: [
        {
          id: "f1",
          name: "Form",
          pubkey: "pub",
          createdAt: 0,
          isEncrypted: true,
          signingKey: "sk",
          viewKey: "vk",
        },
      ],
    });
    (formsService.fetchForm as any).mockResolvedValue({
      id: "f1",
      name: "Form",
      fields: [],
      isEncrypted: true,
    });

    await useFormsStore.getState().loadForm("pub", "f1");

    expect(formsService.fetchForm).toHaveBeenCalledWith("pub", "f1", "vk");
  });

  it("passes undefined viewKey when form is not in myForms", async () => {
    (formsService.fetchForm as any).mockResolvedValue({
      id: "f2",
      name: "Unknown",
      fields: [],
      isEncrypted: false,
    });

    await useFormsStore.getState().loadForm("pub", "f2");

    expect(formsService.fetchForm).toHaveBeenCalledWith("pub", "f2", undefined);
  });
});

describe("loadResponses", () => {
  it("passes signingKey from myForms to fetchResponses", async () => {
    useFormsStore.setState({
      myForms: [
        {
          id: "f1",
          name: "Form",
          pubkey: "pub",
          createdAt: 0,
          isEncrypted: true,
          signingKey: "sk",
          viewKey: "vk",
        },
      ],
    });
    (formsService.fetchResponses as any).mockResolvedValue([]);

    await useFormsStore.getState().loadResponses("pub", "f1");

    expect(formsService.fetchResponses).toHaveBeenCalledWith("pub", "f1", "sk");
  });
});

describe("createForm", () => {
  it("adds form to myForms with signingKey and viewKey optimistically", async () => {
    (formsService.createForm as any).mockResolvedValue({
      formId: "f1",
      pubkey: "formpub",
      signingKey: "sk",
      viewKey: "vk",
    });

    await useFormsStore.getState().createForm({ name: "New", fields: [], encrypt: true });

    const { myForms } = useFormsStore.getState();
    expect(myForms).toHaveLength(1);
    expect(myForms[0].signingKey).toBe("sk");
    expect(myForms[0].viewKey).toBe("vk");
    expect(myForms[0].isEncrypted).toBe(true);
  });
});

describe("deleteForm", () => {
  it("removes form from myForms on success", async () => {
    useFormsStore.setState({
      myForms: [{ id: "f1", name: "Form", pubkey: "pub", createdAt: 0, isEncrypted: false }],
    });
    (formsService.deleteForm as any).mockResolvedValue(undefined);

    await useFormsStore.getState().deleteForm("f1", "pub");

    expect(useFormsStore.getState().myForms).toHaveLength(0);
  });

  it("sets error and keeps myForms on service failure", async () => {
    useFormsStore.setState({
      myForms: [{ id: "f1", name: "Form", pubkey: "pub", createdAt: 0, isEncrypted: false }],
    });
    (formsService.deleteForm as any).mockRejectedValue(new Error("relay offline"));

    await useFormsStore.getState().deleteForm("f1", "pub");

    expect(useFormsStore.getState().myForms).toHaveLength(1);
    expect(useFormsStore.getState().error).toContain("offline");
  });
});
```

- [ ] **Step 2: Run the store tests**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app test --run packages/app/src/stores/formsStore.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run full test suite**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app test --run
```

Expected: all pass, no regressions.

- [ ] **Step 4: Check coverage on forms service**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app test --run --coverage 2>&1 | grep "services/forms"
```

Expected: ≥80% line coverage.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/stores/formsStore.test.ts
git commit -m "test(forms): formsStore unit tests — fetchMyForms, loadForm, loadResponses, createForm, deleteForm"
```

---

## Task 9: CI check — typecheck, lint, build

- [ ] **Step 1: Full typecheck**

```bash
cd /extra/formstr/super-app && pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 2: Lint**

```bash
cd /extra/formstr/super-app && pnpm lint
```

Expected: 0 errors.

- [ ] **Step 3: Build**

```bash
cd /extra/formstr/super-app && pnpm build
```

Expected: successful build.

- [ ] **Step 4: Update .superpowers/CLAUDE-week3&4.md — mark PR 1 done, note any issues found**

---

# PR 2 Tasks

## Branch: `upstream-week3&4-pr2` (create from upstream-week3&4-pr1 after PR 1 merges)

```bash
git checkout -b "upstream-week3&4-pr2"
```

## Task 10: Extract FormFieldsRenderer

**Files:**

- Create: `packages/app/src/components/forms/FormFieldsRenderer.tsx`

This is the shared pure renderer that both `FillFormDialog` and `FillPage` use. Extract it first so downstream components can import it.

- [ ] **Step 1: Create FormFieldsRenderer.tsx**

Read the field-rendering section of `FormsPage.tsx` (the inline render inside the fill dialog section). Extract it into:

Create `packages/app/src/components/forms/FormFieldsRenderer.tsx`:

```tsx
import { Box } from "@mui/material";
import type { FormField } from "../../services/forms/types";
import { FieldInput } from "./FieldInput";

interface Props {
  fields: FormField[];
  values: Record<string, string>;
  onChange: (fieldId: string, value: string) => void;
}

export function FormFieldsRenderer({ fields, values, onChange }: Props) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {fields.map((field) => (
        <FieldInput
          key={field.id}
          field={field}
          value={values[field.id] ?? ""}
          onChange={(val) => onChange(field.id, val)}
        />
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/forms/FormFieldsRenderer.tsx
git commit -m "refactor(forms): extract FormFieldsRenderer shared pure field renderer"
```

---

## Task 11: Extract FormCard and FormListView

**Files:**

- Create: `packages/app/src/components/forms/FormCard.tsx`
- Create: `packages/app/src/components/forms/FormListView.tsx`

- [ ] **Step 1: Create FormCard.tsx**

Create `packages/app/src/components/forms/FormCard.tsx`:

```tsx
import { Box, Card, CardContent, Chip, IconButton, Tooltip, Typography } from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditNoteIcon from "@mui/icons-material/EditNote";
import BarChartIcon from "@mui/icons-material/BarChart";
import LinkIcon from "@mui/icons-material/Link";
import LockIcon from "@mui/icons-material/Lock";
import { useState } from "react";
import type { FormSummary } from "../../services/forms/types";

interface Props {
  form: FormSummary;
  onFill: (form: FormSummary) => void;
  onViewResponses: (form: FormSummary) => void;
  onDelete: (form: FormSummary) => void;
  onCopyLink: (form: FormSummary) => void;
}

export function FormCard({ form, onFill, onViewResponses, onDelete, onCopyLink }: Props) {
  const [hovered, setHovered] = useState(false);

  return (
    <Card
      variant="outlined"
      sx={{ cursor: "pointer", position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onFill(form)}
    >
      <CardContent sx={{ pb: "12px !important" }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
          <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 600 }}>
            {form.name}
          </Typography>
          {form.isEncrypted && (
            <Chip
              icon={<LockIcon sx={{ fontSize: 12 }} />}
              label="Encrypted"
              size="small"
              variant="outlined"
              sx={{ fontSize: 11 }}
            />
          )}
        </Box>

        {hovered && (
          <Box sx={{ display: "flex", gap: 0.5, mt: 1 }} onClick={(e) => e.stopPropagation()}>
            <Tooltip title="Fill form">
              <IconButton size="small" onClick={() => onFill(form)}>
                <EditNoteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="View responses">
              <IconButton size="small" onClick={() => onViewResponses(form)}>
                <BarChartIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Copy link">
              <IconButton size="small" onClick={() => onCopyLink(form)}>
                <LinkIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton size="small" color="error" onClick={() => onDelete(form)}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create FormListView.tsx**

Create `packages/app/src/components/forms/FormListView.tsx`:

```tsx
import { Box, Button, Grid2 as MuiGrid, Skeleton, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import type { FormSummary } from "../../services/forms/types";
import { FormCard } from "./FormCard";

interface Props {
  forms: FormSummary[];
  isLoading: boolean;
  onFill: (form: FormSummary) => void;
  onViewResponses: (form: FormSummary) => void;
  onDelete: (form: FormSummary) => void;
  onCopyLink: (form: FormSummary) => void;
  onCreateNew: () => void;
}

export function FormListView({
  forms,
  isLoading,
  onFill,
  onViewResponses,
  onDelete,
  onCopyLink,
  onCreateNew,
}: Props) {
  if (isLoading) {
    return (
      <MuiGrid container spacing={2}>
        {[1, 2, 3].map((i) => (
          <MuiGrid key={i} size={{ xs: 12, sm: 6, md: 4 }}>
            <Skeleton variant="rounded" height={80} />
          </MuiGrid>
        ))}
      </MuiGrid>
    );
  }

  if (forms.length === 0) {
    return (
      <Box sx={{ textAlign: "center", py: 8 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No forms yet. Create your first form to get started.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={onCreateNew}>
          New Form
        </Button>
      </Box>
    );
  }

  return (
    <MuiGrid container spacing={2}>
      {forms.map((form) => (
        <MuiGrid key={`${form.pubkey}:${form.id}`} size={{ xs: 12, sm: 6, md: 4 }}>
          <FormCard
            form={form}
            onFill={onFill}
            onViewResponses={onViewResponses}
            onDelete={onDelete}
            onCopyLink={onCopyLink}
          />
        </MuiGrid>
      ))}
    </MuiGrid>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/components/forms/FormCard.tsx packages/app/src/components/forms/FormListView.tsx
git commit -m "refactor(forms): extract FormCard and FormListView components"
```

---

## Task 12: Extract CreateFormDialog, FillFormDialog, ResponsesDialog

**Files:**

- Create: `packages/app/src/components/forms/CreateFormDialog.tsx`
- Create: `packages/app/src/components/forms/FillFormDialog.tsx`
- Create: `packages/app/src/components/forms/ResponsesDialog.tsx`

These are extracted verbatim from the relevant dialog sections of `FormsPage.tsx`. The logic moves into the components; `FormsPage` just passes `open/onClose` props.

- [ ] **Step 1: Create CreateFormDialog.tsx**

Read the create-form dialog section from `FormsPage.tsx` (search for `activeDialog === "create"` or the create form Dialog component). Extract into:

Create `packages/app/src/components/forms/CreateFormDialog.tsx`:

```tsx
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useState } from "react";
import type { FormField } from "../../services/forms/types";
import { useFormsStore } from "../../stores/formsStore";
import { AnswerType } from "../../services/forms/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateFormDialog({ open, onClose }: Props) {
  const createForm = useFormsStore((s) => s.createForm);
  const [name, setName] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [encrypt, setEncrypt] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const addField = () =>
    setFields((prev) => [
      ...prev,
      { id: crypto.randomUUID().slice(0, 8), type: AnswerType.shortText, label: "" },
    ]);

  const removeField = (id: string) => setFields((prev) => prev.filter((f) => f.id !== id));

  const updateLabel = (id: string, label: string) =>
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, label } : f)));

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await createForm({ name: name.trim(), fields, encrypt });
      setName("");
      setFields([]);
      setEncrypt(false);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create Form</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
        <TextField
          label="Form name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          size="small"
          autoFocus
        />
        {fields.map((field) => (
          <Box key={field.id} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <TextField
              label="Field label"
              value={field.label}
              onChange={(e) => updateLabel(field.id, e.target.value)}
              size="small"
              sx={{ flex: 1 }}
            />
            <IconButton size="small" onClick={() => removeField(field.id)}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
        <Button
          startIcon={<AddIcon />}
          size="small"
          onClick={addField}
          sx={{ alignSelf: "flex-start" }}
        >
          Add field
        </Button>
        <FormControlLabel
          control={<Switch checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} />}
          label={
            <Typography variant="body2">Encrypt form (only you can read responses)</Typography>
          }
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!name.trim() || submitting}>
          {submitting ? "Creating…" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create FillFormDialog.tsx**

Read the fill-form dialog section from `FormsPage.tsx` (search for `activeDialog === "fill"`). Extract into:

Create `packages/app/src/components/forms/FillFormDialog.tsx`:

```tsx
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { useState } from "react";
import type { FormTemplate } from "../../services/forms/types";
import * as formsService from "../../services/forms/service";
import { FormFieldsRenderer } from "./FormFieldsRenderer";

interface Props {
  open: boolean;
  form: FormTemplate | null;
  isLoading: boolean;
  onClose: () => void;
}

export function FillFormDialog({ open, form, isLoading, onClose }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (fieldId: string, value: string) =>
    setValues((prev) => ({ ...prev, [fieldId]: value }));

  const handleSubmit = async () => {
    if (!form) return;
    setSubmitting(true);
    try {
      await formsService.submitResponse(
        form.pubkey,
        form.id,
        Object.entries(values).map(([fieldId, answer]) => ({ fieldId, answer })),
      );
      setValues({});
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{form?.name ?? "Fill Form"}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {isLoading || !form ? (
          <CircularProgress size={24} />
        ) : (
          <FormFieldsRenderer fields={form.fields} values={values} onChange={handleChange} />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!form || submitting}>
          {submitting ? "Submitting…" : "Submit"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 3: Create ResponsesDialog.tsx**

Read the responses dialog section from `FormsPage.tsx` (search for `activeDialog === "responses"`). Extract into:

Create `packages/app/src/components/forms/ResponsesDialog.tsx`:

```tsx
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from "@mui/material";
import { useState } from "react";
import type { FormTemplate, FormResponseEvent } from "../../services/forms/types";
import { FormAnalytics } from "./FormAnalytics";

interface Props {
  open: boolean;
  form: FormTemplate | null;
  responses: FormResponseEvent[];
  isLoading: boolean;
  onClose: () => void;
}

export function ResponsesDialog({ open, form, responses, isLoading, onClose }: Props) {
  const [tab, setTab] = useState(0);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{form?.name ?? "Responses"}</DialogTitle>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 3 }}>
        <Tab label="Responses" />
        <Tab label="Analytics" />
      </Tabs>
      <DialogContent>
        {tab === 0 && (
          <>
            {responses.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ py: 4, textAlign: "center" }}
              >
                No responses yet.
              </Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Respondent</TableCell>
                    {form?.fields.map((f) => (
                      <TableCell key={f.id}>{f.label}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {responses.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell sx={{ fontFamily: "monospace", fontSize: 11 }}>
                        {r.pubkey.slice(0, 8)}…
                      </TableCell>
                      {form?.fields.map((f) => (
                        <TableCell key={f.id}>
                          {r.responses.find((res) => res.fieldId === f.id)?.answer ?? "—"}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
        {tab === 1 && form && (
          <Box sx={{ pt: 1 }}>
            <FormAnalytics form={form} responses={responses} />
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/forms/CreateFormDialog.tsx packages/app/src/components/forms/FillFormDialog.tsx packages/app/src/components/forms/ResponsesDialog.tsx
git commit -m "refactor(forms): extract CreateFormDialog, FillFormDialog, ResponsesDialog"
```

---

## Task 13: Slim FormsPage to orchestrator

**Files:**

- Modify: `packages/app/src/pages/FormsPage.tsx`

- [ ] **Step 1: Replace FormsPage.tsx**

Replace the entire content of `packages/app/src/pages/FormsPage.tsx` with:

```tsx
import { Box, Button, Snackbar, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useEffect, useState } from "react";
import { nip19 } from "nostr-tools";

import { useFormsStore } from "../stores/formsStore";
import type { FormSummary } from "../services/forms/types";
import { CreateFormDialog } from "../components/forms/CreateFormDialog";
import { FillFormDialog } from "../components/forms/FillFormDialog";
import { FormListView } from "../components/forms/FormListView";
import { ResponsesDialog } from "../components/forms/ResponsesDialog";

type ActiveDialog = "none" | "create" | "fill" | "responses";

export default function FormsPage() {
  const {
    myForms,
    currentForm,
    responses,
    isLoading,
    fetchMyForms,
    loadForm,
    loadResponses,
    deleteForm,
  } = useFormsStore();
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>("none");
  const [selectedForm, setSelectedForm] = useState<FormSummary | null>(null);
  const [snackbar, setSnackbar] = useState("");

  useEffect(() => {
    fetchMyForms();
  }, [fetchMyForms]);

  const handleFill = (form: FormSummary) => {
    setSelectedForm(form);
    loadForm(form.pubkey, form.id);
    setActiveDialog("fill");
  };

  const handleViewResponses = (form: FormSummary) => {
    setSelectedForm(form);
    loadForm(form.pubkey, form.id);
    loadResponses(form.pubkey, form.id);
    setActiveDialog("responses");
  };

  const handleDelete = async (form: FormSummary) => {
    await deleteForm(form.id, form.pubkey);
  };

  const handleCopyLink = (form: FormSummary) => {
    const naddr = nip19.naddrEncode({
      kind: 30168,
      pubkey: form.pubkey,
      identifier: form.id,
      relays: [],
    });
    const url = `${window.location.origin}/forms/fill/${naddr}`;
    const linkUrl = form.viewKey
      ? `${url}?nkeys=${btoa(JSON.stringify({ viewKey: form.viewKey }))}`
      : url;
    navigator.clipboard.writeText(linkUrl);
    setSnackbar("Link copied");
  };

  const handleClose = () => {
    setActiveDialog("none");
    setSelectedForm(null);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h6" fontWeight={600}>
          Forms
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setActiveDialog("create")}
        >
          New Form
        </Button>
      </Box>

      <FormListView
        forms={myForms}
        isLoading={isLoading}
        onFill={handleFill}
        onViewResponses={handleViewResponses}
        onDelete={handleDelete}
        onCopyLink={handleCopyLink}
        onCreateNew={() => setActiveDialog("create")}
      />

      <CreateFormDialog open={activeDialog === "create"} onClose={handleClose} />
      <FillFormDialog
        open={activeDialog === "fill"}
        form={currentForm}
        isLoading={isLoading}
        onClose={handleClose}
      />
      <ResponsesDialog
        open={activeDialog === "responses"}
        form={currentForm}
        responses={responses}
        isLoading={isLoading}
        onClose={handleClose}
      />

      <Snackbar
        open={!!snackbar}
        autoHideDuration={2000}
        onClose={() => setSnackbar("")}
        message={snackbar}
      />
    </Box>
  );
}
```

- [ ] **Step 2: Verify line count**

```bash
wc -l packages/app/src/pages/FormsPage.tsx
```

Expected: ≤90 lines.

- [ ] **Step 3: Typecheck**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/pages/FormsPage.tsx
git commit -m "refactor(forms): slim FormsPage to ~80-LOC orchestrator"
```

---

## Task 14: Component tests for PR 2

**Files:**

- Create: `packages/app/src/components/forms/FormListView.test.tsx`
- Create: `packages/app/src/components/forms/FormCard.test.tsx`
- Create: `packages/app/src/components/forms/CreateFormDialog.test.tsx`
- Create: `packages/app/src/components/forms/FillFormDialog.test.tsx`
- Create: `packages/app/src/components/forms/ResponsesDialog.test.tsx`

- [ ] **Step 1: Create FormListView.test.tsx**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FormListView } from "./FormListView";
import type { FormSummary } from "../../services/forms/types";

const noop = vi.fn();
const forms: FormSummary[] = [
  { id: "f1", name: "Alpha", pubkey: "pub1", createdAt: 0, isEncrypted: false },
  { id: "f2", name: "Beta", pubkey: "pub2", createdAt: 0, isEncrypted: true },
];

describe("FormListView", () => {
  it("renders skeletons while loading", () => {
    const { container } = render(
      <FormListView
        forms={[]}
        isLoading
        onFill={noop}
        onViewResponses={noop}
        onDelete={noop}
        onCopyLink={noop}
        onCreateNew={noop}
      />,
    );
    expect(container.querySelectorAll(".MuiSkeleton-root").length).toBeGreaterThan(0);
  });

  it("renders empty state when forms array is empty", () => {
    render(
      <FormListView
        forms={[]}
        isLoading={false}
        onFill={noop}
        onViewResponses={noop}
        onDelete={noop}
        onCopyLink={noop}
        onCreateNew={noop}
      />,
    );
    expect(screen.getByText(/no forms yet/i)).toBeInTheDocument();
  });

  it("renders a card for each form", () => {
    render(
      <FormListView
        forms={forms}
        isLoading={false}
        onFill={noop}
        onViewResponses={noop}
        onDelete={noop}
        onCopyLink={noop}
        onCreateNew={noop}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("calls onCreateNew when button clicked in empty state", () => {
    const onCreateNew = vi.fn();
    render(
      <FormListView
        forms={[]}
        isLoading={false}
        onFill={noop}
        onViewResponses={noop}
        onDelete={noop}
        onCopyLink={noop}
        onCreateNew={onCreateNew}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /new form/i }));
    expect(onCreateNew).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Create FormCard.test.tsx**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FormCard } from "./FormCard";
import type { FormSummary } from "../../services/forms/types";

const baseForm: FormSummary = {
  id: "f1",
  name: "Test Form",
  pubkey: "pub",
  createdAt: 0,
  isEncrypted: false,
};

describe("FormCard", () => {
  it("shows encrypted badge when isEncrypted=true", () => {
    render(
      <FormCard
        form={{ ...baseForm, isEncrypted: true }}
        onFill={vi.fn()}
        onViewResponses={vi.fn()}
        onDelete={vi.fn()}
        onCopyLink={vi.fn()}
      />,
    );
    expect(screen.getByText(/encrypted/i)).toBeInTheDocument();
  });

  it("calls onFill when card is clicked", () => {
    const onFill = vi.fn();
    render(
      <FormCard
        form={baseForm}
        onFill={onFill}
        onViewResponses={vi.fn()}
        onDelete={vi.fn()}
        onCopyLink={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Test Form"));
    expect(onFill).toHaveBeenCalledWith(baseForm);
  });
});
```

- [ ] **Step 3: Create CreateFormDialog.test.tsx**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../stores/formsStore", () => ({
  useFormsStore: vi.fn(),
}));

import { useFormsStore } from "../../stores/formsStore";
import { CreateFormDialog } from "./CreateFormDialog";

const mockCreateForm = vi.fn().mockResolvedValue({ formId: "f1", pubkey: "pub" });

beforeEach(() => {
  vi.clearAllMocks();
  (useFormsStore as any).mockImplementation((selector: any) =>
    selector({ createForm: mockCreateForm }),
  );
});

describe("CreateFormDialog", () => {
  it("renders nothing visible when open=false", () => {
    render(<CreateFormDialog open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders dialog when open=true", () => {
    render(<CreateFormDialog open onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("allows typing a form name and adding a field", () => {
    render(<CreateFormDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/form name/i), { target: { value: "Survey" } });
    fireEvent.click(screen.getByRole("button", { name: /add field/i }));
    expect(screen.getByLabelText(/field label/i)).toBeInTheDocument();
  });

  it("calls createForm and closes on submit", async () => {
    const onClose = vi.fn();
    render(<CreateFormDialog open onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/form name/i), { target: { value: "My Form" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => {
      expect(mockCreateForm).toHaveBeenCalledWith(expect.objectContaining({ name: "My Form" }));
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("disables Create button while submitting", async () => {
    mockCreateForm.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<CreateFormDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/form name/i), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled());
  });
});
```

- [ ] **Step 4: Create FillFormDialog.test.tsx**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../../services/forms/service", () => ({
  submitResponse: vi.fn().mockResolvedValue(undefined),
}));

import { FillFormDialog } from "./FillFormDialog";
import type { FormTemplate } from "../../services/forms/types";
import { AnswerType } from "../../services/forms/types";

const mockForm: FormTemplate = {
  id: "f1",
  name: "Survey",
  pubkey: "pub",
  fields: [{ id: "q1", type: AnswerType.shortText, label: "Your name" }],
  settings: {},
  createdAt: 0,
  isEncrypted: false,
} as any;

describe("FillFormDialog", () => {
  it("renders null/loading indicator while form is null", () => {
    render(<FillFormDialog open form={null} isLoading={false} onClose={vi.fn()} />);
    // Should show progress or empty state
    expect(screen.queryByText(/your name/i)).not.toBeInTheDocument();
  });

  it("renders field labels when form is provided", () => {
    render(<FillFormDialog open form={mockForm} isLoading={false} onClose={vi.fn()} />);
    expect(screen.getByText("Your name")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Create ResponsesDialog.test.tsx**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ResponsesDialog } from "./ResponsesDialog";
import type { FormTemplate, FormResponseEvent } from "../../services/forms/types";
import { AnswerType } from "../../services/forms/types";

const mockForm: FormTemplate = {
  id: "f1",
  name: "Form",
  pubkey: "pub",
  fields: [{ id: "q1", type: AnswerType.shortText, label: "Name" }],
  settings: {},
  createdAt: 0,
  isEncrypted: false,
} as any;

const mockResponses: FormResponseEvent[] = [
  {
    id: "r1",
    pubkey: "respondent123456",
    responses: [{ fieldId: "q1", answer: "Alice" }],
    createdAt: 0,
    event: {} as any,
  },
  {
    id: "r2",
    pubkey: "respondent789012",
    responses: [{ fieldId: "q1", answer: "Bob" }],
    createdAt: 0,
    event: {} as any,
  },
];

describe("ResponsesDialog", () => {
  it("shows empty state when no responses", () => {
    render(
      <ResponsesDialog open form={mockForm} responses={[]} isLoading={false} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/no responses yet/i)).toBeInTheDocument();
  });

  it("renders a row per response", () => {
    render(
      <ResponsesDialog
        open
        form={mockForm}
        responses={mockResponses}
        isLoading={false}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("switches to Analytics tab", () => {
    render(
      <ResponsesDialog
        open
        form={mockForm}
        responses={mockResponses}
        isLoading={false}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /analytics/i }));
    // FormAnalytics should be rendered now
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run all component tests**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app test --run packages/app/src/components/forms/
```

Expected: all pass.

- [ ] **Step 7: Run full test suite + typecheck**

```bash
cd /extra/formstr/super-app && pnpm typecheck && pnpm --filter @formstr/app test --run
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/components/forms/*.test.tsx
git commit -m "test(forms): component tests for FormListView, FormCard, CreateFormDialog, FillFormDialog, ResponsesDialog"
```

---

# PR 3 Tasks

## Branch: `upstream-week3&4-pr3` (create from upstream-week3&4-pr2 after PR 2 merges)

```bash
git checkout -b "upstream-week3&4-pr3"
```

## Task 15: Add ResponderIdentityBar

**Files:**

- Create: `packages/app/src/components/forms/ResponderIdentityBar.tsx`

- [ ] **Step 1: Create ResponderIdentityBar.tsx**

Create `packages/app/src/components/forms/ResponderIdentityBar.tsx`:

```tsx
import { Box, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import PersonOffIcon from "@mui/icons-material/PersonOff";
import PersonIcon from "@mui/icons-material/Person";
import { useAuthStore } from "../../stores";

export type IdentityMode = "anonymous" | "me";

interface Props {
  mode: IdentityMode;
  onChange: (mode: IdentityMode) => void;
  /** When true, hides the anonymous option (form requires login). */
  requiresLogin?: boolean;
}

export function ResponderIdentityBar({ mode, onChange, requiresLogin }: Props) {
  const pubkey = useAuthStore((s) => s.pubkey);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);

  if (requiresLogin) return null;
  if (!isLoggedIn) return null;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
      <Typography variant="caption" color="text.secondary">
        Submit as:
      </Typography>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={mode}
        onChange={(_, val) => {
          if (val) onChange(val as IdentityMode);
        }}
      >
        <ToggleButton value="anonymous">
          <PersonOffIcon fontSize="small" sx={{ mr: 0.5 }} />
          Anonymous
        </ToggleButton>
        <ToggleButton value="me">
          <PersonIcon fontSize="small" sx={{ mr: 0.5 }} />
          {pubkey ? pubkey.slice(0, 8) + "…" : "Me"}
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/components/forms/ResponderIdentityBar.tsx
git commit -m "feat(forms): add ResponderIdentityBar — anonymous vs logged-in toggle"
```

---

## Task 16: Create FillPage

**Files:**

- Create: `packages/app/src/pages/FillPage.tsx`

- [ ] **Step 1: Create FillPage.tsx**

Create `packages/app/src/pages/FillPage.tsx`:

```tsx
import { Box, Button, CircularProgress, Container, Divider, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { nip19 } from "nostr-tools";
import type { AddressPointer } from "nostr-tools/lib/types/nip19";

import * as formsService from "../services/forms/service";
import type { FormTemplate, FormResponse } from "../services/forms/types";
import { signerManager } from "@formstr/core";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import { FormFieldsRenderer } from "../components/forms/FormFieldsRenderer";
import { ResponderIdentityBar, type IdentityMode } from "../components/forms/ResponderIdentityBar";
import { useAuthStore } from "../stores";
import { FORM_KINDS } from "../services/forms/types";

export default function FillPage() {
  const { naddr } = useParams<{ naddr: string }>();
  const [searchParams] = useSearchParams();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);

  const [form, setForm] = useState<FormTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [identityMode, setIdentityMode] = useState<IdentityMode>("anonymous");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!naddr) return;
    let pubkey: string;
    let identifier: string;
    try {
      const decoded = nip19.decode(naddr);
      if (decoded.type !== "naddr") throw new Error("not naddr");
      const ptr = decoded.data as AddressPointer;
      pubkey = ptr.pubkey;
      identifier = ptr.identifier;
    } catch {
      setError("Invalid form link");
      setLoading(false);
      return;
    }

    // Decode optional nkeys query param for encrypted forms
    let viewKey: string | undefined;
    const nkeysRaw = searchParams.get("nkeys");
    if (nkeysRaw) {
      try {
        const parsed = JSON.parse(atob(nkeysRaw));
        viewKey = parsed.viewKey;
      } catch {
        /* malformed — ignore */
      }
    }

    formsService
      .fetchForm(pubkey, identifier, viewKey)
      .then((f) => {
        setForm(f);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load form");
        setLoading(false);
      });
  }, [naddr, searchParams]);

  const handleSubmit = async () => {
    if (!form) return;
    setSubmitting(true);
    try {
      const responses: FormResponse[] = Object.entries(values).map(([fieldId, answer]) => ({
        fieldId,
        answer,
      }));

      if (identityMode === "me" && isLoggedIn) {
        const signer = await signerManager.getSigner();
        await formsService.submitResponse(form.pubkey, form.id, responses, false, signer);
      } else {
        // Anonymous: ephemeral key
        const ephSk = generateSecretKey();
        const ephSigner = {
          getPublicKey: async () => getPublicKey(ephSk),
          signEvent: async (e: any) => finalizeEvent(e, ephSk),
          nip44Encrypt: async (recipientPubkey: string, plaintext: string) => {
            const { nip44 } = await import("nostr-tools");
            const convKey = nip44.v2.utils.getConversationKey(ephSk, recipientPubkey);
            return nip44.v2.encrypt(plaintext, convKey);
          },
          nip44Decrypt: async () => {
            throw new Error("ephemeral signer cannot decrypt");
          },
        };
        await formsService.submitResponse(form.pubkey, form.id, responses, false, ephSigner as any);
      }
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", pt: 8 }}>
        <CircularProgress />
      </Box>
    );

  if (error || !form)
    return (
      <Box sx={{ textAlign: "center", pt: 8 }}>
        <Typography color="error">{error ?? "Form not found"}</Typography>
      </Box>
    );

  if (submitted)
    return (
      <Box sx={{ textAlign: "center", pt: 8 }}>
        <Typography variant="h6">Response submitted!</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Thank you for filling out {form.name}.
        </Typography>
      </Box>
    );

  const requiresLogin = (form.settings?.allowedResponders?.length ?? 0) > 0;

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      {/* Minimal header */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h6" fontWeight={700}>
          formstr
        </Typography>
        {!isLoggedIn && (
          <Button size="small" variant="outlined">
            Log in
          </Button>
        )}
      </Box>
      <Divider sx={{ mb: 3 }} />

      <Typography variant="h5" fontWeight={600} sx={{ mb: 1 }}>
        {form.name}
      </Typography>

      <ResponderIdentityBar
        mode={identityMode}
        onChange={setIdentityMode}
        requiresLogin={requiresLogin}
      />

      <FormFieldsRenderer
        fields={form.fields}
        values={values}
        onChange={(fieldId, value) => setValues((prev) => ({ ...prev, [fieldId]: value }))}
      />

      <Box sx={{ mt: 3 }}>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting} fullWidth>
          {submitting ? "Submitting…" : "Submit"}
        </Button>
      </Box>
    </Container>
  );
}
```

- [ ] **Step 2: Update `submitResponse` in service.ts to accept an optional signer**

In `packages/app/src/services/forms/service.ts`, update `submitResponse` signature:

```ts
export async function submitResponse(
  formPubkey: string,
  formId: string,
  responses: FormResponse[],
  encrypt = false,
  overrideSigner?: {
    getPublicKey(): Promise<string>;
    signEvent(e: any): Promise<any>;
    nip44Encrypt?(pk: string, p: string): Promise<string>;
  },
): Promise<void> {
  const signer = overrideSigner ?? (await signerManager.getSigner());
  // rest unchanged
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/pages/FillPage.tsx packages/app/src/services/forms/service.ts
git commit -m "feat(forms): add FillPage — standalone public form fill route with nkeys support"
```

---

## Task 17: Register /forms/fill/:naddr route

**Files:**

- Modify: `packages/app/src/router.tsx`

- [ ] **Step 1: Read router.tsx and add FillPage route**

Open `packages/app/src/router.tsx`. Locate the top-level routes array. Add the FillPage route **outside** the AppShell children:

```tsx
import FillPage from "./pages/FillPage";
```

Then in the routes array, add before (or alongside) the existing AppShell route:

```tsx
{
  path: "/forms/fill/:naddr",
  element: <FillPage />,
},
```

The FillPage route must be at the top level, not nested inside the AppShell route's children.

- [ ] **Step 2: Typecheck**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/router.tsx
git commit -m "feat(forms): register /forms/fill/:naddr public route outside AppShell"
```

---

## Task 18: Add coverage gate

**Files:**

- Modify: `packages/app/vitest.config.ts`

- [ ] **Step 1: Read vitest.config.ts**

Read `packages/app/vitest.config.ts`. Add a coverage threshold for the forms service:

```ts
coverage: {
  // existing coverage config...
  thresholds: {
    // existing thresholds...
    "src/services/forms/**": {
      lines: 80,
    },
  },
},
```

If no `thresholds` key exists yet, add it inside the `coverage` object.

- [ ] **Step 2: Verify coverage meets threshold**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app test --run --coverage 2>&1 | grep -E "forms|threshold|FAIL"
```

Expected: threshold met (no FAIL on forms).

- [ ] **Step 3: Commit**

```bash
git add packages/app/vitest.config.ts
git commit -m "ci(forms): enforce 80% line coverage on services/forms/"
```

---

## Task 19: PR 3 tests — FillPage and ResponderIdentityBar

**Files:**

- Create: `packages/app/src/pages/FillPage.test.tsx`
- Create: `packages/app/src/components/forms/ResponderIdentityBar.test.tsx`

- [ ] **Step 1: Create FillPage.test.tsx**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { nip19 } from "nostr-tools";

vi.mock("../services/forms/service", () => ({
  fetchForm: vi.fn(),
  submitResponse: vi.fn(),
}));
vi.mock("../stores", () => ({
  useAuthStore: vi.fn((selector: any) => selector({ isLoggedIn: false, pubkey: null })),
}));
vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
}));

import * as formsService from "../services/forms/service";
import FillPage from "./FillPage";
import { AnswerType } from "../services/forms/types";

const mockForm = {
  id: "form1",
  name: "Test Survey",
  pubkey: "formpub",
  fields: [{ id: "q1", type: AnswerType.shortText, label: "Your name" }],
  settings: {},
  createdAt: 0,
  isEncrypted: false,
} as any;

const naddr = nip19.naddrEncode({
  kind: 30168,
  pubkey: "formpub",
  identifier: "form1",
  relays: [],
});

function renderFillPage(path = `/forms/fill/${naddr}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/forms/fill/:naddr" element={<FillPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (formsService.fetchForm as any).mockResolvedValue(mockForm);
});

describe("FillPage", () => {
  it("shows loading state while fetching form", () => {
    (formsService.fetchForm as any).mockImplementation(() => new Promise(() => {}));
    renderFillPage();
    expect(document.querySelector(".MuiCircularProgress-root")).toBeInTheDocument();
  });

  it("renders form fields after fetch", async () => {
    renderFillPage();
    await waitFor(() => expect(screen.getByText("Your name")).toBeInTheDocument());
  });

  it("calls fetchForm with viewKey when nkeys param is present", async () => {
    const nkeysParam = btoa(JSON.stringify({ viewKey: "deadbeef" }));
    renderFillPage(`/forms/fill/${naddr}?nkeys=${nkeysParam}`);
    await waitFor(() =>
      expect(formsService.fetchForm).toHaveBeenCalledWith("formpub", "form1", "deadbeef"),
    );
  });

  it("shows error when form not found", async () => {
    (formsService.fetchForm as any).mockResolvedValue(null);
    renderFillPage();
    await waitFor(() => expect(screen.getByText(/form not found/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Create ResponderIdentityBar.test.tsx**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../../stores", () => ({
  useAuthStore: vi.fn((selector: any) =>
    selector({ isLoggedIn: true, pubkey: "deadbeefdeadbeef" }),
  ),
}));

import { ResponderIdentityBar } from "./ResponderIdentityBar";

describe("ResponderIdentityBar", () => {
  it("shows both options when logged in and requiresLogin=false", () => {
    render(<ResponderIdentityBar mode="anonymous" onChange={vi.fn()} />);
    expect(screen.getByText(/anonymous/i)).toBeInTheDocument();
    expect(screen.getByText(/deadbeef/i)).toBeInTheDocument();
  });

  it("renders nothing when requiresLogin=true", () => {
    const { container } = render(
      <ResponderIdentityBar mode="anonymous" onChange={vi.fn()} requiresLogin />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("calls onChange when toggling to me", () => {
    const onChange = vi.fn();
    render(<ResponderIdentityBar mode="anonymous" onChange={onChange} />);
    fireEvent.click(screen.getByText(/deadbeef/i).closest("button")!);
    expect(onChange).toHaveBeenCalledWith("me");
  });
});
```

- [ ] **Step 3: Run all tests**

```bash
cd /extra/formstr/super-app && pnpm --filter @formstr/app test --run
```

Expected: all pass.

- [ ] **Step 4: Final CI check**

```bash
cd /extra/formstr/super-app && pnpm typecheck && pnpm lint && pnpm build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/pages/FillPage.test.tsx packages/app/src/components/forms/ResponderIdentityBar.test.tsx
git commit -m "test(forms): FillPage and ResponderIdentityBar tests"
```

---

## Self-Review Against Spec

| Spec requirement                           | Task             |
| ------------------------------------------ | ---------------- |
| Fix `saveToMyForms` key loss               | Task 3           |
| Fix `createForm` doesn't persist keys      | Task 3           |
| Fix `fetchForm` uses wrong decrypt         | Task 4           |
| Fix `fetchMyForms` keyless summaries       | Task 3           |
| Fix `parseResponseEvent` ignores encrypted | Task 4           |
| Fix `isEncrypted` heuristic                | Task 4           |
| Fix `bytesToHex` duplicate                 | Task 3 (imports) |
| Delete `formsKeyStore.ts`                  | Task 5           |
| Update `formsStore` to pass keys           | Task 6           |
| Remove formsKeyStore from AppShell         | Task 5           |
| `service.test.ts`                          | Task 7           |
| `formsStore.test.ts`                       | Task 8           |
| FormsPage split → components               | Tasks 10–13      |
| Per-component tests                        | Task 14          |
| `ResponderIdentityBar`                     | Task 15          |
| `FillPage` with nkeys support              | Task 16          |
| `/forms/fill/:naddr` route                 | Task 17          |
| 80% coverage gate                          | Task 18          |
| FillPage + ResponderIdentityBar tests      | Task 19          |

All spec requirements covered. No placeholders found.
