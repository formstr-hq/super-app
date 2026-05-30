# Forms Module — Parity Gaps & Bugs vs. formstr.app

**Date:** 2026-05-30  
**Scope:** `packages/app/src/services/forms/`, `stores/formsStore.ts`, `pages/FormsPage.tsx`, `pages/FillPage.tsx`, `components/forms/`  
**Purpose:** Track every known deviation from formstr.app so we can prioritise fixes before calling the forms module "ship-ready".

---

## formstr.app Core Feature Checklist

Use this as the authoritative comparison baseline. Each row is marked with its status in super-app.

| #   | Feature                                                                                            | formstr.app | super-app                | Status               |
| --- | -------------------------------------------------------------------------------------------------- | ----------- | ------------------------ | -------------------- |
| 1   | Create form (basic fields)                                                                         | ✅          | ✅                       | ✅ Done              |
| 2   | Encrypted form (NIP-44, view key)                                                                  | ✅          | ✅                       | ✅ Done              |
| 3   | My Forms list persistence (kind 14083, NIP-44)                                                     | ✅          | ✅                       | ✅ Fixed (PR4)       |
| 4   | Fallback: discover forms by author query                                                           | ✅          | ✅                       | ✅ Done              |
| 5   | Copy shareable link (naddr + viewKey in fragment)                                                  | ✅          | ✅                       | ✅ Done              |
| 6   | Public fill page (`/forms/fill/:naddr`)                                                            | ✅          | ✅                       | ✅ Done              |
| 7   | Responder identity: anonymous vs. logged-in                                                        | ✅          | ✅                       | ✅ Done              |
| 8   | Submit response (plaintext)                                                                        | ✅          | ✅                       | ✅ Done              |
| 9   | Submit response (NIP-44 encrypted to form signing key)                                             | ✅          | ⚠️ Broken                | 🐛 Bug #3            |
| 10  | View responses — table                                                                             | ✅          | ✅                       | ✅ Done              |
| 11  | View responses — analytics charts                                                                  | ✅          | ✅                       | ✅ Done              |
| 12  | Delete form (kind 5 event)                                                                         | ✅          | ✅                       | ✅ Done              |
| 13  | Field types: short text, paragraph, radio, checkbox, dropdown, number, date, time, datetime, label | ✅          | ✅                       | ✅ Done              |
| 14  | Field type: file upload (Blossom / NIP-94)                                                         | ✅          | ⚠️ Render only           | 🔧 Missing #1        |
| 15  | Field type: signature canvas                                                                       | ✅          | ⚠️ Render only           | 🔧 Missing #2        |
| 16  | Field type: grid (multiChoiceGrid / checkboxGrid)                                                  | ✅          | ⚠️ Render only           | 🔧 Missing #3        |
| 17  | Field type: section / page break                                                                   | ✅          | ⚠️ Not rendered          | 🔧 Missing #4        |
| 18  | Field reordering (drag-and-drop in builder)                                                        | ✅          | ❌                       | 🔧 Missing #5        |
| 19  | Field validation (required, min/max, regex)                                                        | ✅          | ⚠️ Types only            | 🔧 Missing #6        |
| 20  | Form settings: cover/title image                                                                   | ✅          | ❌                       | 🔧 Missing #7        |
| 21  | Form settings: custom thank-you page / text                                                        | ✅          | ❌                       | 🔧 Missing #8        |
| 22  | Form settings: notify npubs on new response                                                        | ✅          | ❌                       | 🔧 Missing #9        |
| 23  | Form settings: disallow anonymous submissions                                                      | ✅          | ⚠️ Types only            | 🔧 Missing #10       |
| 24  | Form settings: allowed responders whitelist                                                        | ✅          | ⚠️ Partial UI            | 🔧 Missing #11       |
| 25  | Collaborator access (share view key via NIP-59)                                                    | ✅          | ❌ Intentionally skipped | 📋 Future            |
| 26  | Edit existing form                                                                                 | ✅          | ❌                       | 🔧 Missing #12       |
| 27  | Response export (CSV / JSON)                                                                       | ✅          | ❌                       | 🔧 Missing #13       |
| 28  | Responder identity shown in responses table                                                        | ✅          | ❌                       | 🔧 Missing #14       |
| 29  | Real-time response subscription                                                                    | ✅          | ⚠️ One-shot only         | 🔧 Missing #15       |
| 30  | Multi-page form rendering (section breaks)                                                         | ✅          | ❌                       | 🔧 Missing #4        |
| 31  | Checkboxes work on public FillPage                                                                 | ✅          | ❌ Broken                | 🐛 Bug #2            |

---

## Section 1 — Bugs (broken behaviour, high priority)

### Bug #1 — [FIXED] kind-14083 list incompatibility (encryption + entry shape)

**What:** Forms did not sync between super-app and formstr.app. formstr.app's "My forms" even crashed on load (`Error loading forms: SyntaxError: "undefined" is not valid JSON`).

**Root cause (corrected — the original premise was wrong):** The note in `claude-context.md` claimed formstr.app encrypts the kind-14083 list with **NIP-04**. It does **not**. The live source — [formstr-hq/nostr-forms `MyFormsProvider.tsx`](https://github.com/formstr-hq/nostr-forms/blob/master/packages/formstr-app/src/provider/MyFormsProvider.tsx) — decrypts the list with **NIP-44**: `const decrypted = await signer.nip44Decrypt!(userPub, list.content); fetchFormEvents(JSON.parse(decrypted))`. A mid-cycle "fix" had switched super-app's _write_ to NIP-04 (`signer.encrypt`); formstr.app then `nip44Decrypt`-ed that NIP-04 blob, got `undefined`, and `JSON.parse(undefined)` threw — breaking its entire list load (display **and** the read-modify-write append, so new formstr.app forms never reached Nostr).

Second incompatibility in the same file: `fetchFormEvents` does `const [secretKey, viewKey] = secretData.split(":")` on `entry[3]` with **no guard**. super-app wrote public-form entries as 3-element `["f", coord, relay]`, so `entry[3]` was `undefined` → `.split` crash.

**Fix (super-app):**

- Write the kind-14083 list with **NIP-44 self-encryption** (`nip44SelfEncrypt`), matching formstr.app. (Reading keeps the `?iv=`→NIP-04 fallback so legacy/corrupted NIP-04 lists are still readable and get migrated to NIP-44 on the next write.)
- Always write **4-element entries** `["f", coord, relay, "signingKey:viewKey"|""]`, and normalise existing 3-element entries to 4 on read-modify-write, so formstr.app's `secretData.split` never sees `undefined`.

**Recovery for an already-corrupted (NIP-04) list:** open super-app once and create/save any form → it rewrites the list as NIP-44 (4-element) → formstr.app can read it again.

**Still NOT real-time:** sync is one-shot on Forms-page mount, cache-first, with a first-relay-wins `fetchOne` for the list. See Missing #15 / Compat #1.

---

### Bug #2 — Checkboxes broken on public FillPage

**Files:** [FillPage.tsx](packages/app/src/pages/FillPage.tsx), [FormFieldsRenderer.tsx](packages/app/src/components/forms/FormFieldsRenderer.tsx), [FieldInput.tsx](packages/app/src/components/forms/FieldInput.tsx)

**What:** Checkbox fields on the public fill route (`/forms/fill/:naddr`) are always unchecked and clicking them does nothing.

**Why:** `FillPage` holds state as `values: Record<string, string>` — a flat string map. Checkboxes in `FieldInput` require `checkedValues?: Set<string>` and an `onToggleCheck` callback. `FormFieldsRenderer` (used by FillPage) doesn't accept or forward either prop. So `checkedValues` is always `undefined`, `checked` is always `false`, and `onToggleCheck` is never wired up.

Compare: `FillFormDialog` (in-app fill) correctly holds separate `checkAnswers: Record<string, Set<string>>` state and passes both props to `FieldInput`.

**Proposed fix (super-app):**

1. Add `checkAnswers: Record<string, Set<string>>` state to `FillPage`.
2. Extend `FormFieldsRenderer` to accept `checkAnswers` and `onToggleCheck` and forward them to `FieldInput`.
3. Serialize checkbox answers as `JSON.stringify(Array.from(set))` before calling `submitResponse` (same as `FillFormDialog`).

---

### Bug #3 — Anonymous responses to encrypted forms are submitted unencrypted

**Files:** [FillPage.tsx:90](packages/app/src/pages/FillPage.tsx#L90)

**What:** When a user fills an encrypted form anonymously on the public fill page, their response is published in plaintext (`encrypt: false`), leaking all answers to anyone reading the relay.

**Why:** `FillPage.handleSubmit` hardcodes `false` for the `encrypt` parameter:

```ts
await formsService.submitResponse(form.pubkey, form.id, responses, false, ephSigner);
```

**Proposed fix (super-app):**
Change `false` → `form.isEncrypted`:

```ts
await formsService.submitResponse(form.pubkey, form.id, responses, form.isEncrypted, ephSigner);
```

The ephemeral signer already implements `nip44Encrypt`, so `submitResponse` will encrypt correctly to `form.pubkey` (the form's signing key pubkey).

---

### Bug #4 — Fallback `fetchMyFormsByAuthor` loses keys for encrypted forms

**Files:** [service.ts:421-438](packages/app/src/services/forms/service.ts#L421)

**What:** If the kind-14083 list is absent or unreadable, the fallback function `fetchMyFormsByAuthor` discovers your forms by author query. It returns `FormSummary` objects with **no** `signingKey` or `viewKey`. Encrypted forms loaded this way will appear with `isEncrypted: true` but blank fields (can't decrypt content) and no way to decrypt responses.

**Why:** The keys only live in the kind-14083 list tag tuple. Without that list the keys are gone — there is no other place to recover them from. The fallback has no key data to return.

**Impact:** Happens when: (a) logging in for the first time after creating forms on a different client that didn't write a kind-14083 list, (b) kind-14083 event not found on any relay.

**Proposed fix:**

- This is a known limitation of removing the NIP-59 key store. Document clearly in the UI: encrypted forms show a "Keys unavailable — use the link you were given" message with the `viewKey` hash indicator.
- No code fix needed now, but consider adding a `decryptError: "no-view-key"` UI state to `FillFormDialog`.

---

## Section 2 — Missing Features

### Missing #1 — File upload field not creatable in the builder

**Files:** [CreateFormDialog.tsx:186-194](packages/app/src/components/forms/CreateFormDialog.tsx#L186)

**What:** `AnswerType.fileUpload` is handled in `FieldInput` (uploads to Blossom) but is absent from the field type `<Select>` in `CreateFormDialog`. You cannot create a form with a file upload field.

**Why:** Not added during the builder refactor. The type and renderer exist.

**Proposed fix:** Add `<MenuItem value={AnswerType.fileUpload}>File upload</MenuItem>` to the Select. No new logic needed; the Blossom upload is already in `FieldInput`.

---

### Missing #2 — Signature field not creatable in the builder

Same root cause as Missing #1. `AnswerType.signature` renders a canvas in `FieldInput` but isn't in the builder's type selector.

**Proposed fix:** Add `<MenuItem value={AnswerType.signature}>Signature</MenuItem>`.

---

### Missing #3 — Grid fields (multiChoiceGrid / checkboxGrid) not creatable in the builder

**What:** Both grid types render correctly in `FieldInput` via `GridInput`. But:

1. They're absent from the type selector in `CreateFormDialog`.
2. Even if you could select them, there's no UI to configure `field.gridRows` and `field.gridCols`.

**Proposed fix:** Add them to the type selector and add a `GridFieldEditor` sub-form in `CreateFormDialog` (similar to how options are edited for radio/checkbox/dropdown) that lets the user add row labels and column labels.

---

### Missing #4 — Section / page-break fields

**What:** `AnswerType.section` is in the enum. `FieldInput` returns `null` for it (invisible). `CreateFormDialog` doesn't offer it.

**Why:** Multi-page form rendering (stepping through sections) was never implemented.

**Proposed fix (2 parts):**

1. Allow creating section fields in the builder — just a label field used as a divider.
2. Implement page-break rendering in `FillPage` and `FillFormDialog`: group fields between `section` markers, show one group at a time with Next/Back buttons.

---

### Missing #5 — Drag-and-drop field reordering in the builder

**Files:** [CreateFormDialog.tsx:171](packages/app/src/components/forms/CreateFormDialog.tsx#L171)

**What:** The `GripVertical` handle icon is rendered per field but there's no DnD implementation. Fields can only be reordered by deleting and re-adding.

**Proposed fix:** Add `@dnd-kit/core` + `@dnd-kit/sortable` (already used elsewhere? check) or a lightweight drag handler. The field list is already keyed by `field.id`.

---

### Missing #6 — Field validation not configurable in the builder

**What:** `FormField.validation` (`min`, `max`, `regex`, `regexError`) is in types and partially enforced in `validateFieldAnswer` (only `required` is checked). The builder has no UI to set these constraints.

**Proposed fix:**

1. Add an "Advanced" collapsible per field in `CreateFormDialog` with min/max inputs (for text: char count; for number: value range) and an optional regex + error message.
2. Enforce in `validateFieldAnswer` (currently only checks `required`).

---

### Missing #7 — Cover/title image for forms

**What:** `FormSettings.titleImageUrl` and `coverImageUrl` are in types but never set in the builder and never rendered in `FillPage` or `FillFormDialog`.

**Proposed fix:**

1. Add image URL inputs to a "Appearance" section in `CreateFormDialog`.
2. Render `coverImageUrl` as a full-width banner at the top of `FillPage` and `FillFormDialog`.

---

### Missing #8 — Custom thank-you page/text

**What:** `FormSettings.thankYouPage` and `thankYouText` are in types. Both `FillPage` and `FillFormDialog` currently show a hardcoded "Response submitted! Thank you for filling out this form." message.

**Proposed fix:**

1. Add a thank-you text input to `CreateFormDialog`.
2. In `FillPage` and `FillFormDialog`, replace the hardcoded string with `form.settings.thankYouText ?? "Thank you for your response."`.

---

### Missing #9 — Notify npubs on new response

**What:** `FormSettings.notifyNpubs: string[]` is in types. No code in `service.ts` or `formsStore.ts` sends a notification when `submitResponse` is called.

**Why:** Requires implementing a DM or NIP-59 gift-wrap notification event, which is non-trivial.

**Proposed fix (super-app):** After a successful `submitResponse`, iterate over `form.settings.notifyNpubs` and send each one a NIP-04/NIP-44 direct message (kind 4/14) with a brief notification payload. The DM service already exists for other modules; hook in here.

---

### Missing #10 — disallowAnonymous not enforced in FillPage

**What:** `FormSettings.disallowAnonymous` is in types. `FillPage` only checks `allowedResponders.length > 0` — it doesn't check `disallowAnonymous`.

**Proposed fix:**

1. Builder: add a checkbox "Require login to respond" → sets `disallowAnonymous: true`.
2. `FillPage`: `const requiresLogin = settings.disallowAnonymous || (settings.allowedResponders?.length ?? 0) > 0`.

---

### Missing #11 — allowedResponders whitelist not configurable

**What:** `FormSettings.allowedResponders` is read in `FillPage` (`requiresLogin` check) but there's no UI to set it in `CreateFormDialog`.

**Proposed fix:** Add an npub input list to the form settings section. Validate that each entry is a valid npub/hex pubkey before saving.

---

### Missing #12 — No form editing

**What:** Once a form is created you can't update its name, fields, or settings. The Pencil icon in `FormCard` currently opens `FillFormDialog` (fill, not edit).

**Why:** Form editing requires publishing a new kind-30168 event with the same `d` tag and bumped `created_at`. The service supports this in principle (same `createForm` flow would overwrite), but there's no edit UI.

**Proposed fix:**

1. Rename `FormCard`'s Pencil icon tooltip to "Fill form" (it currently says "Fill form" which is correct, but the icon implies edit — use a different icon like `FileEdit`).
2. Add a separate "Edit form" action that re-opens `CreateFormDialog` pre-populated with the existing form's data. Wire to a new `editForm(formId, params)` service call.

---

### Missing #13 — No response export (CSV / JSON)

**What:** `ResponsesDialog` shows a table but has no export button. formstr.app lets you download responses.

**Proposed fix:** Add an "Export CSV" button to `ResponsesDialog` that serialises `responses` into a CSV blob and triggers a download. No server needed — pure client-side `Blob` + `URL.createObjectURL`.

---

### Missing #14 — Responder identity not shown in responses table

**What:** `FormResponseEvent.pubkey` is available but `ResponsesDialog` only shows a row number, date, and answers. You can't see who answered.

**Proposed fix:** Add a "Responder" column showing a truncated `pubkey` (first 8 + last 4 chars) with a copy-to-clipboard button. Optionally resolve to NIP-05 display name.

---

### Missing #15 — One-shot response loading (no real-time subscription)

**What:** `formsStore.loadResponses` calls `fetchResponses` (a one-shot `querySync`). The service has a working `subscribeToResponses` live subscription, but it's not used anywhere in the UI.

**Impact:** You won't see new responses come in while you have the ResponsesDialog open. You have to close and reopen.

**Proposed fix:** Replace `fetchResponses` in `formsStore.loadResponses` with `subscribeToResponses`. Store the `SubscriptionHandle` and unsubscribe in `clearCurrent()`.

---

## Section 3 — Protocol / Architecture Compatibility

### Compat #1 — NIP-44 detection heuristic is fragile

**What:** `fetchMyForms` and `appendToMyFormsList` detect NIP-04 using `content.includes("?iv=")`. If future NIP-44 ciphertext (base64) coincidentally contains the string `?iv=`, this will misclassify it.

**Proposed fix:** Try NIP-04 first (call `signer.decrypt`), catch failure, then try NIP-44. This is strictly more robust and doesn't rely on string heuristics.

---

### Compat #2 — naddr link format must match formstr.app

**What:** super-app encodes shareable links as `/forms/fill/<naddr>` where naddr uses kind `30168`. formstr.app uses the same kind. **Verify** that the formstr.app fill route also accepts `naddr` with kind `30168` at `/f/<naddr>` or `/forms/fill/<naddr>`.

**Status:** Assumed compatible but needs end-to-end testing with a real formstr.app form link.

---

### Compat #3 — Collaborator gift-wrap (NIP-59) intentionally skipped

**What:** formstr.app supports sharing the view key with collaborators via NIP-59 gift-wrap (`wrapFormKeyForRecipient`). This was **intentionally removed** from super-app during week 3&4 to avoid NIP-59 complexity.

**Impact:** A collaborator added on formstr.app won't be able to view the encrypted form or decrypt responses in super-app.

**Status:** Future scope. Track separately when NIP-59 support is added to `@formstr/core`.

---

## Section 4 — Priority Order (suggested)

| Priority | Item                                                        | Effort           |
| -------- | ----------------------------------------------------------- | ---------------- |
| 🔴 P0    | Bug #2 — Checkboxes broken on FillPage                      | Small            |
| 🔴 P0    | Bug #3 — Anonymous responses unencrypted on encrypted forms | Trivial (1 line) |
| 🟠 P1    | Missing #1/#2 — Add fileUpload + signature to builder       | Small            |
| 🟠 P1    | Missing #13 — Response export CSV                           | Small            |
| 🟠 P1    | Missing #14 — Show responder identity in table              | Small            |
| 🟠 P1    | Missing #15 — Real-time response subscription               | Medium           |
| 🟡 P2    | Missing #5 — Drag-and-drop field reorder                    | Medium           |
| 🟡 P2    | Missing #8 — Custom thank-you text                          | Small            |
| 🟡 P2    | Missing #10/#11 — disallowAnonymous + allowedResponders UI  | Small            |
| 🟡 P2    | Missing #3 — Grid fields in builder                         | Medium           |
| 🟢 P3    | Missing #6 — Field validation UI                            | Medium           |
| 🟢 P3    | Missing #12 — Form editing                                  | Large            |
| 🟢 P3    | Missing #7 — Cover/title image                              | Medium           |
| 🟢 P3    | Missing #9 — notifyNpubs                                    | Large            |
| 🔵 P4    | Missing #4 — Section / page-break multi-page forms          | Large            |
| 🔵 P4    | Compat #3 — NIP-59 collaborator gift-wrap                   | Very large       |

---

_Do not start implementing fixes from this document until it has been reviewed together._
