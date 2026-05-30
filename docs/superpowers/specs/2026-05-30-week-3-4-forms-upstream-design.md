# Week 3 & 4 — Forms Module (Upstream)

**Status:** Approved
**Date:** 2026-05-30
**Branch target:** upstream `main`
**Scope window:** Forms module hardening only — no other module work

---

## Goal

Ship the Forms module to production-grade quality on the upstream repo. The MUI redesign has landed; this spec covers service correctness, component decomposition, and the public fill + shareable-link flow.

The upstream `main` already has a forms service skeleton (440 LOC), a `formsStore`, a `formsKeyStore`, and a 1139-LOC MUI-migrated `FormsPage` monolith. This spec fixes the encryption bugs, replaces the `formsKeyStore` (NIP-59 gift-wrap approach) with the kind-14083 interop format, splits the monolith, and adds the public fill route.

---

## Architecture Decision: kind-14083 over NIP-59 gift-wraps

The origin repo used `formsKeyStore` — a NIP-59 gift-wrap subscription that distributed view keys to collaborators. The upstream uses **kind-14083** instead, matching the format used by the canonical formstr.app and `@formstr/sdk`:

```
encrypted content = NIP-44 self-encrypt of:
  [ ["f", "formPubkey:formId", relay, "signingKeyHex:viewKeyHex"], ... ]
```

Consequences:

- `formsKeyStore.ts` is deleted
- `FormSummary` gets `signingKey?: string; viewKey?: string` fields
- Keys travel from kind-14083 → `formsStore.myForms` → service calls
- No NIP-59 subscription lifecycle to manage
- Forms created here are accessible to formstr.app users (same wire format)

Collaboration (sharing view key with other pubkeys via gift-wrap) is explicitly out of scope for weeks 3–4.

---

## PR Breakdown

Three PRs in order. Each must be CI-green before the next opens.

- **PR 1** (`upstream-week3&4-pr1`) — `fix(forms): encryption correctness + MyForms persistence + tests`
- **PR 2** (`upstream-week3&4-pr2`) — `refactor(forms): split FormsPage into composable components`
- **PR 3** (`upstream-week3&4-pr3`) — `feat(forms): public fill route + anonymous responder + shareable link`

---

## PR 1 — `fix(forms): encryption correctness + MyForms persistence + tests`

### Bugs fixed

#### Bug 1: `saveToMyForms` drops keys

**Current:** serialises `FormSummary[]` objects — no signing key, no view key. After a page reload, encrypted forms are unrecoverable.

**Fix:** save the canonical tag-tuple format:

```
["f", "formPubkey:formId", relay, "signingKeyHex:viewKeyHex"]
```

Encrypted with `nip44SelfEncrypt`. Public forms omit the key segment: `"signingKeyHex"` only.

#### Bug 2: `createForm` never persists keys

**Current:** returns `{ signingKey, viewKey }` but never calls `saveToMyForms`.

**Fix:** after publishing the kind-30168 event, append a tag-tuple entry and call `saveToMyForms` (read-modify-write on kind-14083). Add an explicit `["encryption", "view-key"]` tag to the published event.

#### Bug 3: `fetchForm` uses `nip44SelfDecrypt`

**Current:** encrypted form content is encrypted to `viewPubkey` (using signing key), not to the user's own pubkey. `nip44SelfDecrypt` always fails.

**Fix:** signature becomes `fetchForm(pubkey, formId, viewKey?: string)`. When `viewKey` is provided, decrypt using `nip44Decrypt(signingKey, viewPubkey, content)`. When absent, fields remain empty and `isEncrypted: true`.

#### Bug 4: `fetchMyForms` returns keyless summaries

**Current:** parses tag-tuples correctly but `FormSummary` has no key fields — keys are discarded after parsing.

**Fix:** extend `FormSummary`:

```ts
interface FormSummary {
  id: string;
  name: string;
  pubkey: string;
  createdAt: number;
  isEncrypted: boolean;
  signingKey?: string; // hex; only for forms you own
  viewKey?: string; // hex; only for encrypted forms
}
```

Parse `t[3]` as `"signingKeyHex:viewKeyHex"` and populate both fields.

#### Bug 5: `parseResponseEvent` ignores encrypted responses

**Current:** reads only plaintext `["response", ...]` tags. Encrypted responses (content !== "" and no response tags) return empty arrays. `wasEncrypted` flag exists but is never set.

**Fix:** detect encrypted responses, decrypt `event.content` using the form's signing key via NIP-44, parse the resulting tag array, set `wasEncrypted: true`. Thread `signingKey?: string` into `fetchResponses` and `subscribeToResponses`.

#### Bug 6: `isEncrypted` heuristic is fragile

**Current:** `content.length > 0 && fields.length === 0` — breaks for edge cases.

**Fix:** `createForm` emits `["encryption", "view-key"]`. `parseFormEvent` reads it first; falls back to heuristic for events from older clients.

#### Bug 7: local `bytesToHex` defined twice

**Fix:** delete both; import from `@formstr/core`.

### `formsKeyStore` removal

Delete `packages/app/src/stores/formsKeyStore.ts`. Remove its import from `stores/index.ts`. Remove any `start()`/`stop()` calls from `authStore`.

### Store changes (`formsStore`)

- `loadForm(pubkey, formId)` → looks up `viewKey` from `myForms`, passes to `fetchForm`
- `loadResponses(pubkey, formId)` → looks up `signingKey` from `myForms`, passes to `fetchResponses`
- `createForm(params)` → calls `saveToMyForms` after publishing (non-fatal if it fails)

### Tests

All under `packages/app/src/services/forms/` and `packages/app/src/stores/`. Vitest jsdom. Mock `@formstr/core` singletons via `vi.mock`.

| File                 | Coverage                                                                                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service.test.ts`    | `createForm` plain + encrypted → kind-14083 tag published; `fetchForm` with viewKey decrypts; without viewKey leaves fields empty; `fetchResponses` plain + encrypted-decrypted + encrypted-cant-read; `deleteForm` correct a-tag |
| `formsStore.test.ts` | `fetchMyForms` populates keys on summaries; `createForm` optimistic add + saveToMyForms called; `loadForm` passes viewKey; `deleteForm` rollback on error                                                                         |

Target: ≥80% line coverage on `packages/app/src/services/forms/` (reported, not gated — gate added in PR 3).

---

## PR 2 — `refactor(forms): split FormsPage into composable components`

### Problem

`FormsPage.tsx` is 1139 LOC containing list view, create dialog, fill dialog, and responses dialog all interleaved via a single `activeDialog` state. Untestable in isolation.

### File structure after split

```
packages/app/src/
  pages/
    FormsPage.tsx              ← ~80 LOC orchestrator
  components/forms/
    FormListView.tsx           ← grid of FormCard, empty state, skeletons
    FormCard.tsx               ← single MUI Card + action row
    CreateFormDialog.tsx       ← field builder, encryption toggle, collaborators
    FillFormDialog.tsx         ← field renderer + submit (uses FormFieldsRenderer)
    ResponsesDialog.tsx        ← responses table + FormAnalytics tab
    FormFieldsRenderer.tsx     ← shared pure renderer (reused by FillPage in PR 3)
    FieldInput.tsx             ← EXISTING, unchanged
    FormAnalytics.tsx          ← EXISTING, unchanged
```

### Component contracts

**`FormListView`** — `forms: FormSummary[], isLoading, onFill, onViewResponses, onDelete, onCreateNew`. Pure presentational.

**`FormCard`** — single `FormSummary` + callbacks. MUI Card with hover action row (fill, responses, delete, copy-link placeholder).

**`CreateFormDialog`** — `open, onClose`. Local field-list state. On submit calls `useFormsStore().createForm(...)`. Encryption toggle + collaborators text field.

**`FillFormDialog`** — `open, form: FormTemplate | null, isLoading, onClose`. Calls `formsService.submitResponse` directly. Identity toggle shown for public forms when user is logged in.

**`ResponsesDialog`** — `open, form: FormTemplate | null, responses, isLoading, onClose`. Two tabs: table + analytics.

**`FormFieldsRenderer`** — `fields: FormField[], values: Record<string,string>, onChange(fieldId, value)`. Pure presentational. Extracted from FillFormDialog; reused by FillPage.

**`FormsPage`** — slim orchestrator: `activeDialog` + `selectedForm` state, store calls, renders the four dialogs + `<FormListView>`.

### Tests

`packages/app/src/components/forms/*.test.tsx` — all jsdom, `@testing-library/react`.

| File                        | What                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `FormListView.test.tsx`     | skeletons while loading; empty state; n cards rendered; onCreateNew called         |
| `FormCard.test.tsx`         | encrypted badge; onFill on click; onDelete on icon click                           |
| `CreateFormDialog.test.tsx` | closed when open=false; add field; submit calls createForm; disables while loading |
| `FillFormDialog.test.tsx`   | null while form=null; renders all field types; submit calls submitResponse         |
| `ResponsesDialog.test.tsx`  | empty state; n rows; Analytics tab switch                                          |

---

## PR 3 — `feat(forms): public fill route + anonymous responder + shareable link`

### Route: `/forms/fill/:naddr`

Public, no login required, rendered **outside AppShell**. The `naddr` is a NIP-19 bech32 `naddr1...` encoding `kind=30168, pubkey, identifier`.

Optionally, a `?nkeys=<encoded>` query param carries the view key (base64-encoded `{"viewKey":"hex"}`), enabling the recipient to decrypt an encrypted form without logging in. This makes shareable links low-friction for encrypted forms.

Route registered in `router.tsx` as a top-level route outside the AppShell children:

```ts
{ path: "/forms/fill/:naddr", element: <FillPage /> }
```

### `FillPage.tsx`

Location: `packages/app/src/pages/FillPage.tsx`.

1. Decode `naddr` param → `{ pubkey, identifier }`.
2. Read `?nkeys` query param if present; decode to extract `viewKey`.
3. Call `formsService.fetchForm(pubkey, identifier, viewKey)`.
4. Render: minimal header (Formstr logo, login button) + `ResponderIdentityBar` + `FormFieldsRenderer`.
5. On submit: use identity from `ResponderIdentityBar` to call `formsService.submitResponse`.

When `settings.allowedResponders` is non-empty, hide the anonymous toggle and show `LoginDialog` if the user is not logged in.

### `ResponderIdentityBar`

```
[ ○ Submit anonymously ]   [ ● Submit as npub1... ]
```

- **Submit as me** — uses `signerManager.getSigner()`. Shown only when logged in.
- **Submit anonymously** — generates ephemeral key via `generateSecretKey()`, signs the response, discards the key after publish.
- Selecting anonymous clears the tracked signer; selecting "as me" restores `signerManager`.

### Shareable link (Copy link button)

Added to `FormCard` action row:

1. Call `createTagRef("forms", 30168, form.pubkey, form.id)` from `@formstr/core` to get the naddr.
2. For encrypted forms, append `?nkeys=<base64({"viewKey":"hex"})>` so the recipient can read the form without a key lookup.
3. Write `${window.location.origin}/forms/fill/${naddr}?nkeys=...` to clipboard.
4. Show MUI Snackbar: "Link copied".

### Coverage gate

Add 80% line threshold for `packages/app/src/services/forms/` to `packages/app/vitest.config.ts`.

### Tests

| File                            | What                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `FillPage.test.tsx`             | loading state; renders form after fetch; anon submit uses ephemeral key; submit-as-me uses signerManager; allowedResponders blocks anon |
| `ResponderIdentityBar.test.tsx` | shows both options when logged in + public form; hides anon when allowedResponders set; selecting anon clears signer                    |
| `FormCard` copy-link            | clicking copy writes correct naddr URL to clipboard; nkeys appended for encrypted forms; Snackbar shown                                 |

---

## Non-goals for all three PRs

- No collaboration (gift-wrap view key to other pubkeys)
- No edit-form flow
- No file-upload field backend
- No AI integration
- No Calendar / Pages / Drive / Polls work
- No Zap-response integration

---

## Definition of Done

After all three PRs merge to upstream `main`:

1. CI green (typecheck, lint, test, build)
2. `packages/app/src/services/forms/` line coverage ≥80%, enforced in CI
3. Encrypted form: create → copy link with nkeys → open in incognito → fill → response visible in dashboard
4. Public form: share link → open in incognito → fill anonymously → response appears in dashboard
5. `allowedResponders` form blocks anonymous submit and surfaces login prompt
6. No `formsKeyStore` anywhere in the codebase
7. `FormsPage.tsx` ≤80 LOC; no component file >300 LOC (except `FieldInput` which is a focused renderer)
8. Forms created in this app are accessible from formstr.app (kind-14083 wire format compatible)
