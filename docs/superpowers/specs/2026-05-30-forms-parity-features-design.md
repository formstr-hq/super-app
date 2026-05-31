# Forms Parity — Bug Fixes & Feature Batch (PR4) — Design

**Date:** 2026-05-30
**Branch:** `upstream-week3&4-pr4`
**Repo:** `formstr-hq/super-app` (upstream)
**Companion doc:** [forms-parity-gaps.md](./2026-05-30-forms-parity-gaps.md)

---

## Goal

Bring the super-app forms module to a "feels complete, not bloated" parity level with
formstr.app by fixing two live bugs and shipping the highest-value missing features. Scope was
chosen as **Bugs + P1 essentials + key P2 polish** from the parity-gaps doc. Explicitly **out of
scope** this batch: grid-field builder, form editing, validation UI, cover/title image,
notifyNpubs, multi-page sections, NIP-59 collaborators.

## Scope

| #   | Item                                                                   | Source             |
| --- | ---------------------------------------------------------------------- | ------------------ |
| 0   | NIP-04 kind-14083 compatibility (already in working tree, uncommitted) | Bug #1             |
| 1   | Checkbox support on public FillPage                                    | Bug #2             |
| 2   | Encrypt anonymous responses to encrypted forms                         | Bug #3             |
| 3   | Enable `fileUpload` + `signature` field types in builder               | Missing #1/#2      |
| 4   | Drag-to-reorder fields in builder                                      | Missing #5         |
| 5   | Form settings: thank-you text + responder access controls              | Missing #8/#10/#11 |
| 6   | CSV + JSON response export                                             | Missing #13        |
| 7   | Responder identity in responses table                                  | Missing #14        |
| 8   | Live response subscription in responses dialog                         | Missing #15        |

## Architecture decision

**Refactor the form builder (Approach A).** [CreateFormDialog.tsx](../../../packages/app/src/components/forms/CreateFormDialog.tsx)
(296 LOC) renders each field's editor inline. Adding two field types, drag-reorder, and a settings
section inline would push it past ~500 LOC. We extract two focused components, matching the PR-2
pattern that split `FormsPage` into composable pieces:

- **`FieldEditorRow.tsx`** — renders one field's edit UI (label, type select, options, required
  toggle, drag handle) and owns its drag event handlers. Props: `field`, index, update/remove
  callbacks, drag callbacks.
- **`FormSettingsSection.tsx`** — thank-you text input, "require login" toggle, allowed-responders
  npub list. Props: `settings`, `onChange`.
- **`CreateFormDialog.tsx`** — orchestrates: holds `fields` + `settings` state, renders the field
  list and the settings section, calls `createForm`.

## Component & data flow

### Bug fixes (commit 1)

- **Checkboxes on FillPage:** `FormFieldsRenderer` gains `checkAnswers: Record<string, Set<string>>`
  and `onToggleCheck: (fieldId, optionId) => void` props, forwarded to `FieldInput`. `FillPage`
  holds `checkAnswers` state; on submit, checkbox fields serialize to
  `JSON.stringify(Array.from(set))` — identical to `FillFormDialog`'s existing logic.
- **Encrypt anon responses:** `FillPage.handleSubmit` passes `form.isEncrypted` (was hardcoded
  `false`) as the `encrypt` argument. The ephemeral signer already implements `nip44Encrypt`.

### New field types (commit 2)

Add `<MenuItem value={AnswerType.fileUpload}>File upload</MenuItem>` and
`<MenuItem value={AnswerType.signature}>Signature</MenuItem>` to the type select. Both already
render in `FieldInput`; no extra config UI needed (file upload uses the default Blossom server,
signature needs none).

### Builder refactor + reorder (commits 3–4)

Extract `FieldEditorRow` and `FormSettingsSection`. Reorder uses native HTML5 DnD on the existing
`GripVertical` handle: `draggable` rows, `onDragStart` records the dragged index, `onDragOver`
previews, `onDrop` splices the `fields` array. No new dependency.

### Form settings (commit 5)

`FormSettingsSection` writes into the existing `FormSettings` type:

- `thankYouText?: string`
- `disallowAnonymous?: boolean` (rendered as a "Require login to respond" toggle)
- `allowedResponders?: string[]` (npub inputs validated and stored as hex)

**Supporting service fix:** `createForm`'s encrypted branch currently emits only `d`/`name`/
`encryption` tags and drops `settings`. Add `["settings", JSON.stringify(settings)]` to the
encrypted form event so thank-you text + access controls persist for encrypted forms (these values
are not secret). `parseFormEvent` already reads the `settings` tag.

**Fill-surface wiring:** `FillPage` and `FillFormDialog` render `settings.thankYouText` in place of
the hardcoded "Thank you" string (falling back to a default). `FillPage.requiresLogin` becomes
`settings.disallowAnonymous || (settings.allowedResponders?.length ?? 0) > 0`.

### Responses: export, identity, live (commits 6–8)

- **Export:** `ResponsesDialog` gains "Export CSV" and "Export JSON" buttons. Pure client-side
  `Blob` + `URL.createObjectURL` download. CSV maps choice-field answers (stored as option IDs)
  back to option labels for readability; JSON dumps the raw `FormResponseEvent[]`.
- **Identity:** add a "Responder" column showing `formatNpub(pubkey)` (truncated npub) with a
  copy-to-clipboard button. Add a small `formatNpub` helper (none exists today).
- **Live:** `formsStore.loadResponses` switches from one-shot `fetchResponses` to
  `subscribeToResponses`. The store keeps the returned `SubscriptionHandle` and tears it down in
  `clearCurrent()`. Responses accumulate into state as events arrive; dedupe by event `id`.

## Error handling

- Drag reorder is purely local state; no failure mode beyond no-op on invalid drop index.
- Export guards against empty `responses` (button disabled when none).
- npub validation: invalid npub entries are rejected inline; only valid hex pubkeys are saved.
- Live subscription failures fall back to whatever events already arrived; `clearCurrent` always
  unsubscribes to avoid leaks.

## Testing

The module gates 80% line coverage on `services/forms/**`; keep it green. Per-commit:

- Service test for the encrypted-form `settings` tag round-trip.
- Component tests: `FieldEditorRow` (reorder + type select incl. new types),
  `FormSettingsSection` (settings changes, npub validation), `ResponsesDialog` (export output +
  responder column), `FillPage` (checkbox submit + encrypted submit).
- Store test: `loadResponses` subscribes and `clearCurrent` unsubscribes.

## Commit plan

1. `fix(forms): NIP-04 kind-14083 encryption for formstr.app compatibility`
2. `fix(forms): checkbox support + encrypt anonymous responses on public fill page`
3. `feat(forms): enable file-upload & signature field types in builder`
4. `refactor(forms): extract FieldEditorRow & FormSettingsSection from CreateFormDialog`
5. `feat(forms): drag-to-reorder fields in builder`
6. `feat(forms): form settings — thank-you text + responder access controls`
7. `feat(forms): CSV + JSON response export`
8. `feat(forms): show responder identity in responses table`
9. `feat(forms): live response subscription in responses dialog`

## Out of scope (tracked in parity-gaps doc for future PRs)

Grid-field builder, form editing, validation UI, cover/title image, notifyNpubs DM notifications,
multi-page section rendering, NIP-59 collaborator gift-wrap.
